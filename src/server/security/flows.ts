import "server-only";
import { cookies } from "next/headers";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { PENDING_COOKIE, SECOND_STEP, SESSION_COOKIES } from "./config";
import { hashToken, randomToken } from "./crypto";
import { sendSecurityCode, verifySecurityCode } from "./email-code";
import { LivenessFailure, analyzeFrames, matchFaces, saveFace } from "./face";
import { assertNotLocked, recordWrongTry, resetWrongTries } from "./lockout";
import { PasskeyMismatch, verifyAuthentication, verifyRegistration } from "./passkeys";
import { ensureSettings, methodSummary } from "./state";
import { SecurityError, consumeTicket, issueTicket, type Scope, type TicketRow } from "./tickets";

// ── Cookies ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The pending step-1 session token (our cookie first; Auth.js's own cookie as a fallback). */
export async function pendingSessionToken() {
  const jar = await cookies();
  return jar.get(PENDING_COOKIE)?.value ?? null;
}

/** The current Auth.js session token, if any. */
export async function sessionTokenFromCookies() {
  const jar = await cookies();
  for (const name of SESSION_COOKIES) {
    const v = jar.get(name)?.value;
    if (v) return v;
  }
  return null;
}

async function setVerifiedCookies(sessionToken: string, secure: boolean) {
  try {
    const jar = await cookies();
    const name = secure ? SESSION_COOKIES[0] : SESSION_COOKIES[1];
    jar.set(name, sessionToken, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: SECOND_STEP.sessionMaxAgeSec });
    jar.delete(PENDING_COOKIE);
  } catch {
    /* outside a request */
  }
}

export async function clearPendingCookie() {
  try {
    (await cookies()).delete(PENDING_COOKIE);
  } catch {
    /* outside a request */
  }
}

// ── Pending sign-in (step 2) ────────────────────────────────────────────────────────────────────────────────

export type ActivePending = { state: "verify" | "setup"; userId: string; name: string | null; email: string; sessionToken: string };
export type PendingState = { state: "none" } | { state: "expired" } | { state: "done" } | ActivePending;

export async function pendingState(sessionToken: string | null): Promise<PendingState> {
  if (!sessionToken) return { state: "none" };
  const row = await db.sessionSecondStep.findUnique({
    where: { sessionToken },
    select: { mode: true, verifiedAt: true, session: { select: { expires: true } }, user: { select: { id: true, name: true, email: true } } },
  });
  if (!row) return { state: "expired" };
  if (row.verifiedAt) return { state: "done" };
  if (row.session.expires < new Date()) return { state: "expired" };
  return { state: row.mode === "setup" ? "setup" : "verify", userId: row.user.id, name: row.user.name, email: row.user.email, sessionToken };
}

/** Marks the pending session verified and extends it to the normal 30 days. */
async function finishSignIn(ticket: TicketRow, method: "phone" | "face", secure: boolean) {
  const sessionToken = ticket.sessionToken!;
  const marked = await db.sessionSecondStep.updateMany({ where: { sessionToken, userId: ticket.userId, verifiedAt: null }, data: { verifiedAt: new Date() } });
  if (marked.count !== 1) throw new SecurityError("This sign-in was already completed or has expired.", 409);
  await db.session.update({ where: { sessionToken }, data: { expires: new Date(Date.now() + SECOND_STEP.sessionMaxAgeSec * 1000) } });
  await resetWrongTries(ticket.userId);
  await audit(ticket.userId, "security.signin.verified", "User", ticket.userId, { method });
  await setVerifiedCookies(sessionToken, secure);
  // The guest bag is merged only now (step 1 skipped it). Lazy import: the cart module pulls in the Auth.js config.
  try {
    const { mergeGuestCartInto } = await import("@/server/cart");
    await mergeGuestCartInto(ticket.userId);
  } catch {
    /* best effort */
  }
}

// ── Codes → tickets ─────────────────────────────────────────────────────────────────────────────────────────

export async function sendManageCode(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true } });
  await sendSecurityCode(user, "manage");
}

