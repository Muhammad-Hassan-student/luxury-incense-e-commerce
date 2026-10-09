import "server-only";
import { canDo } from "@/lib/permissions";
import { db } from "../db";
import { audit } from "../audit";
import { notifyOrderStatus, type OrderNotice } from "../notify";
import { PermissionError, type Actor } from "../risk";

export type ResendNotice = Exclude<OrderNotice, "cod_confirmed">;

/** Which notices make sense to (re)send for an order right now. */
export function resendableNotices(o: { status: string; codStatus: string | null }): ResendNotice[] {
  if (o.codStatus === "AWAITING" && o.status === "PENDING") return ["cod_reminder"];
  const out: ResendNotice[] = [];
  if (["PENDING", "PAID", "PACKED", "SHIPPED", "DELIVERED"].includes(o.status)) out.push("confirmed");
  if (o.status === "SHIPPED") out.push("shipped", "out_for_delivery");
  if (o.status === "DELIVERED") out.push("delivered");
  if (o.status === "CANCELLED") out.push("cancelled");
  return out;
}

/** Staff resend of an order's WhatsApp message (forced past the once-per-event guard). Audited. */
export async function resendOrderNotice(actor: Actor, orderId: string, notice: ResendNotice) {
  if (!canDo(actor.permissions, "orders.fulfil")) throw new PermissionError();
  const o = await db.order.findUnique({ where: { id: orderId }, select: { number: true, status: true, codStatus: true, whatsappOptIn: true } });
  if (!o) throw new Error("Order not found.");
  if (!o.whatsappOptIn) throw new Error("The customer didn’t opt in to WhatsApp for this order.");
  if (!resendableNotices(o).includes(notice)) throw new Error("That message doesn’t fit the order’s current status.");
  const r = await notifyOrderStatus(orderId, notice, { channels: ["whatsapp"], force: true, reason: notice === "cancelled" ? "cancelled" : undefined });
  await audit(actor.id, "whatsapp.resend", "Order", orderId, { number: o.number, notice, sent: Boolean(r?.sent) });
  if (!r) throw new Error("Nothing was sent.");
  if (!r.sent) throw new Error(r.reason === "no consent" ? "The customer has opted out (STOP)." : `Not sent: ${r.reason}`);
  return r;
}
