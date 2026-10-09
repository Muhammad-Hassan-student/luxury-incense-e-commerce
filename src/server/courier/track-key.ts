import "server-only";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { env } from "@/env";

/*
 * Signed tracking links: /track?order=MO-…&k=… opens the timeline without asking for email/phone.
 * The key is an HMAC of the order number, so it can't be guessed for other orders.
 */

const secret = () => Buffer.from(hkdfSync("sha256", env.AUTH_SECRET, "maison-oud/track", "track-link-v1", 32));

export const trackKey = (number: string) => createHmac("sha256", secret()).update(`track:${number.toUpperCase()}`).digest("base64url").slice(0, 22);

export function validTrackKey(number: string, key: string | null | undefined) {
  if (!key) return false;
  const a = Buffer.from(trackKey(number));
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

const site = () => (process.env.NEXT_PUBLIC_SITE_URL ?? env.NEXT_PUBLIC_SITE_URL).replace(/\/$/, "");

/** Absolute signed tracking URL for emails and messages. */
export const trackUrlFor = (number: string) => `${site()}/track?order=${encodeURIComponent(number)}&k=${trackKey(number)}`;
