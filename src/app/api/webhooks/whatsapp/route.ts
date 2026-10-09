import { handleWebhook, verifySignature, verifySubscription } from "@/server/whatsapp/inbound";

/** Meta's subscription check: echo hub.challenge when hub.verify_token matches the saved verify token. */
export async function GET(req: Request) {
  const challenge = await verifySubscription(new URL(req.url).searchParams);
  if (!challenge) return new Response("Forbidden", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

/** Delivery receipts and customer replies. Signed with the app secret (X-Hub-Signature-256). */
export async function POST(req: Request) {
  const body = await req.text();
  if (body.length > 1_000_000) return new Response("Too large", { status: 413 });
  if (!(await verifySignature(body, req.headers.get("x-hub-signature-256")))) return new Response("Invalid signature", { status: 401 });
  try {
    const r = await handleWebhook(body);
    return Response.json({ received: true, statuses: r.statuses, messages: r.messages, duplicates: r.duplicates });
  } catch (e) {
    // 500 makes Meta retry; inbound messages are idempotent by wamid.
    console.error("[whatsapp webhook]", e instanceof Error ? e.message : e);
    return new Response("Handler error", { status: 500 });
  }
}