/** Fresh email code → a manage ticket bound to this (fully verified) session. */
export async function confirmManageCode(userId: string, sessionToken: string, code: unknown, scope: Scope, rpId: string) {
  if (scope === "disable") {
    const s = await methodSummary(userId, rpId);
    if (s.required) throw new SecurityError("Your store requires Face ID or phone lock, so it can’t be switched off.", 403);
    if (!s.enabled) throw new SecurityError("It’s already off.", 409);
    if (!s.usablePhone && !s.usableFace) throw new SecurityError("No saved method to confirm with.", 409);
  }
  await verifySecurityCode(userId, "manage", code);
  return issueTicket({ audience: "manage", userId, sessionToken, scope });
}

export async function sendSetupCode(pending: ActivePending) {
  await sendSecurityCode({ id: pending.userId, email: pending.email }, "setup");
}

export async function confirmSetupCode(pending: ActivePending, code: unknown) {
  await verifySecurityCode(pending.userId, "setup", code);
  return issueTicket({ audience: "setup", userId: pending.userId, sessionToken: pending.sessionToken });
}

export async function issueSignInTicket(pending: ActivePending) {
  return issueTicket({ audience: "signin", userId: pending.userId, sessionToken: pending.sessionToken });
}

// ── Proving a method (sign-in step 2, or switching the lock off) ────────────────────────────────────────────

type ProveResult = { ok: true; done: "signin" | "disabled" };

async function afterProof(ticket: TicketRow, method: "phone" | "face", secure: boolean): Promise<ProveResult> {
  if (!(await consumeTicket(ticket.id))) throw new SecurityError("This check has expired. Please start again.", 401);
  if (ticket.audience === "signin") {
    await finishSignIn(ticket, method, secure);
    return { ok: true, done: "signin" };
  }
  // manage/disable: the email code was checked when the ticket was issued; this is the "one current method".
  const s = await db.user.findUniqueOrThrow({ where: { id: ticket.userId }, select: { id: true } });
  await db.securitySettings.update({ where: { userId: s.id }, data: { secondStepEnabled: false } });
  await resetWrongTries(ticket.userId);
  await audit(ticket.userId, "security.lock.off", "User", ticket.userId, { confirmedWith: method });
  return { ok: true, done: "disabled" };
}

export function assertProveTicket(ticket: TicketRow) {
  if (ticket.audience === "signin") return;
  if (ticket.audience === "manage" && ticket.scope === "disable") return;
  throw new SecurityError("This check can’t be used here.", 403);
}

export async function provePasskey(ticket: TicketRow, response: AuthenticationResponseJSON, secure: boolean): Promise<ProveResult> {
  assertProveTicket(ticket);
  await assertNotLocked(ticket.userId);
  const settings = await ensureSettings(ticket.userId);
  if (!settings.phoneLockEnabled) throw new SecurityError("Phone lock is switched off for this account.", 403);
  try {
    await verifyAuthentication(ticket, response);
  } catch (e) {
    if (e instanceof PasskeyMismatch) throw await recordWrongTry(ticket.userId, "phone", e.message);
    throw e;
  }
  return afterProof(ticket, "phone", secure);
}

export async function proveFace(ticket: TicketRow, frames: unknown, secure: boolean): Promise<ProveResult> {
  assertProveTicket(ticket);
  await assertNotLocked(ticket.userId);
  const settings = await ensureSettings(ticket.userId);
  if (!settings.faceEnabled) throw new SecurityError("The camera face check is switched off for this account.", 403);
  let analysis;
  try {
    analysis = await analyzeFrames(frames);
  } catch (e) {
    if (e instanceof LivenessFailure) {
      throw await recordWrongTry(ticket.userId, "face", `liveness:${e.reason}`, {}, "We couldn’t confirm a live face — keep still, then bring the phone a little closer when asked.");
    }
    throw e;
  }
  const { matched, scores } = await matchFaces(ticket.userId, analysis.embeddings);
  if (!matched) throw await recordWrongTry(ticket.userId, "face", "no_match", { scores });
  await db.faceTemplate.update({ where: { id: matched }, data: { lastUsedAt: new Date() } });
  return afterProof(ticket, "face", secure);
}

