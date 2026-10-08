import "server-only";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { db } from "@/server/db";
import { SECOND_STEP, originsForRpId } from "./config";
import { ensureSettings } from "./state";
import { SecurityError, type TicketRow } from "./tickets";

const RP_NAME = "Maison Oud";

/** Friendly default name from the browser's user agent. */
export function deviceName(ua: string | null | undefined) {
  const s = ua ?? "";
  if (/iPhone/i.test(s)) return "iPhone";
  if (/iPad/i.test(s)) return "iPad";
  if (/Android/i.test(s)) return "Android phone";
  if (/Windows/i.test(s)) return "Windows PC";
  if (/Macintosh|Mac OS X/i.test(s)) return "Mac";
  if (/CrOS/i.test(s)) return "Chromebook";
  return "This device";
}

function challengeOf(clientDataJSON: unknown): string {
  try {
    const parsed = JSON.parse(Buffer.from(String(clientDataJSON), "base64url").toString("utf8")) as { challenge?: unknown };
    if (typeof parsed.challenge === "string" && parsed.challenge.length >= 16) return parsed.challenge;
  } catch {
    /* fall through */
  }
  throw new SecurityError("That phone lock response couldn’t be read. Please try again.", 400);
}

/** Single use: the challenge row is deleted atomically; a replay (or an expired one) finds nothing. */
async function consumeChallenge(challenge: string, ticket: TicketRow, kind: "register" | "authenticate") {
  const row = await db.webAuthnChallenge.findUnique({ where: { challenge } });
  const gone = await db.webAuthnChallenge.deleteMany({
    where: { challenge, ticketId: ticket.id, userId: ticket.userId, kind, expiresAt: { gt: new Date() } },
  });
  if (gone.count !== 1 || !row) throw new SecurityError("This phone lock request has expired or was already used. Please try again.", 400, { code: "challenge" });
  return row;
}

async function saveChallenge(challenge: string, ticket: TicketRow, kind: "register" | "authenticate", rpId: string) {
  await db.webAuthnChallenge.create({
    data: { challenge, ticketId: ticket.id, userId: ticket.userId, kind, rpId, expiresAt: new Date(Date.now() + SECOND_STEP.challengeMs) },
  });
}

// ── Registration (needs a manage/setup/enroll ticket, i.e. a fresh email code) ──────────────────────────────

export async function registrationOptions(ticket: TicketRow, rpId: string) {
  const settings = await ensureSettings(ticket.userId);
  const user = await db.user.findUniqueOrThrow({ where: { id: ticket.userId }, select: { email: true, name: true } });
  const existing = await db.passkey.findMany({ where: { userId: ticket.userId, rpId }, select: { credentialId: true, transports: true } });
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId,
    userName: user.email,
    userDisplayName: user.name ?? user.email,
    userID: Buffer.from(settings.webauthnUserId, "base64url"),
    attestationType: "none",
    timeout: 120_000,
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports as AuthenticatorTransportFuture[] })),
    authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
  });
  await saveChallenge(options.challenge, ticket, "register", rpId);
  return options;
}

export async function verifyRegistration(ticket: TicketRow, response: RegistrationResponseJSON, opts: { name?: string; userAgent?: string | null }) {
  const challenge = await consumeChallenge(challengeOf(response?.response?.clientDataJSON), ticket, "register");
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: originsForRpId(challenge.rpId),
      expectedRPID: challenge.rpId,
      requireUserVerification: true,
    });
  } catch (e) {
    throw new SecurityError(`This phone lock couldn’t be added: ${e instanceof Error ? e.message : "verification failed"}`, 400);
  }
  if (!verification.verified) throw new SecurityError("This phone lock couldn’t be verified.", 400);
  const info = verification.registrationInfo;
  if (!info.userVerified) throw new SecurityError("Your phone has to confirm it’s you (Face ID, fingerprint or PIN).", 400);
  const name = (opts.name?.trim() || deviceName(opts.userAgent)).slice(0, 60);
  // Returned (not saved) so the caller can consume its ticket first.
  return {
    userId: ticket.userId,
    credentialId: info.credential.id,
    publicKey: new Uint8Array(info.credential.publicKey),
    counter: BigInt(info.credential.counter),
    transports: info.credential.transports ?? [],
    backedUp: info.credentialBackedUp,
    rpId: challenge.rpId,
    name,
  };
}

// ── Authentication (second step / switching off) ────────────────────────────────────────────────────────────

export async function authenticationOptions(ticket: TicketRow, rpId: string) {
  const keys = await db.passkey.findMany({ where: { userId: ticket.userId, rpId }, select: { credentialId: true, transports: true } });
  if (!keys.length) throw new SecurityError("No phone lock is saved for this site.", 404);
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    timeout: 120_000,
    userVerification: "required",
    allowCredentials: keys.map((k) => ({ id: k.credentialId, transports: k.transports as AuthenticatorTransportFuture[] })),
  });
  await saveChallenge(options.challenge, ticket, "authenticate", rpId);
  return options;
}

export class PasskeyMismatch extends Error {}

/**
 * Verifies signature, origin, rpId, user handle and user verification. Throws SecurityError for request problems
 * (expired/replayed challenge) and PasskeyMismatch for a wrong credential — the caller counts the latter as a wrong try.
 */
export async function verifyAuthentication(ticket: TicketRow, response: AuthenticationResponseJSON) {
  const challenge = await consumeChallenge(challengeOf(response?.response?.clientDataJSON), ticket, "authenticate");
  const key = typeof response?.id === "string" ? await db.passkey.findUnique({ where: { credentialId: response.id } }) : null;
  if (!key || key.userId !== ticket.userId || key.rpId !== challenge.rpId) throw new PasskeyMismatch("unknown credential");
  const settings = await db.securitySettings.findUnique({ where: { userId: ticket.userId }, select: { webauthnUserId: true } });
  // The pending ticket already identifies the user and credential ownership was checked above.
  // WebAuthn permits an omitted/null handle with allowCredentials; validate it whenever supplied.
  // https://www.w3.org/TR/webauthn-3/#sctn-verifying-assertion (step 6)
  const userHandle = response.response.userHandle;
  if (!settings || (userHandle != null && userHandle !== settings.webauthnUserId)) throw new PasskeyMismatch("user handle mismatch");
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: originsForRpId(challenge.rpId),
      expectedRPID: challenge.rpId,
      requireUserVerification: true,
      credential: { id: key.credentialId, publicKey: new Uint8Array(key.publicKey), counter: Number(key.counter), transports: key.transports as AuthenticatorTransportFuture[] },
    });
  } catch (e) {
    throw new PasskeyMismatch(e instanceof Error ? e.message : "verification failed");
  }
  if (!verification.verified || !verification.authenticationInfo.userVerified) throw new PasskeyMismatch("not verified");
  await db.passkey.update({
    where: { id: key.id },
    data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date(), backedUp: verification.authenticationInfo.credentialBackedUp },
  });
  return key;
}
