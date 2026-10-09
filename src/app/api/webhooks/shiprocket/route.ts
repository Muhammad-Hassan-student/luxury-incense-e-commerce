import { getIntegration } from "@/server/integrations";
import { handleCourierWebhook } from "@/server/courier/fulfilment";

export const dynamic = "force-dynamic";

/**
 * Shiprocket tracking webhook. Authenticated by the `x-api-key` header (the token saved in
 * Admin → Integrations → Courier), compared in constant time. Replays are no-ops.
 *
 * Shiprocket rejects webhook URLs containing "shiprocket", so register /api/webhooks/courier there —
 * it is the same handler.
 */
export async function POST(req: Request) {
  const body = await req.text();
  if (body.length > 256_000) return Response.json({ error: "Payload too large" }, { status: 413 });
  const { webhookToken } = await getIntegration("courier");
  try {
    const res = await handleCourierWebhook(body, req.headers.get("x-api-key"), webhookToken);
    return Response.json(res.body, { status: res.status });
  } catch (e) {
    console.error("[courier webhook]", e instanceof Error ? e.message : e);
    return Response.json({ error: "Handler error" }, { status: 500 });
  }
}
