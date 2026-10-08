// Sign-in security (second step: phone lock + camera face check) checks against the local database:
// step 1 alone never yields a usable session when the lock is on; works normally when off; switching off needs an
// email code + a current method; 3-face limit; wrong-try lockout + reset; phishing origin / replayed challenge /
// unverified user refused; the probe needs a ticket; enrollment links are single use, never sign in; liveness
// (identical frames, no zoom); a different person is refused; missing tables fail closed (rolled-back transaction);
// old sessions, manual locking, every built-in role, new custom roles and role assignment enforce the lock.
// A software WebAuthn authenticator signs real P-256 responses; public-domain NASA portraits drive the face model.
// Creates its own users and removes them (and every row they produced) at the end.
// Run: npm run test:security
//
// Emails go to the console: the Resend key is blanked before any module reads the environment.
process.env.RESEND_API_KEY = "";
// Never send real mail from tests (SMTP takes precedence over Resend when configured).
process.env.SMTP_USER = "";
process.env.SMTP_PASSWORD = "";

export {};

import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DOMAIN = "security-check.invalid";
const ORIGIN = "http://localhost:3000";
const RP_ID = "localhost";
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};

// ── Minimal CBOR encoder (ints, byte/text strings, arrays, maps) ────────────────────────────────────────────
function cborHead(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}
type Cbor = number | string | Buffer | Cbor[] | Map<Cbor, Cbor>;
function cbor(v: Cbor): Buffer {
  if (typeof v === "number") return v >= 0 ? cborHead(0, v) : cborHead(1, -1 - v);
  if (typeof v === "string") {
    const s = Buffer.from(v, "utf8");
    return Buffer.concat([cborHead(3, s.length), s]);
  }
  if (Buffer.isBuffer(v)) return Buffer.concat([cborHead(2, v.length), v]);
  if (Array.isArray(v)) return Buffer.concat([cborHead(4, v.length), ...v.map(cbor)]);
  const parts: Buffer[] = [cborHead(5, v.size)];
  for (const [k, val] of v) parts.push(cbor(k), cbor(val));
  return Buffer.concat(parts);
}

// ── Software WebAuthn authenticator (platform, ES256) ───────────────────────────────────────────────────────
const b64u = (b: Buffer) => b.toString("base64url");
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest();

class SoftAuthenticator {
  credentialId = randomBytes(16);
  privateKey: KeyObject;
  publicJwk: { x: string; y: string };
  counter = 0;
  userHandle: string | null = null;
  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    this.publicJwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  }
  private clientData(type: string, challenge: string, origin: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), "utf8");
  }
  create(options: { challenge: string; rp: { id?: string }; user: { id: string } }, opts: { origin?: string; uv?: boolean } = {}) {
    this.userHandle = options.user.id;
    const cose = cbor(new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(this.publicJwk.x, "base64url")], [-3, Buffer.from(this.publicJwk.y, "base64url")]]));
    const flags = 0x01 | (opts.uv === false ? 0 : 0x04) | 0x40;
    const credLen = Buffer.alloc(2);
    credLen.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([sha256(options.rp.id ?? RP_ID), Buffer.from([flags]), Buffer.alloc(4), Buffer.alloc(16), credLen, this.credentialId, cose]);
    const attestationObject = cbor(new Map<Cbor, Cbor>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
    return {
      id: b64u(this.credentialId),
      rawId: b64u(this.credentialId),
      type: "public-key" as const,
      response: { clientDataJSON: b64u(this.clientData("webauthn.create", options.challenge, opts.origin ?? ORIGIN)), attestationObject: b64u(attestationObject), transports: ["internal" as const] },
      clientExtensionResults: {},
      authenticatorAttachment: "platform" as const,
    };
  }
  get(options: { challenge: string; rpId?: string }, opts: { origin?: string; uv?: boolean; userHandle?: string } = {}) {
    this.counter++;
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    const flags = 0x01 | (opts.uv === false ? 0 : 0x04);
    const authData = Buffer.concat([sha256(options.rpId ?? RP_ID), Buffer.from([flags]), count]);
    const clientDataJSON = this.clientData("webauthn.get", options.challenge, opts.origin ?? ORIGIN);
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), this.privateKey);
    return {
      id: b64u(this.credentialId),
      rawId: b64u(this.credentialId),
      type: "public-key" as const,
      response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: opts.userHandle ?? this.userHandle ?? undefined },
      clientExtensionResults: {},
      authenticatorAttachment: "platform" as const,
    };
  }
}

