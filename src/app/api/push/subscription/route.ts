import { z } from "zod";
import { auth } from "@/auth";
import { rateLimit } from "@/server/rate-limit";
import { pushClientConfig, PushError, removeSubscription, saveSubscription } from "@/server/push";

/*
 * Web push subscriptions for the signed-in customer. A route handler (not a server action) because the service worker
 * calls it too, when the browser rotates a subscription (pushsubscriptionchange).
 */

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  return Response.json(await pushClientConfig(), { headers: noStore });
}

const subscribeSchema = z.object({
  subscription: z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }),
  replaces: z.string().url().max(1000).nullish(),
  locale: z.enum(["en", "ar"]).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to turn on notifications." }, { status: 401, headers: noStore });
  if (!(await rateLimit("push-subscribe", 20, 600)).ok) return Response.json({ error: "Too many attempts." }, { status: 429, headers: noStore });
  const parsed = subscribeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid subscription." }, { status: 400, headers: noStore });
  const { subscription, replaces, locale } = parsed.data;
  try {
    await saveSubscription({ userId: session.user.id, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, userAgent: req.headers.get("user-agent"), locale: locale ?? null, replaces: replaces ?? null });
  } catch (e) {
    if (e instanceof PushError) return Response.json({ error: e.message }, { status: 400, headers: noStore });
    throw e;
  }
  return Response.json({ ok: true }, { headers: noStore });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Not signed in." }, { status: 401, headers: noStore });
  const parsed = z.object({ endpoint: z.string().url().max(1000) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400, headers: noStore });
  const removed = await removeSubscription(parsed.data.endpoint, session.user.id);
  return Response.json({ ok: true, removed }, { headers: noStore });
}
