import { cookies, headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { rateLimit } from "@/server/rate-limit";
import { DEVICE_COOKIE, noteAffiliateDevice, recordClick } from "@/server/affiliates";

// Affiliate pings from the storefront:
//   { type: "click", code }  → click stats for ?aff= links (attribution uses the cookie set by src/proxy.ts)
//   { type: "self" }         → the signed-in affiliate's own device/IP, so their own orders get flagged
const body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), code: z.string().min(4).max(20), path: z.string().max(300).nullish(), referrer: z.string().max(300).nullish() }),
  z.object({ type: z.literal("self") }),
]);

export async function POST(req: Request) {
  if (!(await rateLimit("aff", 30, 60)).ok) return Response.json({ ok: false }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false }, { status: 400 });
  const [jar, h] = await Promise.all([cookies(), headers()]);
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;
  let deviceId = jar.get(DEVICE_COOKIE)?.value ?? null;
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    jar.set(DEVICE_COOKIE, deviceId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365, path: "/" });
  }
  if (parsed.data.type === "click") {
    const r = await recordClick({ code: parsed.data.code, ip, deviceId, path: parsed.data.path, referrer: parsed.data.referrer });
    return Response.json({ ok: r.ok });
  }
  const session = await auth();
  if (!session?.user) return Response.json({ ok: false }, { status: 401 });
  const a = await db.affiliate.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (a) await noteAffiliateDevice(a.id, ip, deviceId);
  return Response.json({ ok: Boolean(a) });
}
