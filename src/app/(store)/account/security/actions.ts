"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { rateLimit } from "@/server/rate-limit";
import { currentRpId, setPendingCookie } from "@/server/security/adapter";
import { latestDevSecurityCode } from "@/server/security/email-code";
import { confirmManageCode, createEnrollmentLink, enableSecondStep, lockSession, removeMethod, sendManageCode, sessionTokenFromCookies, setMethodEnabled } from "@/server/security/flows";
import { headers } from "next/headers";
import { originFromHeaders } from "@/server/security/config";
import { SecurityError, type Scope } from "@/server/security/tickets";

type Res<T = object> = ({ ok: true; message?: string } & T) | { ok: false; error: string };

const fail = (e: unknown): { ok: false; error: string } => {
  if (e instanceof SecurityError) return { ok: false, error: e.message };
  console.error("[security] action failed", e);
  return { ok: false, error: "Something went wrong on our side. Please try again." };
};

/** A fully verified session (auth() already treats a pending one as signed out) + its token. */
async function verified() {
  const session = await auth();
  const token = await sessionTokenFromCookies();
  if (!session?.user || !token) throw new SecurityError("Please sign in again.", 401);
  return { userId: session.user.id, email: session.user.email ?? "", token };
}

const done = () => revalidatePath("/", "layout");

export async function sendManageCodeAction(): Promise<Res<{ devCode: string | null }>> {
  try {
    const me = await verified();
    if (!(await rateLimit(`sec-code-send:${me.userId}`, 5, 600)).ok) return { ok: false, error: "Too many codes requested. Try again in a few minutes." };
    await sendManageCode(me.userId);
    return { ok: true, devCode: latestDevSecurityCode(me.email) };
  } catch (e) {
    return fail(e);
  }
}

export async function confirmManageCodeAction(code: string, scope: Scope): Promise<Res<{ ticket: string }>> {
  try {
    const me = await verified();
    if (!["add", "add+enable", "disable"].includes(scope)) return { ok: false, error: "Unknown request." };
    if (!(await rateLimit(`sec-code-check:${me.userId}`, 10, 600)).ok) return { ok: false, error: "Too many tries. Wait a few minutes and request a new code." };
    return { ok: true, ticket: await confirmManageCode(me.userId, me.token, code, scope, await currentRpId()) };
  } catch (e) {
    return fail(e);
  }
}

/** Master switch ON. One tap when a method is saved; otherwise the page opens setup. */
export async function turnOnAction(): Promise<Res<{ needsSetup?: boolean }>> {
  try {
    const me = await verified();
    if (!(await rateLimit("sec-settings", 30, 300)).ok) return { ok: false, error: "Too many changes. Wait a moment." };
    const r = await enableSecondStep(me.userId, await currentRpId());
    if (!r.ok) return { ok: true, needsSetup: true };
    await lockSession(me.userId, me.token, await currentRpId());
    await setPendingCookie(me.token);
    done();
    return { ok: true, message: "Face ID / phone lock is now on for your sign-ins" };
  } catch (e) {
    return fail(e);
  }
}

export async function lockNowAction(): Promise<Res> {
  try {
    const me = await verified();
    if (!(await rateLimit("sec-settings", 30, 300)).ok) return { ok: false, error: "Too many changes. Wait a moment." };
    await lockSession(me.userId, me.token, await currentRpId());
    await setPendingCookie(me.token);
    done();
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function setMethodAction(method: "phone" | "face", enabled: boolean): Promise<Res> {
  try {
    const me = await verified();
    if (method !== "phone" && method !== "face") return { ok: false, error: "Unknown method." };
    if (!(await rateLimit("sec-settings", 30, 300)).ok) return { ok: false, error: "Too many changes. Wait a moment." };
    await setMethodEnabled(me.userId, await currentRpId(), method, Boolean(enabled));
    done();
    const what = method === "phone" ? "Phone lock" : "Camera face check";
    return { ok: true, message: `${what} is now ${enabled ? "on" : "off"} for your sign-ins` };
  } catch (e) {
    return fail(e);
  }
}

export async function removeMethodAction(kind: "phone" | "face", id: string): Promise<Res> {
  try {
    const me = await verified();
    if ((kind !== "phone" && kind !== "face") || typeof id !== "string") return { ok: false, error: "Unknown item." };
    if (!(await rateLimit("sec-settings", 30, 300)).ok) return { ok: false, error: "Too many changes. Wait a moment." };
    await removeMethod(me.userId, await currentRpId(), kind, id);
    done();
    return { ok: true, message: kind === "phone" ? "Phone lock removed" : "Face removed" };
  } catch (e) {
    return fail(e);
  }
}

export async function createEnrollLinkAction(): Promise<Res<{ url: string; expiresAt: string }>> {
  try {
    const me = await verified();
    if (!(await rateLimit("sec-enroll-link", 5, 3600)).ok) return { ok: false, error: "Too many links made. Try again later." };
    const user = await db.user.findUniqueOrThrow({ where: { id: me.userId }, select: { id: true } });
    const { token, expiresAt } = await createEnrollmentLink(user.id);
    return { ok: true, url: `${originFromHeaders(await headers())}/signin/enroll#${token}`, expiresAt: expiresAt.toISOString() };
  } catch (e) {
    return fail(e);
  }
}
