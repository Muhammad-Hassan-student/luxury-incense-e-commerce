import "server-only";
import type { SecurityTicket } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { SECOND_STEP } from "./config";
import { hashToken, randomToken } from "./crypto";

/**
 * Tickets are short-lived, single-use permissions for exactly one security step, stored hashed:
 *  - signin  — prove a saved method for a pending step-1 session (bound to that session token)
 *  - setup   — add the first method when the admin policy requires one (bound to the pending session)
 *  - manage  — add a method ("add" / "add+enable") or switch the lock off ("disable") from a fully verified session
 *  - enroll  — add a method through a one-time enrollment link (bound to the link; never creates a session)
 */
export type Audience = "signin" | "setup" | "manage" | "enroll";
export type Scope = "add" | "add+enable" | "disable";

export class SecurityError extends Error {
  constructor(
    message: string,
    public status = 400,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function issueTicket(input: { audience: Audience; userId: string; sessionToken?: string | null; enrollmentLinkId?: string | null; scope?: Scope | null }) {
  const token = randomToken();
  await db.securityTicket.create({
    data: {
      tokenHash: hashToken(token),
      audience: input.audience,
      scope: input.scope ?? null,
      userId: input.userId,
      sessionToken: input.sessionToken ?? null,
      enrollmentLinkId: input.enrollmentLinkId ?? null,
      expiresAt: new Date(Date.now() + SECOND_STEP.ticketMs),
    },
  });
  // Opportunistic cleanup of old tickets/challenges; never blocks the caller.
  void db.securityTicket.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 3600_000) } } }).catch(() => {});
  void db.webAuthnChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
  return token;
}

export type TicketRow = SecurityTicket;

/**
 * Loads a ticket and checks audience, expiry, single use and binding:
 *  - signin/setup tickets must come with the same pending session token, still pending and unexpired;
 *  - manage tickets must come from the same (verified) session that asked for them;
 *  - enroll tickets need their link to be unused and unexpired.
 */
export async function loadTicket(token: unknown, ctx: { audiences: Audience[]; pendingToken?: string | null; sessionToken?: string | null }): Promise<TicketRow> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) throw new SecurityError("This check has expired. Please start again.", 401);
  const t = await db.securityTicket.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!t || t.usedAt || t.expiresAt < new Date() || !ctx.audiences.includes(t.audience as Audience)) {
    throw new SecurityError("This check has expired. Please start again.", 401);
  }
  if (t.audience === "signin" || t.audience === "setup" || t.audience === "manage") {
    // Step-2 tickets travel with the pending-session cookie; manage tickets with the normal session cookie.
    const presented = t.audience === "manage" ? ctx.sessionToken : ctx.pendingToken;
    if (!t.sessionToken || !presented || t.sessionToken !== presented) throw new SecurityError("This check belongs to another sign-in.", 401);
    const session = await db.session.findUnique({ where: { sessionToken: t.sessionToken }, select: { expires: true, userId: true, secondStep: { select: { verifiedAt: true } } } });
    if (!session || session.expires < new Date() || session.userId !== t.userId) throw new SecurityError("Your sign-in has expired. Request a new sign-in link.", 401);
    const pending = Boolean(session.secondStep && !session.secondStep.verifiedAt);
    // Step-2 tickets only work while the session is pending; manage tickets only from a fully verified session.
    if ((t.audience === "manage") === pending) throw new SecurityError("This check has expired. Please start again.", 401);
  }
  if (t.audience === "enroll") {
    const link = t.enrollmentLinkId ? await db.enrollmentLink.findUnique({ where: { id: t.enrollmentLinkId } }) : null;
    if (!link || link.usedAt || link.expiresAt < new Date() || link.userId !== t.userId) throw new SecurityError("This link has already been used or has expired.", 410);
  }
  return t;
}

/** Atomically marks a ticket used. Returns false if someone else used it first. */
export async function consumeTicket(id: string) {
  const r = await db.securityTicket.updateMany({ where: { id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  return r.count === 1;
}
