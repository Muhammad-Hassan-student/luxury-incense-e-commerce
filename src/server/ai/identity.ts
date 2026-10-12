import "server-only";
import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { auth } from "@/auth";
import type { ConciergeWho } from "./concierge";

export const GUEST_COOKIE = "mo_ai";

/**
 * Who is chatting. Guests get a random httpOnly cookie id (only its hash is stored with the chat);
 * no IP or user agent is ever stored. Call from Route Handlers / Server Actions (may set the cookie).
 */
export async function conciergeWho(opts: { createGuest?: boolean; page?: string | null } = {}): Promise<ConciergeWho> {
  const [session, jar, h] = await Promise.all([auth(), cookies(), headers()]);
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
  const locale = jar.get("NEXT_LOCALE")?.value === "ar" ? "ar" : "en";
  let guestId = jar.get(GUEST_COOKIE)?.value ?? null;
  if (guestId && !/^[a-f0-9]{32}$/.test(guestId)) guestId = null;
  if (!session?.user && !guestId && opts.createGuest) {
    guestId = randomBytes(16).toString("hex");
    jar.set(GUEST_COOKIE, guestId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30, path: "/" });
  }
  return { userId: session?.user?.id ?? null, guestId: session?.user ? null : guestId, ip, locale, page: opts.page ?? null };
}
