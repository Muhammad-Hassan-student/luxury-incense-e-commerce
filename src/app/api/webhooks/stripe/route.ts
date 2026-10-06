import type Stripe from "stripe";
import { env } from "@/env";
import { db } from "@/server/db";
import { cancelOrder, confirmOrder } from "@/server/orders";
import { stripe } from "@/server/payments";
import { firstDelivery } from "@/server/webhooks";

export async function POST(req: Request) {
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response("Stripe webhooks not configured", { status: 501 });
  const body = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  if (!(await firstDelivery(event.id, "stripe"))) return Response.json({ received: true, duplicate: true });

  try {
    if (event.type === "payment_intent.succeeded" || event.type === "payment_intent.payment_failed") {
      const intent = event.data.object;
      const payment = await db.payment.findUnique({ where: { providerRef: intent.id } });
      if (payment) {
        if (event.type === "payment_intent.succeeded") {
          await confirmOrder(payment.orderId, { captured: true, raw: { chargeId: String(intent.latest_charge ?? "") } });
        } else {
          await db.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
          await db.orderEvent.create({ data: { orderId: payment.orderId, status: "PENDING", message: "Card payment failed — customer may retry" } });
        }
      }
    } else if (event.type === "payment_intent.canceled") {
      const payment = await db.payment.findUnique({ where: { providerRef: event.data.object.id } });
      if (payment) await cancelOrder(payment.orderId, "Payment cancelled");
    }
  } catch (e) {
    // Let Stripe retry: forget the event so the retry isn't treated as a duplicate.
    await db.webhookEvent.delete({ where: { id: event.id } }).catch(() => {});
    console.error("[stripe webhook]", e);
    return new Response("Handler error", { status: 500 });
  }
  return Response.json({ received: true });
}
