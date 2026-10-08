import "server-only";
import type { Adapter, AdapterSession } from "next-auth/adapters";
import { cookies, headers } from "next/headers";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { PENDING_COOKIE, SECOND_STEP, originFromHeaders, primaryOrigin, rpIdOf } from "./config";
import { isSessionPending, secondStepRequirement } from "./state";

/** rpId of the current request (falls back to the primary site outside a request, e.g. in scripts). */
export async function currentRpId() {
  try {
    return rpIdOf(originFromHeaders(await headers()));
  } catch {
    return rpIdOf(primaryOrigin());
  }
}

async function requestIsHttps() {
  try {
    const h = await headers();
    return (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https";
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

/** Remembers the pending session token in our own httpOnly cookie (Auth.js may clear its cookie for a pending session). */
export async function setPendingCookie(sessionToken: string) {
  try {
    (await cookies()).set(PENDING_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: await requestIsHttps(),
      path: "/",
      // A little longer than the pending session so /signin/verify can still say "this sign-in expired".
      maxAge: Math.round((SECOND_STEP.pendingMs * 2) / 1000),
    });
  } catch {
    /* outside a request (scripts/tests) — nothing to set */
  }
}

/**
 * Wraps the Auth.js adapter so that step 1 (magic link / Google) never creates a usable session on its own when the
 * user's second step is on:
 *  - createSession: the session row expires in 5 minutes and gets a pending SessionSecondStep marker;
 *  - getSessionAndUser: a pending session reads as "no session" — so auth(), /api/auth/session, server actions,
 *    route handlers, admin, account, checkout and the trade portal all see a signed-out visitor.
 * Only /signin/verify (step 2) can mark it verified and extend it to the normal 30 days.
 */
export function withSecondStep(base: Adapter): Adapter {
  return {
    ...base,
    async createSession(data) {
      const mode = await secondStepRequirement(data.userId, await currentRpId());
      if (!mode) return base.createSession!(data);
      const expires = new Date(Date.now() + SECOND_STEP.pendingMs);
      await db.$transaction([
        db.session.create({ data: { sessionToken: data.sessionToken, userId: data.userId, expires } }),
        db.sessionSecondStep.create({ data: { sessionToken: data.sessionToken, userId: data.userId, mode } }),
      ]);
      await setPendingCookie(data.sessionToken);
      await audit(data.userId, mode === "setup" ? "security.signin.setup_required" : "security.signin.pending", "User", data.userId).catch(() => {});
      // Auth.js uses this expiry for its cookie: keep the normal lifetime so the cookie survives step 2.
      // The database row (5 minutes) is what actually decides whether the session is valid.
      return { sessionToken: data.sessionToken, userId: data.userId, expires: data.expires } satisfies AdapterSession;
    },
    async getSessionAndUser(sessionToken) {
      const found = await base.getSessionAndUser!(sessionToken);
      if (!found) return null;
      if (await isSessionPending(sessionToken)) return null;
      return found;
    },
  };
}
