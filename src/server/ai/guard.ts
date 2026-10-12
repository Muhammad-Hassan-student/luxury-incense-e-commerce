import "server-only";
import { createHash } from "node:crypto";
import { env } from "@/env";

/** Concierge guardrails: limits, PII redaction and guest anonymisation. Pure helpers, easy to test. */

export const LIMITS = {
  /** Characters per shopper message. */
  maxMessageChars: 1200,
  /** Shopper turns per conversation before we suggest starting fresh / talking to a person. */
  maxTurns: 30,
  /** Model rounds (tool loops) per answer. */
  maxToolRounds: 5,
  /** Output tokens per model round. */
  maxOutputTokens: 1200,
  /** Earlier messages sent back as context (text only). */
  historyMessages: 12,
  /** Per identity (user or guest cookie) and per IP, per minute. */
  perIdentityPerMinute: 8,
  perIpPerMinute: 20,
  /** Per identity per day. */
  perIdentityPerDay: 120,
} as const;

// ─────────────────────────────── Rate limit ───────────────────────────────

const windows = new Map<string, { count: number; resetAt: number }>();

async function hit(key: string, limit: number, windowSec: number, now: number) {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      const res = await fetch(`${env.UPSTASH_REDIS_REST_URL}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` },
        body: JSON.stringify([
          ["INCR", key],
          ["EXPIRE", key, String(windowSec), "NX"],
        ]),
        cache: "no-store",
      });
      const data = (await res.json()) as [{ result: number }, unknown];
      return data[0].result <= limit;
    } catch {
      // fall through to the in-process window
    }
  }
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return true;
  }
  w.count++;
  return w.count <= limit;
}

/** Fixed windows per identity (minute + day) and per IP (minute). Identity/IP are hashed before use as keys. */
export async function conciergeRateLimit(identity: string, ip: string, now = Date.now()) {
  const id = hashId(identity);
  const ipKey = hashId(`ip:${ip}`);
  const checks = await Promise.all([
    hit(`rl:ai:id:${id}`, LIMITS.perIdentityPerMinute, 60, now),
    hit(`rl:ai:ip:${ipKey}`, LIMITS.perIpPerMinute, 60, now),
    hit(`rl:ai:day:${id}`, LIMITS.perIdentityPerDay, 86_400, now),
  ]);
  return { ok: checks.every(Boolean) };
}

/** Tests only. */
export const resetConciergeRateLimit = () => windows.clear();

// ─────────────────────────────── Privacy ───────────────────────────────

export const hashId = (v: string) => createHash("sha256").update(`maison-oud/ai:${v}`).digest("hex").slice(0, 32);

const PATTERNS: [RegExp, string][] = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
  // Card-like digit runs (13–19 digits, spaces/dashes allowed).
  [/\b(?:\d[ -]?){13,19}\b/g, "[number]"],
  // Phone numbers: +91 98765 43210, 0300-1234567, (022) 2345 6789…
  [/(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,5}\b/g, "[phone]"],
  // Indian PIN codes after "pin"/"pincode".
  [/\b(pin(?:code)?\s*[:#-]?\s*)\d{6}\b/gi, "$1[pin]"],
];

/** Removes emails, phone/card numbers and pincodes before anything is stored or logged. */
export function redactPII(text: string) {
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Order numbers (MO-24001) are kept: they're how a shopper refers to their own order. */
export const ORDER_NUMBER = /\bMO-\d{3,}\b/i;