async function main() {
  await import("dotenv/config");
  const sharp = (await import("sharp")).default;
  const { db } = await import("@/server/db");
  const { PrismaAdapter } = await import("@auth/prisma-adapter");
  const { withSecondStep } = await import("@/server/security/adapter");
  const S = await import("@/server/security/state");
  const F = await import("@/server/security/flows");
  const T = await import("@/server/security/tickets");
  const P = await import("@/server/security/passkeys");
  const Face = await import("@/server/security/face");
  const { latestDevSecurityCode } = await import("@/server/security/email-code");
  const { decryptEmbedding } = await import("@/server/security/crypto");
  const { SECOND_STEP } = await import("@/server/security/config");

  const adapter = withSecondStep(PrismaAdapter(db as never));
  const tag = `secchk${Date.now().toString(36)}`;
  const userIds: string[] = [];
  const roleIds: string[] = [];
  const policyBefore = await db.setting.findUnique({ where: { key: S.POLICY_KEY } });

  const newUser = async (who: string, role: "CUSTOMER" | "SUPPORT" | "MANAGER" | "OWNER" = "CUSTOMER") => {
    const u = await db.user.create({ data: { email: `${who}-${tag}@${DOMAIN}`, name: `Sec ${who}`, role } });
    userIds.push(u.id);
    return u;
  };
  /** Step 1 exactly as Auth.js does it after a magic link: adapter.createSession with a 30-day expiry. */
  const stepOne = async (userId: string) => {
    const sessionToken = randomBytes(32).toString("hex");
    await adapter.createSession!({ sessionToken, userId, expires: new Date(Date.now() + 30 * 86400_000) });
    return sessionToken;
  };
  const err = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return null;
    } catch (e) {
      return e as Error & { status?: number; extra?: Record<string, unknown> };
    }
  };
  const code = (email: string) => latestDevSecurityCode(email) ?? "";
  const manageTicket = async (u: { id: string; email: string }, token: string, scope: "add" | "add+enable" | "disable") => {
    await F.sendManageCode(u.id);
    return F.confirmManageCode(u.id, token, code(u.email), scope, RP_ID);
  };
  const ticketRow = (t: string, ctx: { pendingToken?: string; sessionToken?: string }, audiences: ("signin" | "setup" | "manage" | "enroll")[]) => T.loadTicket(t, { audiences, ...ctx });
  const registerKey = async (ticket: string, ctx: { pendingToken?: string; sessionToken?: string }, auth: SoftAuthenticator, audiences: ("setup" | "manage" | "enroll")[]) => {
    const row = await ticketRow(ticket, ctx, audiences);
    const options = await P.registrationOptions(row, RP_ID);
    return F.addPasskey(await ticketRow(ticket, ctx, audiences), auth.create(options) as never, { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", secure: false });
  };
  const signInTicket = async (pendingToken: string) => {
    const p = await F.pendingState(pendingToken);
    if (p.state !== "verify") throw new Error(`expected verify, got ${p.state}`);
    return F.issueSignInTicket(p);
  };
  const provePhone = async (ticket: string, ctx: { pendingToken?: string; sessionToken?: string }, auth: SoftAuthenticator, opts: { origin?: string; uv?: boolean; userHandle?: string } = {}) => {
    const row = await ticketRow(ticket, ctx, ["signin", "manage"]);
    const options = await P.authenticationOptions(row, RP_ID);
    const response = auth.get(options, opts);
    const result = await F.provePasskey(await ticketRow(ticket, ctx, ["signin", "manage"]), response as never, false);
    return { result, response };
  };

  // ── Face fixtures: zooming 640×640 JPEG frames, made in memory ──
  const fixtures = path.join(process.cwd(), "scripts", "fixtures");
  const astronaut = fs.readFileSync(path.join(fixtures, "astronaut.png"));
  const wilcutt = fs.readFileSync(path.join(fixtures, "nasa-portrait-wilcutt.jpg"));
  const zoomFrames = async (img: Buffer, zooms: number[], quality = 85) => {
    const meta = await sharp(img).metadata();
    const side = Math.min(meta.width!, meta.height!);
    const out: string[] = [];
    for (const [i, z] of zooms.entries()) {
      const s = Math.round(side / z);
      const left = Math.round((meta.width! - s) * 0.42);
      const top = Math.round((meta.height! - s) * 0.2);
      const jpg = await sharp(img).extract({ left, top, width: s, height: s }).resize(640, 640).jpeg({ quality: quality + i }).toBuffer();
      out.push(jpg.toString("base64"));
    }
    return out;
  };
  const astroFrames = await zoomFrames(astronaut, [1, 1.15, 1.3]);
  const astroNoZoom = await zoomFrames(astronaut, [1, 1, 1]); // different bytes (quality varies), same size
  const astroIdentical = [astroFrames[0], astroFrames[0], astroFrames[0]];
  const wilcuttFrames = await zoomFrames(wilcutt, [1, 1.15, 1.3]);
  const blank = (await sharp({ create: { width: 640, height: 640, channels: 3, background: "#777" } }).jpeg().toBuffer()).toString("base64");
  const proveFaceWith = async (ticket: string, ctx: { pendingToken?: string; sessionToken?: string }, frames: string[]) =>
    F.proveFace(await ticketRow(ticket, ctx, ["signin", "manage"]), frames, false);
  const addFaceWith = async (ticket: string, ctx: { pendingToken?: string; sessionToken?: string }, frames: string[], label: string, audiences: ("setup" | "manage" | "enroll")[] = ["manage"]) =>
    F.addFace(await ticketRow(ticket, ctx, audiences), frames, label, false);

  let serverUp = false;
  try {
    serverUp = (await fetch(`${ORIGIN}/api/auth/csrf`, { signal: AbortSignal.timeout(60_000) })).ok;
  } catch {
    serverUp = false;
  }
  const sessionOverHttp = async (token: string) => {
    const r = await fetch(`${ORIGIN}/api/auth/session`, { headers: { cookie: `authjs.session-token=${token}` } });
    return (await r.json()) as { user?: { id: string } } | null;
  };

  try {
    const alice = await newUser("alice");
    const bob = await newUser("bob");
    const staff = await newUser("staff", "SUPPORT");
    const phoneA = new SoftAuthenticator();

    // ── 1. Lock OFF: step 1 gives a normal session ──
    const offToken = await stepOne(alice.id);
    const olderToken = await stepOne(alice.id);
    const olderManageTicket = await manageTicket(alice, olderToken, "add");
    const offSession = await db.session.findUniqueOrThrow({ where: { sessionToken: offToken }, include: { secondStep: true } });
    ok(!offSession.secondStep && offSession.expires.getTime() > Date.now() + 29 * 86400_000, "lock OFF: step 1 creates a normal 30-day session");
    ok(Boolean(await adapter.getSessionAndUser!(offToken)), "lock OFF: the session is usable");

    // ── 2. Turning ON with nothing saved: email code, then add a phone lock ──
    ok((await F.enableSecondStep(alice.id, RP_ID)).ok === false, "turning ON with no method saved asks for setup first (switch stays off)");
    await F.sendManageCode(alice.id);
    const wrong = await err(() => F.confirmManageCode(alice.id, offToken, "000000" === code(alice.email) ? "111111" : "000000", "add+enable", RP_ID));
    ok(wrong?.message?.includes("isn’t right") ?? false, "a wrong email code is refused");
    const addTicket = await F.confirmManageCode(alice.id, offToken, code(alice.email), "add+enable", RP_ID);
    const reused = await err(() => F.confirmManageCode(alice.id, offToken, code(alice.email), "add", RP_ID));
    ok(Boolean(reused), "an email code works only once");
    const otherSession = await err(() => ticketRow(addTicket, { sessionToken: "someone-elses-session" }, ["manage"]));
    ok(otherSession?.status === 401, "a manage ticket is bound to the session that asked for it");
    const added = await registerKey(addTicket, { sessionToken: offToken }, phoneA, ["manage"]);
    const aliceSettings = await db.securitySettings.findUniqueOrThrow({ where: { userId: alice.id } });
    const key = await db.passkey.findFirstOrThrow({ where: { userId: alice.id } });
    ok(added.done === "added" && aliceSettings.secondStepEnabled, "after the first phone lock is saved the switch is ON");
    ok(key.name === "iPhone" && key.rpId === RP_ID && key.transports.includes("internal"), `phone lock stored with device name, rpId and transports (${key.name}, ${key.rpId})`);
    const ticketAgain = await err(() => registerKey(addTicket, { sessionToken: offToken }, new SoftAuthenticator(), ["manage"]));
    ok(ticketAgain?.status === 401, "an add ticket is single use");
    ok(S.describeMethods(await S.methodSummary(alice.id, RP_ID)) === "On: phone lock", "status in plain words: “On: phone lock”");
    ok(Boolean(await adapter.getSessionAndUser!(offToken)), "successful setup proves the session that enrolled the lock");
    ok((await adapter.getSessionAndUser!(olderToken)) === null, "enabling the lock gates a session opened before setup");
    ok((await F.pendingState(olderToken)).state === "verify", "an old session is sent to saved-method verification");
    ok((await err(() => ticketRow(olderManageTicket, { sessionToken: olderToken }, ["manage"])))?.status === 401, "an old management ticket cannot bypass the newly enabled lock");
    ok(await S.secondStepRequirement(alice.id, "other.example") === "verify", "an enabled lock cannot be bypassed on a hostname without a saved passkey");
    if (serverUp) {
      const response = await fetch(`${ORIGIN}/api/auth/session`, { headers: { cookie: `authjs.session-token=${olderToken}` } });
      ok(!(await response.json())?.user, "old unverified session has no user through the live session API");
      ok(response.headers.getSetCookie().some((c) => c.startsWith("mo_2step=")), "session API preserves the pending token when clearing the normal session cookie");
      const page = await fetch(`${ORIGIN}/signin/verify`, { headers: { cookie: `authjs.session-token=${olderToken}` } });
      ok(page.ok && (await page.text()).includes("one more check keeps your account safe"), "verification works with the normal cookie when the pending cookie is absent");
    }

    // ── 3. Lock ON: step 1 alone is NOT a usable session ──
    const pendingToken = await stepOne(alice.id);
    const pendingRow = await db.session.findUniqueOrThrow({ where: { sessionToken: pendingToken }, include: { secondStep: true } });
    ok(Boolean(pendingRow.secondStep && !pendingRow.secondStep.verifiedAt), "lock ON: step 1 creates a pending session marker");
    ok(pendingRow.expires.getTime() <= Date.now() + SECOND_STEP.pendingMs + 1000, "lock ON: the pending session expires within 5 minutes");
    ok((await adapter.getSessionAndUser!(pendingToken)) === null, "lock ON: auth() sees the pending session as signed out");
    if (serverUp) {
      const s = await sessionOverHttp(pendingToken);
      ok(!s?.user, "lock ON: /api/auth/session returns no user for the pending session (live server)");
      const acct = await fetch(`${ORIGIN}/account`, { headers: { cookie: `authjs.session-token=${pendingToken}` }, redirect: "manual" });
      // Streaming pages redirect in-band (200 + NEXT_REDIRECT), exactly as for a signed-out visitor.
      const html = acct.status === 200 ? await acct.text() : "";
      const redirected = (acct.status >= 300 && acct.status < 400 && (acct.headers.get("location") ?? "").includes("/signin")) || html.includes("NEXT_REDIRECT;replace;/signin");
      ok(redirected && !html.includes("Hello, Sec"), "lock ON: /account treats the pending session as signed out and sends it to sign-in (live server)");
    } else console.log("SKIP  live-server checks (no dev server on :3000)");

    // ── 4. Step 2 with the phone lock, and the refusals ──
    const t1 = await signInTicket(pendingToken);
    ok((await err(() => ticketRow(t1, { pendingToken: offToken }, ["signin"])))?.status === 401, "a sign-in ticket only works with its own pending session");
    ok((await err(() => ticketRow(t1, { pendingToken }, ["manage"])))?.status === 401, "a sign-in ticket can’t be used as a manage ticket (audience)");

    const phishing = await err(() => provePhone(t1, { pendingToken }, phoneA, { origin: "https://maison-oud.evil.example" }));
    ok(phishing?.status === 401 && /tries left/.test(phishing.message), `phishing origin refused and counted: “${phishing?.message}”`);
    const noUv = await err(() => provePhone(t1, { pendingToken }, phoneA, { uv: false }));
    ok(noUv?.status === 401, "user-verification flag off is refused");
    const wrongHandle = await err(() => provePhone(t1, { pendingToken }, phoneA, { userHandle: b64u(randomBytes(32)) }));
    ok(wrongHandle?.status === 401, "a wrong user handle is refused");
    const strangerKey = new SoftAuthenticator();
    strangerKey.credentialId = Buffer.from(key.credentialId, "base64url"); // same id, different private key
    strangerKey.userHandle = phoneA.userHandle;
    ok((await err(() => provePhone(t1, { pendingToken }, strangerKey)))?.status === 401, "a forged signature (wrong private key) is refused");
    ok((await db.securitySettings.findUniqueOrThrow({ where: { userId: alice.id } })).failedAttempts === 4, "each refused phone-lock try is counted in the database (4)");

    const good = await provePhone(t1, { pendingToken }, phoneA);
    ok(good.result.done === "signin", "the right phone lock completes the second step");
    const verifiedRow = await db.session.findUniqueOrThrow({ where: { sessionToken: pendingToken }, include: { secondStep: true } });
    ok(Boolean(verifiedRow.secondStep?.verifiedAt) && verifiedRow.expires.getTime() > Date.now() + 29 * 86400_000, "after step 2 the session is verified and extended to 30 days");
    ok(Boolean(await adapter.getSessionAndUser!(pendingToken)), "after step 2 the session is usable");
    if (serverUp) ok((await sessionOverHttp(pendingToken))?.user?.id === alice.id, "after step 2 /api/auth/session returns the user (live server)");
    ok((await db.securitySettings.findUniqueOrThrow({ where: { userId: alice.id } })).failedAttempts === 0, "a successful second step resets wrong tries to 0");

    // Replays
    const replay = await err(async () => F.provePasskey(await ticketRow(t1, { pendingToken }, ["signin"]), good.response as never, false));
    ok(replay?.status === 401, "the used sign-in ticket can’t be used again");
    const p2 = await stepOne(alice.id);
    const t2 = await signInTicket(p2);
    const replayed = await err(async () => F.provePasskey(await ticketRow(t2, { pendingToken: p2 }, ["signin"]), good.response as never, false));
    ok(replayed?.status === 400 && /expired or was already used/.test(replayed.message), "a replayed WebAuthn response (old challenge) is refused");
    const p2opts = await P.authenticationOptions(await ticketRow(t2, { pendingToken: p2 }, ["signin"]), RP_ID);
    ok(p2opts.allowCredentials?.length === 1 && p2opts.allowCredentials[0].id === key.credentialId && p2opts.userVerification === "required", "authentication options list only this user’s keys for this site, UV required");
    const otherSite = await err(async () => P.authenticationOptions(await ticketRow(t2, { pendingToken: p2 }, ["signin"]), "shop.other.example"));
    ok(otherSite?.status === 404, "keys registered for another rpId are not offered");
    const beforeLock = await manageTicket(alice, offToken, "add");
    await F.lockSession(alice.id, offToken, RP_ID);
    ok((await adapter.getSessionAndUser!(offToken)) === null, "Lock now removes access from the current session immediately");
    ok((await err(() => ticketRow(beforeLock, { sessionToken: offToken }, ["manage"])))?.status === 401, "Lock now invalidates previously issued management tickets");
    const unlock = await provePhone(await signInTicket(offToken), { pendingToken: offToken }, phoneA);
    ok(unlock.result.done === "signin" && Boolean(await adapter.getSessionAndUser!(offToken)), "a saved phone lock restores the manually locked session");

    // Named-credential authenticators may omit userHandle. The signed assertion must still be verified.
    for (const userHandle of [null, undefined]) {
      const token = await stepOne(alice.id);
      const ticket = await signInTicket(token);
      const row = await ticketRow(ticket, { pendingToken: token }, ["signin"]);
      const responseFor = async (phone: SoftAuthenticator, uv = true, origin = ORIGIN) => {
        const options = await P.authenticationOptions(row, RP_ID);
        const response = phone.get(options, { uv, origin });
        return { ...response, response: { ...response.response, userHandle } };
      };
      const absent = userHandle === null ? "null" : "omitted";
      const forged = await responseFor(strangerKey);
      ok((await err(() => F.provePasskey(row, forged as never, false)))?.status === 401, `${absent} handle: forged signatures still fail`);
      const unverified = await responseFor(phoneA, false);
      ok((await err(() => F.provePasskey(row, unverified as never, false)))?.status === 401, `${absent} handle: user verification is still required`);
      const badOrigin = await responseFor(phoneA, true, "https://evil.example");
      ok((await err(() => F.provePasskey(row, badOrigin as never, false)))?.status === 401, `${absent} handle: a phishing origin still fails`);
      ok((await adapter.getSessionAndUser!(token)) === null, `${absent} handle: failed proofs leave the session pending`);
      const valid = await responseFor(phoneA);
      const result = await F.provePasskey(row, valid as never, false);
      ok(result.done === "signin" && Boolean(await adapter.getSessionAndUser!(token)), `${absent} handle: a valid owned credential completes sign-in`);
    }

    // ── 5. Faces: add (code), 3-face limit, encryption at rest ──
    const sessA = offToken; // Alice's original verified session
    const f1 = await addFaceWith(await manageTicket(alice, sessA, "add"), { sessionToken: sessA }, astroFrames, "Me");
    ok(f1.done === "added", "a face can be added with a fresh email code");
    const stored = await db.faceTemplate.findFirstOrThrow({ where: { userId: alice.id } });
    ok(stored.embedding.startsWith("v1.") && decryptEmbedding(stored.embedding, alice.id).length === 128, "only an encrypted 128-number embedding is stored");
    ok((await err(async () => decryptEmbedding(stored.embedding, bob.id))) !== null, "an embedding copied to another account can’t be decrypted (user id is authenticated data)");
    await addFaceWith(await manageTicket(alice, sessA, "add"), { sessionToken: sessA }, astroFrames, "Me 2");
    await addFaceWith(await manageTicket(alice, sessA, "add"), { sessionToken: sessA }, astroFrames, "Me 3");
    const fourth = await err(async () => addFaceWith(await manageTicket(alice, sessA, "add"), { sessionToken: sessA }, astroFrames, "Me 4"));
    ok(fourth?.status === 409 && (await db.faceTemplate.count({ where: { userId: alice.id } })) === 3, "a 4th face is refused (max 3)");
    ok(S.describeMethods(await S.methodSummary(alice.id, RP_ID)) === "On: phone lock + 3 faces", "status in plain words: “On: phone lock + 3 faces”");

    // ── 6. Face as step 2, liveness, different person, camera problems ──
    const p3 = await stepOne(alice.id);
    const t3 = await signInTicket(p3);
    const cam = await err(() => proveFaceWith(t3, { pendingToken: p3 }, [blank, blank.slice(0, -4) + "AAAA", astroFrames[2]]));
    ok(cam?.status === 422 && (await db.securitySettings.findUniqueOrThrow({ where: { userId: alice.id } })).failedAttempts === 0, `a camera problem (no face) isn’t a wrong try: “${cam?.message}”`);
    const identical = await err(() => proveFaceWith(t3, { pendingToken: p3 }, astroIdentical));
    ok(identical?.status === 401 && /live face/.test(identical.message), `byte-identical frames fail liveness and count: “${identical?.message}”`);
    const noZoom = await err(() => proveFaceWith(t3, { pendingToken: p3 }, astroNoZoom));
    ok(noZoom?.status === 401 && /live face/.test(noZoom.message), "frames without the closer-zoom fail liveness and count");
    const stranger = await err(() => proveFaceWith(t3, { pendingToken: p3 }, wilcuttFrames));
    ok(stranger?.status === 401 && stranger.message === "That doesn’t look like you. 2 tries left.", `a different person is refused with the server’s wording: “${stranger?.message}”`);
    ok((await db.securitySettings.findUniqueOrThrow({ where: { userId: alice.id } })).failedAttempts === 3, "wrong face tries are counted in the database (3)");
    const faceOk = await proveFaceWith(t3, { pendingToken: p3 }, astroFrames);
    ok(faceOk.done === "signin" && (await db.securitySettings.findUniqueOrThrow({ where: { userId: alice.id } })).failedAttempts === 0, "the right face completes step 2 and resets wrong tries to 0");

    // ── 7. Lockout after 5 wrong tries in a row ──
    const p4 = await stepOne(alice.id);
    const t4 = await signInTicket(p4);
    let last: Awaited<ReturnType<typeof err>> = null;
    for (let i = 0; i < 5; i++) last = await err(() => proveFaceWith(t4, { pendingToken: p4 }, wilcuttFrames));
    ok(last?.status === 423 && /Too many tries\. Try again in 15 minutes/.test(last.message), `5th wrong try locks the second step: “${last?.message}”`);
    const whileLocked = await err(() => proveFaceWith(t4, { pendingToken: p4 }, astroFrames));
    ok(whileLocked?.status === 423, "while locked even the right face is refused (HTTP 423)");
    const lockedPhone = await err(() => provePhone(t4, { pendingToken: p4 }, phoneA));
    ok(lockedPhone?.status === 423, "while locked the phone lock is refused too");
    await db.securitySettings.update({ where: { userId: alice.id }, data: { lockedUntil: new Date(Date.now() - 1000) } }); // fast-forward 15 min
    const afterLock = await proveFaceWith(t4, { pendingToken: p4 }, astroFrames);
    const afterRow = await db.securitySettings.findUniqueOrThrow({ where: { userId: alice.id } });
    ok(afterLock.done === "signin" && afterRow.failedAttempts === 0 && afterRow.lockedUntil === null, "after the lock expires the right face works and the counter is 0");
    const lockAudits = await db.auditLog.count({ where: { actorId: alice.id, action: "security.second_step.locked" } });
    ok(lockAudits === 1, "the lockout is audit-logged");

    // ── 8. The probe needs a ticket ──
    ok((await err(() => T.loadTicket(undefined, { audiences: ["signin", "setup", "manage", "enroll"] })))?.status === 401, "probe: no ticket → refused");
    ok((await err(() => T.loadTicket("x".repeat(43), { audiences: ["signin"], pendingToken: p4 })))?.status === 401, "probe: unknown ticket → refused");
    const probe = await Face.probeFrame(astroFrames[0]);
    ok(probe.faces === 1 && probe.size > 0.12 && Math.abs(probe.x) < 0.3, `probe returns guidance only (${JSON.stringify(probe)})`);
    if (serverUp) {
      const r1 = await fetch(`${ORIGIN}/api/security/face/probe`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ frame: astroFrames[0] }) });
      ok(r1.status === 401, `live probe without a ticket → ${r1.status}`);
      const r2 = await fetch(`${ORIGIN}/api/security/face/probe`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({}) });
      ok(r2.status === 403, `live probe from another origin → ${r2.status} (CSRF)`);
    }

    // ── 9. Turning OFF needs the email code + one current method ──
    const p5 = await stepOne(alice.id); // fresh verified session for managing
    await provePhone(await signInTicket(p5), { pendingToken: p5 }, phoneA);
    const addAsDisable = await err(async () => registerKey(await manageTicket(alice, p5, "disable"), { sessionToken: p5 }, new SoftAuthenticator(), ["manage"]));
    ok(addAsDisable?.status === 403, "a switch-off ticket can’t be used to add a method");
    const proveWithAdd = await err(async () => provePhone(await manageTicket(alice, p5, "add"), { sessionToken: p5 }, phoneA));
    ok(proveWithAdd?.status === 403, "an add ticket can’t switch the lock off");
    const disableTicket = await manageTicket(alice, p5, "disable");
    ok((await db.securitySettings.findUniqueOrThrow({ where: { userId: alice.id } })).secondStepEnabled, "the code alone doesn’t switch it off");
    const wrongFaceOff = await err(() => proveFaceWith(disableTicket, { sessionToken: p5 }, wilcuttFrames));
    ok(wrongFaceOff?.status === 401 && (await db.securitySettings.findUniqueOrThrow({ where: { userId: alice.id } })).secondStepEnabled, "the code + a wrong face doesn’t switch it off");
    const off = await provePhone(disableTicket, { sessionToken: p5 }, phoneA);
    const offRow = await db.securitySettings.findUniqueOrThrow({ where: { userId: alice.id } });
    ok(off.result.done === "disabled" && !offRow.secondStepEnabled, "the code + a current method switches it off");
    ok((await db.passkey.count({ where: { userId: alice.id } })) === 1 && (await db.faceTemplate.count({ where: { userId: alice.id } })) === 3, "saved faces and keys are kept when switched off");
    ok(S.describeMethods(await S.methodSummary(alice.id, RP_ID)) === "Off: sign-in link only", "status in plain words: “Off: sign-in link only”");
    const offAgain = await stepOne(alice.id);
    ok(Boolean(await adapter.getSessionAndUser!(offAgain)), "with the lock off, step 1 alone signs in again");
    ok((await F.enableSecondStep(alice.id, RP_ID)).ok, "turning it back ON is one tap");
    ok((await adapter.getSessionAndUser!(offAgain)) === null && (await adapter.getSessionAndUser!(p5)) === null, "turning the lock back on gates both old unmarked sessions and old verified sessions");
    ok((await err(() => F.setMethodEnabled(alice.id, RP_ID, "phone", false))) === null && (await err(() => F.setMethodEnabled(alice.id, RP_ID, "face", false)))?.status === 409, "at least one method must stay on while the lock is on");
    await F.setMethodEnabled(alice.id, RP_ID, "phone", true);

    // ── 10. Enrollment link: email + code only, single use, never signs in, respects the face limit ──
    const sessionsBefore = await db.session.count({ where: { userId: alice.id } });
    const link = await F.createEnrollmentLink(alice.id);
    await F.startEnrollment(link.token, bob.email); // wrong email → nothing sent
    ok((await db.securityEmailCode.count({ where: { userId: alice.id, purpose: "enroll" } })) === 0, "the link page with the wrong email sends no code");
    await F.startEnrollment(link.token, alice.email.toUpperCase());
    const enrollCode = code(alice.email);
    ok((await err(() => F.confirmEnrollment(link.token, alice.email, enrollCode === "123456" ? "654321" : "123456")))?.status === 400, "the link with a wrong code is refused");
    const tooManyFaces = await err(async () => addFaceWith(await F.confirmEnrollment(link.token, alice.email, enrollCode), {}, astroFrames, "Guest", ["enroll"]));
    ok(tooManyFaces?.status === 409, "the link respects the 3-face limit");
    await F.startEnrollment(link.token, alice.email);
    const enrollTicket = await F.confirmEnrollment(link.token, alice.email, code(alice.email));
    const secondPhone = new SoftAuthenticator();
    const enrolled = await registerKey(enrollTicket, {}, secondPhone, ["enroll"]);
    ok(enrolled.done === "enrolled" && (await db.passkey.count({ where: { userId: alice.id } })) === 2, "someone else’s phone is added through the link");
    ok((await db.session.count({ where: { userId: alice.id } })) === sessionsBefore, "the link never creates a session");
    await F.startEnrollment(link.token, alice.email);
    ok((await err(() => F.confirmEnrollment(link.token, alice.email, code(alice.email) || "000000")))?.status === 410, "the link never works twice");
    ok((await db.auditLog.count({ where: { actorId: alice.id, action: { in: ["security.enroll_link.created", "security.enroll_link.used"] } } })) === 2, "link created/used are audit-logged");

    // ── 11. Missing security tables must never disable authentication checks ──
    class Rollback extends Error {}
    let fallback: { req: unknown; pending: unknown; closed: boolean } | null = null;
    try {
      await db.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`DROP TABLE "SessionSecondStep", "SecuritySettings", "Passkey", "FaceTemplate" CASCADE`);
          await tx.$executeRawUnsafe("SAVEPOINT check_requirement");
          const req = await err(() => S.secondStepRequirement(alice.id, RP_ID, tx));
          await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT check_requirement");
          const pending = await err(() => S.isSessionPending(p5, tx));
          await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT check_requirement");
          // Any other error must still fail CLOSED (re-thrown).
          const closed = (await err(() => S.tolerateMissingTables(tx, true, async () => tx.$queryRawUnsafe("SELECT * FROM no_such_function_xyz()"), "open"))) !== null;
          fallback = { req, pending, closed };
          throw new Rollback();
        },
        { timeout: 30_000 },
      );
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    const fb = fallback as { req: unknown; pending: unknown; closed: boolean } | null;
    ok(Boolean(fb?.req && fb?.pending), "missing security tables block both new sign-ins and existing sessions (fail closed)");
    ok(fb?.closed === true, "pre-migration: any other database error still fails closed");
    ok((await db.securitySettings.count({ where: { userId: alice.id } })) === 1, "the dropped tables are back after the rollback");
    ok(S.isMissingTable({ code: "P2021" }) && S.isMissingTable({ cause: { originalCode: "42P01" } }) && !S.isMissingTable({ code: "P2002" }), "missing-table detection matches only P2021 / 42P01");

    // ── 12. Policy covers existing sessions, every built-in role and future custom roles ──
    const staffBeforePolicy = await stepOne(staff.id);
    const customerBeforePromotion = await stepOne(bob.id);
    await db.setting.upsert({ where: { key: S.POLICY_KEY }, update: { value: { require: "staff" } }, create: { key: S.POLICY_KEY, value: { require: "staff" } } });
    ok((await adapter.getSessionAndUser!(staffBeforePolicy)) === null && (await F.pendingState(staffBeforePolicy)).state === "setup", "new staff policy gates an existing unverified staff session");
    for (const role of ["OWNER", "MANAGER", "SUPPORT"] as const) {
      const member = await newUser(role.toLowerCase(), role);
      const token = await stepOne(member.id);
      ok((await adapter.getSessionAndUser!(token)) === null && (await F.pendingState(token)).state === "setup", `${role}: required setup blocks admin access`);
      if (serverUp) {
        const page = await fetch(`${ORIGIN}/admin/security`, { headers: { cookie: `authjs.session-token=${token}` }, redirect: "manual" });
        const html = page.status === 200 ? await page.text() : "";
        ok((page.headers.get("location") ?? "").includes("/signin/verify") || html.includes("NEXT_REDIRECT;replace;/signin/verify"), `${role}: live admin security page redirects to verification`);
      }
    }
    const customRole = await db.staffRole.create({ data: { name: `Security ${tag}`, permissions: ["orders.view"] } });
    roleIds.push(customRole.id);
    const customMember = await newUser("custom-role", "SUPPORT");
    await db.user.update({ where: { id: customMember.id }, data: { staffRoleId: customRole.id } });
    const customToken = await stepOne(customMember.id);
    ok((await F.pendingState(customToken)).state === "setup" && !(await adapter.getSessionAndUser!(customToken)), "a newly created custom role inherits the required staff lock");
    const custToken = await stepOne(bob.id);
    ok(Boolean(await adapter.getSessionAndUser!(custToken)), "policy “all staff”: a customer without a method signs in normally");
    const staffToken = await stepOne(staff.id);
    const sp = await F.pendingState(staffToken);
    ok(sp.state === "setup" && (await adapter.getSessionAndUser!(staffToken)) === null, "policy “all staff”: a staff member without a method only gets a setup-pending session");
    if (sp.state !== "setup") throw new Error("expected setup");
    ok((await err(() => ticketRow("x".repeat(43), { pendingToken: staffToken }, ["setup"])))?.status === 401, "setup needs its own ticket");
    await F.sendSetupCode(sp);
    const setupTicket = await F.confirmSetupCode(sp, code(staff.email));
    const setupDone = await addFaceWith(setupTicket, { pendingToken: staffToken }, astroFrames, "Staff", ["setup"]);
    const staffSettings = await db.securitySettings.findUniqueOrThrow({ where: { userId: staff.id } });
    ok(setupDone.done === "signin" && staffSettings.secondStepEnabled && Boolean(await adapter.getSessionAndUser!(staffToken)), "after setup the staff member is signed in and the lock is on");
    const staffOff = await err(() => F.confirmManageCode(staff.id, staffToken, "123456", "disable", RP_ID));
    ok(staffOff?.status === 403, "when required, members can’t switch theirs off");
    const staffNext = await stepOne(staff.id);
    ok((await F.pendingState(staffNext)).state === "verify", "at the next sign-in the staff member is asked for the second step");
    await db.user.update({ where: { id: bob.id }, data: { role: "SUPPORT", staffRoleId: customRole.id } });
    ok((await adapter.getSessionAndUser!(customerBeforePromotion)) === null && (await F.pendingState(customerBeforePromotion)).state === "setup", "assigning a custom staff role gates the customer's already-open session");
    if (serverUp) {
      const page = await fetch(`${ORIGIN}/admin/security`, { headers: { cookie: `authjs.session-token=${staffToken}` } });
      const html = await page.text();
      ok(page.ok && html.includes("Lock now"), "verified support staff can manage their own lock inside admin");
      ok(!html.includes("Require a security lock for your team"), "support staff cannot see store-wide security policy controls");
    }
  } finally {
    // ── Clean up ── (runs even after a failure)
    if (policyBefore) await db.setting.update({ where: { key: S.POLICY_KEY }, data: { value: policyBefore.value ?? {} } });
    else await db.setting.deleteMany({ where: { key: S.POLICY_KEY } });
    await db.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await db.cart.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } }); // sessions + every security row cascade
    await db.staffRole.deleteMany({ where: { id: { in: roleIds } } });
    const left = await Promise.all([
      db.securitySettings.count({ where: { userId: { in: userIds } } }),
      db.passkey.count({ where: { userId: { in: userIds } } }),
      db.faceTemplate.count({ where: { userId: { in: userIds } } }),
      db.securityTicket.count({ where: { userId: { in: userIds } } }),
      db.session.count({ where: { userId: { in: userIds } } }),
      db.user.count({ where: { email: { endsWith: `@${DOMAIN}` } } }),
    ]);
    ok(left.every((n) => n === 0), `no test users, sessions or security rows left behind (${left.join("/")})`);
    console.log("cleaned up");
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
