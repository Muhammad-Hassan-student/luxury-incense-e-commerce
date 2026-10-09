import "server-only";
import { db } from "./db";
import { sendServerPurchase } from "./tracking";
import { createSubscriptionsForOrder, settleRenewalPaid } from "./subscriptions";

/**
 * Side effects of an order being confirmed for the first time (called by confirmOrder). Never throws:
 *   • Subscribe & Save: start subscriptions for paid subscribe lines; settle a renewal that was just paid.
 *   • Server-side purchase events (GA4 MP + Meta CAPI), after the response when inside a request.
 */
export async function afterOrderConfirmed(orderId: string) {
  try {
    const payment = await db.payment.findFirst({ where: { orderId }, orderBy: { createdAt: "asc" }, select: { status: true, raw: true } });
    if (payment?.status === "CAPTURED") {
      const renewalId = (payment.raw as { renewalId?: string } | null)?.renewalId;
      if (renewalId) await settleRenewalPaid(renewalId);
      else await createSubscriptionsForOrder(orderId);
    }
  } catch (e) {
    console.error("[order-confirmed] subscriptions", e);
  }

  // Inside a request (checkout, webhook) the network calls run after the response; elsewhere (cron, scripts) inline.
  try {
    const { after } = await import("next/server");
    after(() => sendServerPurchase(orderId));
  } catch {
    await sendServerPurchase(orderId);
  }
}
