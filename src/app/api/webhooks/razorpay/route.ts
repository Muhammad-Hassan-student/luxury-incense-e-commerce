import { db } from "@/server/db";
import { confirmOrder } from "@/server/orders";
import { verifyRazorpayWebhook } from "@/server/payments";
import { firstDelivery } from "@/server/webhooks";

type RazorpayEvent = {
  event: string;
  payload: { payment?: { entity: { id: string; order_id: string; status: string } } };
};

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  if (!(await verifyRazorpayWebhook(body, signature))) return new Response("Invalid signature", { status: 400 });

  const eventId = req.headers.get("x-razorpay-event-id");
  if (eventId && !(await firstDelivery(eventId, "razorpay"))) return Response.json({ received: true, duplicate: true });

  const event = JSON.parse(body) as RazorpayEvent;
  const entity = event.payload.payment?.entity;
  try {
    if (entity && (event.event === "payment.captured" || event.event === "order.paid")) {
      const payment = await db.payment.findUnique({ where: { providerRef: entity.order_id } });
      if (payment) await confirmOrder(payment.orderId, { captured: true, raw: { paymentId: entity.id } });
    } else if (entity && event.event === "payment.failed") {
      const payment = await db.payment.findUnique({ where: { providerRef: entity.order_id } });
      if (payment) {
        await db.orderEvent.create({ data: { orderId: payment.orderId, status: "PENDING", message: "Payment attempt failed — customer may retry" } });
      }
    }
  } catch (e) {
    if (eventId) await db.webhookEvent.delete({ where: { id: eventId } }).catch(() => {});
    console.error("[razorpay webhook]", e);
    return new Response("Handler error", { status: 500 });
  }
  return Response.json({ received: true });
}
