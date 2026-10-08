import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/server/rate-limit";
import { isAllowedOrigin, rpIdOf } from "./config";
import { pendingSessionToken, sessionTokenFromCookies } from "./flows";
import { SecurityError, loadTicket, type Audience } from "./tickets";

const MAX_BODY = 4_000_000;

export type RouteCtx = {
  body: Record<string, unknown>;
  origin: string;
  rpId: string;
  secure: boolean;
  userAgent: string | null;
  ticket: (audiences: Audience[]) => ReturnType<typeof loadTicket>;
};

const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Shared wrapper for /api/security/*: POST + JSON only, Origin must be one of our allowed origins (CSRF; server
 * actions get the same check from Next), per-IP rate limit, and errors come back with the server's own wording.
 */
export async function securityRoute(req: NextRequest, limit: { bucket: string; max: number; windowSec: number }, handler: (ctx: RouteCtx) => Promise<unknown>) {
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin)) return json({ error: "This request didn’t come from our site." }, 403);
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return json({ error: "Expected JSON." }, 415);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return json({ error: "That request is too large." }, 413);
  if (!(await rateLimit(limit.bucket, limit.max, limit.windowSec)).ok) return json({ error: "Too many requests. Please wait a moment and try again." }, 429);

  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ error: "That request is too large." }, 413);
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "That request couldn’t be read." }, 400);
  }

  const [pendingToken, sessionToken] = await Promise.all([pendingSessionToken(), sessionTokenFromCookies()]);
  const forwardedProto = (req.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim();
  const ctx: RouteCtx = {
    body,
    origin,
    rpId: rpIdOf(origin),
    secure: forwardedProto ? forwardedProto === "https" : req.nextUrl.protocol === "https:",
    userAgent: req.headers.get("user-agent"),
    ticket: (audiences) => loadTicket(body.ticket, { audiences, pendingToken, sessionToken }),
  };
  try {
    return json(await handler(ctx));
  } catch (e) {
    if (e instanceof SecurityError) return json({ error: e.message, ...e.extra }, e.status);
    console.error("[security] request failed", e);
    return json({ error: "Something went wrong on our side. Please try again." }, 500);
  }
}