// ── Adding a method (manage add / setup / enrollment link) ──────────────────────────────────────────────────

export function assertAddTicket(ticket: TicketRow) {
  if (ticket.audience === "setup" || ticket.audience === "enroll") return;
  if (ticket.audience === "manage" && (ticket.scope === "add" || ticket.scope === "add+enable")) return;
  throw new SecurityError("This check can’t be used to add a method.", 403);
}

/** Single use for the add itself: the ticket (and an enrollment link) are consumed before anything is saved. */
async function claimAdd(ticket: TicketRow) {
  if (!(await consumeTicket(ticket.id))) throw new SecurityError("This check has expired. Please start again.", 401);
  if (ticket.audience === "enroll") {
    const used = await db.enrollmentLink.updateMany({ where: { id: ticket.enrollmentLinkId!, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (used.count !== 1) throw new SecurityError("This link has already been used or has expired.", 410);
  }
}

async function afterAdd(ticket: TicketRow, kind: "phone" | "face", entityId: string, secure: boolean) {
  const action = kind === "phone" ? "security.phone_lock.added" : "security.face.added";
  await audit(ticket.userId, action, kind === "phone" ? "Passkey" : "FaceTemplate", entityId, { via: ticket.audience, scope: ticket.scope });
  // Make sure the method just added is switched on.
  await db.securitySettings.update({ where: { userId: ticket.userId }, data: kind === "phone" ? { phoneLockEnabled: true } : { faceEnabled: true } });
  if (ticket.audience === "enroll") {
    await audit(ticket.userId, "security.enroll_link.used", "EnrollmentLink", ticket.enrollmentLinkId, { kind });
    return { ok: true as const, done: "enrolled" as const };
  }
  if (ticket.audience === "setup" || ticket.scope === "add+enable") {
    const before = await db.securitySettings.findUnique({ where: { userId: ticket.userId }, select: { secondStepEnabled: true } });
    await db.securitySettings.update({ where: { userId: ticket.userId }, data: { secondStepEnabled: true } });
    if (!before?.secondStepEnabled) await audit(ticket.userId, "security.lock.on", "User", ticket.userId, { via: ticket.audience });
  }
  if (ticket.audience === "setup") {
    await finishSignIn(ticket, kind, secure);
    return { ok: true as const, done: "signin" as const };
  }
  return { ok: true as const, done: "added" as const };
}

export async function addPasskey(ticket: TicketRow, response: RegistrationResponseJSON, opts: { name?: string; userAgent?: string | null; secure: boolean }) {
  assertAddTicket(ticket);
  await ensureSettings(ticket.userId);
  const data = await verifyRegistration(ticket, response, opts);
  await claimAdd(ticket);
  try {
    const key = await db.passkey.create({ data });
    return afterAdd(ticket, "phone", key.id, opts.secure);
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new SecurityError("This phone lock is already saved.", 409);
    throw e;
  }
}

export async function addFace(ticket: TicketRow, frames: unknown, label: string, secure: boolean) {
  assertAddTicket(ticket);
  await ensureSettings(ticket.userId);
  if ((await db.faceTemplate.count({ where: { userId: ticket.userId } })) >= SECOND_STEP.maxFaces) {
    throw new SecurityError(`This account already has ${SECOND_STEP.maxFaces} faces saved. Remove one first.`, 409);
  }
  let analysis;
  try {
    analysis = await analyzeFrames(frames);
  } catch (e) {
    // Enrolling isn't a sign-in attempt, so no lockout — but say plainly what went wrong.
    if (e instanceof LivenessFailure) throw new SecurityError("We couldn’t confirm a live face. Keep still, then bring the phone a little closer when asked.", 422, { liveness: e.reason });
    throw e;
  }
  await claimAdd(ticket);
  const face = await saveFace(ticket.userId, analysis.embeddings, label);
  return afterAdd(ticket, "face", face.id, secure);
}

// ── Settings changes from a verified session ────────────────────────────────────────────────────────────────

/** Turning ON is one tap when a method is saved; otherwise the caller opens setup (code → add a method). */
export async function enableSecondStep(userId: string, rpId: string) {
  const s = await methodSummary(userId, rpId);
  if (!s.usablePhone && !s.usableFace) return { ok: false as const, needsSetup: true as const };
  await ensureSettings(userId);
  await db.securitySettings.update({ where: { userId }, data: { secondStepEnabled: true } });
  if (!s.enabled) await audit(userId, "security.lock.on", "User", userId, { via: "toggle" });
  return { ok: true as const };
}

export async function setMethodEnabled(userId: string, rpId: string, method: "phone" | "face", enabled: boolean) {
  await ensureSettings(userId);
  const s = await methodSummary(userId, rpId);
  const next = { usablePhone: method === "phone" ? enabled && s.passkeys > 0 : s.usablePhone, usableFace: method === "face" ? enabled && s.faces > 0 : s.usableFace };
  if (s.effective && !next.usablePhone && !next.usableFace) {
    throw new SecurityError("At least one saved method has to stay on while Face ID / phone lock is on.", 409);
  }
  await db.securitySettings.update({ where: { userId }, data: method === "phone" ? { phoneLockEnabled: enabled } : { faceEnabled: enabled } });
  await audit(userId, `security.${method === "phone" ? "phone_lock" : "face"}.${enabled ? "on" : "off"}`, "User", userId);
}

export async function removeMethod(userId: string, rpId: string, kind: "phone" | "face", id: string) {
  const s = await methodSummary(userId, rpId);
  const row =
    kind === "phone"
      ? await db.passkey.findFirst({ where: { id, userId }, select: { id: true, rpId: true } })
      : await db.faceTemplate.findFirst({ where: { id, userId }, select: { id: true } });
  if (!row) throw new SecurityError("Not found.", 404);
  if (s.effective) {
    const countsHere = kind === "face" || (row as { rpId?: string }).rpId === rpId;
    const next = {
      phone: s.usablePhone && (kind !== "phone" || !countsHere || s.passkeys > 1),
      face: s.usableFace && (kind !== "face" || s.faces > 1),
    };
    if (!next.phone && !next.face) throw new SecurityError("That’s your last saved method. Switch Face ID / phone lock off first.", 409);
  }
  if (kind === "phone") await db.passkey.delete({ where: { id } });
  else await db.faceTemplate.delete({ where: { id } });
  await audit(userId, kind === "phone" ? "security.phone_lock.removed" : "security.face.removed", kind === "phone" ? "Passkey" : "FaceTemplate", id);
}

// ── Enrollment links ────────────────────────────────────────────────────────────────────────────────────────

export async function createEnrollmentLink(userId: string) {
  const token = randomToken();
  const link = await db.enrollmentLink.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + SECOND_STEP.enrollLinkMs) } });
  await audit(userId, "security.enroll_link.created", "EnrollmentLink", link.id, { expiresAt: link.expiresAt.toISOString() });
  return { token, expiresAt: link.expiresAt };
}

async function findLink(token: unknown, email: unknown) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100 || typeof email !== "string") return null;
  const link = await db.enrollmentLink.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { select: { id: true, email: true } } } });
  if (!link || link.usedAt || link.expiresAt < new Date()) return null;
  if (link.user.email.toLowerCase() !== email.trim().toLowerCase()) return null;
  return link;
}

/** Sends the account's email a code. Always answers the same way, so the page can't be used to probe emails. */
export async function startEnrollment(token: unknown, email: unknown) {
  const link = await findLink(token, email);
  if (link) await sendSecurityCode(link.user, "enroll", link.id);
  return { ok: true as const };
}

export async function confirmEnrollment(token: unknown, email: unknown, code: unknown) {
  const link = await findLink(token, email);
  if (!link) throw new SecurityError("This link has already been used, has expired, or doesn’t match that email.", 410);
  await verifySecurityCode(link.userId, "enroll", code, link.id);
  return issueTicket({ audience: "enroll", userId: link.userId, enrollmentLinkId: link.id });
}
