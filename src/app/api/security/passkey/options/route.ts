import type { NextRequest } from "next/server";
import { securityRoute } from "@/server/security/http";
import { authenticationOptions, registrationOptions } from "@/server/security/passkeys";
import { assertNotLocked } from "@/server/security/lockout";
import { assertAddTicket, assertProveTicket } from "@/server/security/flows";

export const runtime = "nodejs";

/** WebAuthn options for adding a phone lock (purpose "register") or proving one (purpose "authenticate"). */
export async function POST(req: NextRequest) {
  return securityRoute(req, { bucket: "sec-passkey-options", max: 30, windowSec: 300 }, async (ctx) => {
    if (ctx.body.purpose === "register") {
      const ticket = await ctx.ticket(["setup", "manage", "enroll"]);
      assertAddTicket(ticket);
      return { options: await registrationOptions(ticket, ctx.rpId) };
    }
    const ticket = await ctx.ticket(["signin", "manage"]);
    assertProveTicket(ticket);
    await assertNotLocked(ticket.userId);
    return { options: await authenticationOptions(ticket, ctx.rpId) };
  });
}
