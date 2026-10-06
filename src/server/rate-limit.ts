import "server-only";
import { headers } from "next/headers";
import { env } from "@/env";

const memory = new Map<string, { count: number; resetAt: number }>();

async function upstashIncr(key: string, windowSec: number) {
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
  return data[0].result;
}

/**
 * Fixed-window limiter keyed by client IP + bucket. Uses Upstash when configured,
 * otherwise an in-process map (fine for a single server / dev).
 */
export async function rateLimit(bucket: string, limit: number, windowSec: number) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
  const key = `rl:${bucket}:${ip}`;

  let count: number;
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    count = await upstashIncr(key, windowSec).catch(() => 0);
  } else {
    const now = Date.now();
    const hit = memory.get(key);
    if (!hit || hit.resetAt < now) memory.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    else hit.count++;
    count = memory.get(key)!.count;
  }
  return { ok: count <= limit };
}
