"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { rateLimit } from "@/server/rate-limit";
import { audit } from "@/server/audit";
import { currentRpId } from "@/server/security/adapter";
import { SESSION_COOKIES } from "@/server/security/config";
import { latestDevSecurityCode } from "@/server/security/email-code";
import { clearPendingCookie, confirmEnrollment, confirmSetupCode, issueSignInTicket, pendingSessionToken, pendingState, sendSetupCode, startEnrollment } from "@/server/security/flows";
import { methodSummary } from "@/server/security/state";
import { SecurityError } from "@/server/security/tickets";

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const fail = (e: unknown): { ok: false; error: string } => {
  if (e instanceof SecurityError) return { ok: false, error: e.message };
  console.error("[security] action failed", e);
  return { ok: false, error: "Something went wrong on our side. Please try again." };
};

export type StepTwoStart =
  | { state: "verify"; ticket: string; methods: { phone: boolean; face: boolean }; lockedMinutes: number | null }
  | { state: "setup" }
  | { state: "unavailable" }
  | { state: "done" | "expired" | "none" };

/** Called by /signin/verify on load: issues a fresh 5-minute sign-in ticket bound to the pending session. */
export async function beginStepTwo(): Promise<StepTwoStart> {
  if (!(await rateLimit("sec-step2-begin", 30, 300)).ok) throw new Error("Too many requests");
  const p = await pendingState(await pendingSessionToken());
  if (p.state === "verify") {
    const s = await methodSummary(p.userId, await currentRpId());
    if (!s.usablePhone && !s.usableFace) return { state: "unavailable" };
    const lockedMinutes = s.lockedUntil ? Math.max(1, Math.ceil((s.lockedUntil.getTime() - Date.now()) / 60_000)) : null;
    return { state: "verify", ticket: await issueSignInTicket(p), methods: { phone: s.usablePhone, face: s.usableFace }, lockedMinutes };
  }
  if (p.state === "setup") return { state: "setup" };
  await clearPendingCookie();
  return { state: p.state };
}

export async function sendSetupCodeAction(): Promise<Res<{ devCode: string | null }>> {
  try {
    const p = await pendingState(await pendingSessionToken());
    if (p.state !== "setup") return { ok: false, error: "Your sign-in has expired. Request a new sign-in link." };
    if (!(await rateLimit(`sec-code-send:${p.userId}`, 5, 600)).ok) return { ok: false, error: "Too many codes requested. Try again in a few minutes." };
    await sendSetupCode(p);
    return { ok: true, devCode: latestDevSecurityCode(p.email) };
  } catch (e) {
    return fail(e);
  }
}

export async function confirmSetupCodeAction(code: string): Promise<Res<{ ticket: string }>> {
  try {
    const p = await pendingState(await pendingSessionToken());
    if (p.state !== "setup") return { ok: false, error: "Your sign-in has expired. Request a new sign-in link." };
    if (!(await rateLimit(`sec-code-check:${p.userId}`, 10, 600)).ok) return { ok: false, error: "Too many tries. Wait a few minutes and request a new code." };
    return { ok: true, ticket: await confirmSetupCode(p, code) };
  } catch (e) {
    return fail(e);
  }
}

/** "Not you? Start again": drops the pending session and its cookies. */
export async function cancelStepTwo() {
  const token = await pendingSessionToken();
  if (token) {
    const row = await db.sessionSecondStep.findUnique({ where: { sessionToken: token }, select: { userId: true, verifiedAt: true } });
    if (row && !row.verifiedAt) {
      await db.session.deleteMany({ where: { sessionToken: token } });
      await audit(row.userId, "security.signin.cancelled", "User", row.userId).catch(() => {});
    }
  }
  await clearPendingCookie();
  const jar = await cookies();
  for (const name of SESSION_COOKIES) if (jar.get(name)?.value === token) jar.delete(name);
  redirect("/signin");
}

// ── Enrollment link (/signin/enroll#token) ──────────────────────────────────────────────────────────────────

export async function sendEnrollCodeAction(token: string, email: string): Promise<Res<{ devCode: string | null }>> {
  try {
    if (!(await rateLimit("sec-enroll-send", 5, 600)).ok) return { ok: false, error: "Too many codes requested. Try again in a few minutes." };
    await startEnrollment(token, email);
    return { ok: true, devCode: typeof email === "string" ? latestDevSecurityCode(email) : null };
  } catch (e) {
    return fail(e);
  }
}

export async function confirmEnrollCodeAction(token: string, email: string, code: string): Promise<Res<{ ticket: string }>> {
  try {
    if (!(await rateLimit("sec-enroll-check", 10, 600)).ok) return { ok: false, error: "Too many tries. Wait a few minutes and request a new code." };
    return { ok: true, ticket: await confirmEnrollment(token, email, code) };
  } catch (e) {
    return fail(e);
  }
}
