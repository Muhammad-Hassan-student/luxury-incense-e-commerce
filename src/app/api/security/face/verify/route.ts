import type { NextRequest } from "next/server";
import { securityRoute } from "@/server/security/http";
import { addFace, proveFace } from "@/server/security/flows";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Three camera frames: either saves a new face (purpose "add") or checks them against saved faces ("prove"). */
export async function POST(req: NextRequest) {
  return securityRoute(req, { bucket: "sec-face-verify", max: 20, windowSec: 300 }, async (ctx) => {
    if (ctx.body.purpose === "add") {
      const ticket = await ctx.ticket(["setup", "manage", "enroll"]);
      const label = typeof ctx.body.label === "string" ? ctx.body.label : "";
      return addFace(ticket, ctx.body.frames, label, ctx.secure);
    }
    const ticket = await ctx.ticket(["signin", "manage"]);
    return proveFace(ticket, ctx.body.frames, ctx.secure);
  });
}
