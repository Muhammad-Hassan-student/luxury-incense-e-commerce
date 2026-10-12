import { publicHealth } from "@/server/monitoring/health";

/**
 * Uptime probe for an external monitor (UptimeRobot, Better Stack…): 200 {"ok":true,…} when the app and database
 * answer, 503 otherwise. Public on purpose — returns only the DB round-trip time and the deployed commit.
 */
export async function GET() {
  const h = await publicHealth();
  return Response.json(h, { status: h.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

export async function HEAD() {
  const h = await publicHealth();
  return new Response(null, { status: h.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
