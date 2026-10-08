import "server-only";
import { db } from "@/server/db";
import { sendEmail } from "@/server/email";
import { devMagicLinksEnabled } from "@/server/dev-magic-link";
import { SecurityCodeEmail } from "@/emails/security-code";
import { SECOND_STEP } from "./config";
import { hashCode, randomCode, safeEqualHex } from "./crypto";
import { SecurityError } from "./tickets";

export type CodePurpose = "manage" | "enroll" | "setup";

/** Local development only (no Resend key): remember the latest code per email so the UI can show it. */
const devStore = globalThis as unknown as { __moDevSecurityCodes?: Map<string, { code: string; at: number }> };
export function latestDevSecurityCode(email: string): string | null {
  if (!devMagicLinksEnabled()) return null;
  const e = devStore.__moDevSecurityCodes?.get(email.toLowerCase());
  return e && Date.now() - e.at < SECOND_STEP.codeMs ? e.code : null;
}

const wording: Record<CodePurpose, string> = {
  manage: "to change your sign-in security",
  setup: "to set up Face ID or phone lock",
  enroll: "to add a phone or face to your account through a shared link",
};

/** Sends a fresh 6-digit code. Older unused codes for the same purpose stop working. Only an HMAC is stored. */
export async function sendSecurityCode(user: { id: string; email: string }, purpose: CodePurpose, enrollmentLinkId?: string) {
  const code = randomCode();
  await db.securityEmailCode.updateMany({ where: { userId: user.id, purpose, usedAt: null }, data: { usedAt: new Date() } });
  const row = await db.securityEmailCode.create({
    data: { userId: user.id, purpose, enrollmentLinkId: enrollmentLinkId ?? null, codeHash: "pending", expiresAt: new Date(Date.now() + SECOND_STEP.codeMs) },
  });
  await db.securityEmailCode.update({ where: { id: row.id }, data: { codeHash: hashCode(row.id, code) } });
  if (devMagicLinksEnabled()) {
    devStore.__moDevSecurityCodes ??= new Map();
    devStore.__moDevSecurityCodes.set(user.email.toLowerCase(), { code, at: Date.now() });
  }
  await sendEmail({
    to: user.email,
    subject: `${code} is your Maison Oud security code`,
    react: SecurityCodeEmail({ code, reason: wording[purpose] }),
    devLog: `Security code for ${user.email} (${purpose}): ${code}`,
  });
}

/**
 * Checks a code: 10-minute expiry, single use, max 5 attempts (each wrong guess is counted atomically before
 * comparing, so parallel guesses can't exceed the limit).
 */
export async function verifySecurityCode(userId: string, purpose: CodePurpose, code: unknown, enrollmentLinkId?: string) {
  const fail = new SecurityError("That code isn’t right or has expired. Request a new one.", 400);
  if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) throw fail;
  const row = await db.securityEmailCode.findFirst({
    where: { userId, purpose, usedAt: null, expiresAt: { gt: new Date() }, ...(enrollmentLinkId ? { enrollmentLinkId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  if (!row) throw fail;
  const counted = await db.securityEmailCode.updateMany({ where: { id: row.id, usedAt: null, attempts: { lt: SECOND_STEP.codeMaxAttempts } }, data: { attempts: { increment: 1 } } });
  if (counted.count !== 1) throw new SecurityError("Too many wrong codes. Request a new one.", 429);
  if (!safeEqualHex(row.codeHash, hashCode(row.id, code.trim()))) throw fail;
  const used = await db.securityEmailCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (used.count !== 1) throw fail;
}
