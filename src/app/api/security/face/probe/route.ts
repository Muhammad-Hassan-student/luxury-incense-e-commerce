import type { NextRequest } from "next/server";
import { securityRoute } from "@/server/security/http";
import { probeFrame } from "@/server/security/face";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Live camera guidance: a small 320px JPEG in, {faces, size, x, y} out. No recognition and nothing stored. Only
 * works with a valid sign-in / setup / add-face / enrollment ticket.
 */
export async function POST(req: NextRequest) {
  return securityRoute(req, { bucket: "sec-face-probe", max: 400, windowSec: 60 }, async (ctx) => {
    await ctx.ticket(["signin", "setup", "manage", "enroll"]);
    return probeFrame(ctx.body.frame);
  });
}
