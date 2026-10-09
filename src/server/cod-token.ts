import "server-only";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { hashToken } from "./security/crypto";

/*
 * COD confirmation link token: `<base64url(orderId)>.<HMAC>`. Signed (forgeries are rejected before any database
 * read), single-use (the order stores only its SHA-256, cleared once the customer answers) and expiring (valid only
 * while the order is still awaiting confirmation and before its confirm-by time). Deterministic per order, so the
 * reminder repeats the same link instead of invalidating the first one.
 */

function key() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET is required for COD confirmation links.");
  return Buffer.from(hkdfSync("sha256", s, "maison-oud/cod-confirm", "cod-confirm-link-v1", 32));
}

const mac = (orderId: string) => createHmac("sha256", key()).update(`cod-confirm:${orderId}`).digest("base64url");

export function codToken(orderId: string) {
  return `${Buffer.from(orderId, "utf8").toString("base64url")}.${mac(orderId)}`;
}

export const codTokenHash = (token: string) => hashToken(token);

/** The order id a token was issued for, or null if it was altered/forged. Constant-time comparison. */
export function verifyCodToken(token: unknown): string | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  let orderId: string;
  try {
    orderId = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!/^[a-z0-9]{10,40}$/i.test(orderId)) return null;
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(orderId));
  return given.length === expected.length && timingSafeEqual(given, expected) ? orderId : null;
}
