import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import { db } from "./db";

/*
 * Marketing consent for customer journeys: per-email preference, signed unsubscribe links (no login needed),
 * and the per-email binding of personal journey coupons.
 */

export const normEmail = (email: string) => email.trim().toLowerCase();

/** Scrubbed (deleted-account) and malformed addresses are never mailed. */
export const isMailableEmail = (email: string) => /^[^@\s]+@[^@\s]+\.[^@\s.]+$/.test(email) && !/\.invalid$/i.test(email) && !/^deleted-/i.test(email);

// ─────────────────────────────── Signed unsubscribe tokens ───────────────────────────────

const PURPOSE = "journeys-unsubscribe:v1:";
const sign = (email: string) => createHmac("sha256", env.AUTH_SECRET).update(PURPOSE + normEmail(email)).digest("base64url");

/** `<base64url(email)>.<hmac>` — tied to the address, never expires, useless for anything but opting out. */
export function unsubscribeToken(email: string) {
  return `${Buffer.from(normEmail(email)).toString("base64url")}.${sign(email)}`;
}

/** The email a token was issued for, or null when it was altered or forged (constant-time comparison). */
export function verifyUnsubscribeToken(token: unknown): string | null {
  if (typeof token !== "string" || token.length > 600) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  let email: string;
  try {
    email = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!email.includes("@") || email !== normEmail(email)) return null;
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(email));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return email;
}

const site = () => env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
export const unsubscribePageUrl = (email: string) => `${site()}/unsubscribe?t=${encodeURIComponent(unsubscribeToken(email))}`;
export const oneClickUnsubscribeUrl = (email: string) => `${site()}/api/unsubscribe?t=${encodeURIComponent(unsubscribeToken(email))}`;

/** RFC 8058 one-click headers for marketing mail. */
export const listUnsubscribeHeaders = (email: string): Record<string, string> => ({
  "List-Unsubscribe": `<${oneClickUnsubscribeUrl(email)}>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
});

// ─────────────────────────────── Preferences ───────────────────────────────

export async function journeyEmailsAllowed(email: string) {
  const pref = await db.marketingPreference.findUnique({ where: { email: normEmail(email) }, select: { journeys: true } });
  return pref?.journeys ?? true;
}

export async function setJourneyEmails(email: string, allowed: boolean, source: "account" | "link" | "one-click") {
  const key = normEmail(email);
  await db.marketingPreference.upsert({ where: { email: key }, update: { journeys: allowed, source }, create: { email: key, journeys: allowed, source } });
  if (!allowed) {
    // Stop any run in flight straight away (the engine re-checks too).
    await db.journeyEnrollment.updateMany({
      where: { status: "ACTIVE", user: { email: { equals: key, mode: "insensitive" } } },
      data: { status: "EXITED", exitReason: "opted out", exitedAt: new Date(), nextRunAt: null },
    });
  }
}

// ─────────────────────────────── Personal coupons ───────────────────────────────

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
/** Unguessable code: prefix + 12 random characters (60 bits). */
export function personalCouponCode(prefix: string) {
  const bytes = randomBytes(12);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}-${out}`;
}

/**
 * Journey codes are single use and bound to the address they were sent to. Returns a customer-facing problem, or null.
 * `email` null (a guest bag before checkout) skips the address check — checkout runs it again with the order email.
 */
export async function personalCouponProblem(code: string, email: string | null): Promise<string | null> {
  const bound = await db.journeyMessage.findUnique({ where: { couponCode: code }, select: { email: true } });
  if (!bound) return null;
  if (email !== null && normEmail(bound.email) !== normEmail(email)) return "This code is personal to another email address.";
  const used = await db.order.count({ where: { couponCode: code, status: { not: "CANCELLED" } } });
  return used > 0 ? "This code has already been used." : null;
}
