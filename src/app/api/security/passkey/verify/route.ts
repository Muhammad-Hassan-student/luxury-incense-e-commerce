import type { NextRequest } from "next/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { securityRoute } from "@/server/security/http";
import { addPasskey, provePasskey } from "@/server/security/flows";
import { SecurityError } from "@/server/security/tickets";

export const runtime = "nodejs";

/** Verifies a phone-lock response: registration (adds it) or authentication (second step / switching off). */
export async function POST(req: NextRequest) {
  return securityRoute(req, { bucket: "sec-passkey-verify", max: 30, windowSec: 300 }, async (ctx) => {
    const response = ctx.body.response;
    if (!response || typeof response !== "object") throw new SecurityError("Missing phone lock response.", 400);
    if (ctx.body.purpose === "register") {
      const ticket = await ctx.ticket(["setup", "manage", "enroll"]);
      const name = typeof ctx.body.name === "string" ? ctx.body.name : undefined;
      return addPasskey(ticket, response as RegistrationResponseJSON, { name, userAgent: ctx.userAgent, secure: ctx.secure });
    }
    const ticket = await ctx.ticket(["signin", "manage"]);
    return provePasskey(ticket, response as AuthenticationResponseJSON, ctx.secure);
  });
}
