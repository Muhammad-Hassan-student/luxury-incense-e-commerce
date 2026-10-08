import type { NextRequest } from "next/server";
import { rateLimit } from "@/server/rate-limit";
import { setJourneyEmails, verifyUnsubscribeToken } from "@/server/marketing";

/** RFC 8058 one-click unsubscribe (List-Unsubscribe-Post). The signed token is the only credential. */
export async function POST(req: NextRequest) {
  if (!(await rateLimit("unsubscribe", 20, 60)).ok) return new Response("Too many requests", { status: 429 });
  const email = verifyUnsubscribeToken(req.nextUrl.searchParams.get("t"));
  if (!email) return new Response("Invalid link", { status: 400 });
  await setJourneyEmails(email, false, "one-click");
  return new Response("Unsubscribed", { status: 200 });
}

/** A plain visit never changes anything (link scanners) — show the confirmation page instead. */
export function GET(req: NextRequest) {
  const url = new URL("/unsubscribe", req.nextUrl.origin);
  const t = req.nextUrl.searchParams.get("t");
  if (t) url.searchParams.set("t", t);
  return Response.redirect(url, 303);
}
