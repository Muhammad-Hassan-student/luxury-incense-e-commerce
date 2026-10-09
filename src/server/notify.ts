import "server-only";
import { OrderConfirmationEmail } from "@/emails/order-confirmation";
import { OrderStatusEmail } from "@/emails/order-status";
import { SimpleEmail } from "@/emails/simple";
import { formatMoney } from "@/lib/money";
import { productHref } from "@/lib/product-href";
import { db } from "./db";
import { sendEmail } from "./email";
import { getIntegration } from "./integrations";
import { codToken, codTokenHash } from "./cod-token";
import { sendWhatsApp, type SendOutcome } from "./whatsapp/messages";
import type { Outgoing } from "./whatsapp/client";

/*
 * One place that tells the customer about an order: email + WhatsApp, for every status change.
 * Fulfilment code (admin, courier sync, webhooks) calls `notifyOrderStatus(orderId, event)` after the status
 * change is saved. WhatsApp sends are idempotent per order + kind (a second call for the same event is a no-op),
 * so overlapping triggers — admin button, courier webhook, cron — never message twice. Never throws.
 */

export type OrderNotice =
  | "confirmed" // order placed + confirmed (for awaiting COD orders this becomes the confirmation request)
  | "cod_reminder"
  | "cod_confirmed"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

/** WhatsAppMessage.kind for each notice. */
export const NOTICE_KIND: Record<OrderNotice, string> = {
  confirmed: "order_confirmed",
  cod_reminder: "cod_reminder",
  cod_confirmed: "order_confirmed",
  shipped: "shipped",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  cancelled: "cancelled",
};

const site = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const codConfirmUrl = (orderId: string) => `${site()}/order/confirm/${codToken(orderId)}`;

type Addr = { fullName?: string; phone?: string; city?: string };
const addrOf = (v: unknown): Addr => (v && typeof v === "object" && !Array.isArray(v) ? (v as Addr) : {});
const firstName = (name?: string) => (name ?? "").trim().split(/\s+/)[0] || "there";

const loadOrder = (orderId: string) =>
  db.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { variant: { select: { product: { select: { slug: true } } } } } }, payments: { select: { provider: true, status: true } } },
  });
type LoadedOrder = NonNullable<Awaited<ReturnType<typeof loadOrder>>>;

/** Tracking link: the courier's own URL when fulfilment saved one (read defensively), else our tracking page. */
export function trackingLink(order: { number: string; trackingNumber?: string | null } & Record<string, unknown>) {
  for (const k of ["trackingUrl", "trackingLink"]) {
    const v = order[k];
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  const awb = (typeof order.awb === "string" && order.awb) || order.trackingNumber;
  return awb ? `${site()}/track?order=${encodeURIComponent(order.number)}` : `${site()}/account/orders/${encodeURIComponent(order.number)}`;
}

/** Courier tracking saved by fulfilment (Shipment model, if present): read defensively so this works before/without it. */
async function courierTracking(orderId: string): Promise<{ trackUrl?: string | null; awb?: string | null; courierName?: string | null } | null> {
  const model = (db as unknown as Record<string, { findFirst?: (a: unknown) => Promise<unknown> } | undefined>).shipment;
  if (!model?.findFirst) return null;
  try {
    return (await model.findFirst({ where: { orderId, active: true }, orderBy: { createdAt: "desc" } })) as { trackUrl?: string | null; awb?: string | null; courierName?: string | null } | null;
  } catch {
    return null;
  }
}

const isCod = (o: LoadedOrder) => o.payments.some((p) => p.provider === "COD");
const dueOnDelivery = (o: LoadedOrder) => (isCod(o) && !o.payments.some((p) => p.status === "CAPTURED") ? o.total - o.giftCardAmount : 0);

async function whatsappFor(o: LoadedOrder, notice: OrderNotice, reason?: string): Promise<Outgoing | null> {
  const c = await getIntegration("whatsapp");
  const a = addrOf(o.shippingAddress);
  const name = firstName(a.fullName);
  const t = (n: string, vars: string[], buttons?: string[]): Outgoing => ({ type: "template", name: n, language: c.templateLanguage, bodyVars: vars, buttonPayloads: buttons });
  switch (notice) {
    case "confirmed":
    case "cod_confirmed":
      return t(c.templateOrderConfirmed, [name, o.number, formatMoney(o.total)]);
    case "cod_reminder":
      return t(c.templateCodConfirm, [name, o.number, formatMoney(dueOnDelivery(o) || o.total), codConfirmUrl(o.id)], [`CONFIRM:${o.id}`, `CANCEL:${o.id}`]);
    case "shipped": {
      const sh = await courierTracking(o.id);
      const link = trackingLink({ ...(o as unknown as Record<string, unknown>), number: o.number, trackingNumber: o.trackingNumber ?? sh?.awb ?? null, trackingUrl: sh?.trackUrl ?? undefined });
      return t(c.templateShipped, [name, o.number, sh?.courierName ?? o.carrier ?? "our courier", link]);
    }
    case "out_for_delivery": {
      const due = dueOnDelivery(o);
      return t(c.templateOutForDelivery, [name, o.number, due ? formatMoney(due) : "Prepaid"]);
    }
    case "delivered": {
      const slug = o.items.find((i) => i.variant?.product.slug)?.variant?.product.slug;
      return t(c.templateDelivered, [name, o.number, slug ? `${site()}${productHref(slug)}#reviews` : `${site()}/account/orders/${o.number}`]);
    }
    case "cancelled":
      return t(c.templateCancelled, [name, o.number, reason ?? "Cancelled"]);
  }
}

/** Sends the COD confirmation request (WhatsApp buttons + email link). Re-arms the single-use link. */
async function requestCodConfirmation(o: LoadedOrder, reminder: boolean) {
  const token = codToken(o.id);
  await db.order.update({ where: { id: o.id }, data: { codTokenHash: codTokenHash(token), ...(reminder ? { codReminderSentAt: new Date() } : {}) } });
  const url = `${site()}/order/confirm/${token}`;
  const a = addrOf(o.shippingAddress);
  const amount = formatMoney(dueOnDelivery(o) || o.total);
  const by = o.codConfirmBy ? o.codConfirmBy.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : null;
  await sendEmail({
    to: o.email,
    subject: reminder ? `Reminder: please confirm order ${o.number}` : `Please confirm your cash-on-delivery order ${o.number}`,
    react: SimpleEmail({
      preview: "One tap to confirm your order",
      title: reminder ? "Still want it?" : "Confirm your order",
      body: `Hello ${firstName(a.fullName)}, you chose cash on delivery for order ${o.number} (${amount} payable on delivery). Please confirm it so we can wrap and dispatch it${by ? ` — unconfirmed orders are released on ${by}` : ""}.`,
      cta: { label: "Confirm or cancel", path: url.slice(site().length) },
    }),
  }).catch((e) => console.error("[notify] COD email failed", e instanceof Error ? e.message : e));
  if (!o.whatsappOptIn || !a.phone) return null;
  const msg = await whatsappFor(o, "cod_reminder");
  return msg ? sendWhatsApp({ phone: a.phone, kind: reminder ? "cod_reminder" : "cod_confirm", consent: "transactional", message: msg, orderId: o.id, userId: o.userId }) : null;
}

async function emailFor(o: LoadedOrder, notice: OrderNotice, reason?: string) {
  const send = (subject: string, react: Parameters<typeof sendEmail>[0]["react"]) =>
    sendEmail({ to: o.email, subject, react }).catch((e) => console.error("[notify] email failed", e instanceof Error ? e.message : e));
  if (notice === "confirmed" || notice === "cod_confirmed") return send(`Order ${o.number} confirmed`, OrderConfirmationEmail({ order: o }));
  if (notice === "shipped") return send(`Order ${o.number}: Shipped`, OrderStatusEmail({ order: o }));
  if (notice === "delivered") return send(`Order ${o.number}: Delivered`, OrderStatusEmail({ order: o }));
  if (notice === "cancelled") {
    return send(`Order ${o.number} cancelled`, SimpleEmail({ preview: "Your order was cancelled", title: "Order cancelled", body: `Order ${o.number} was cancelled: ${reason ?? "cancelled"}. Nothing is due. You’re welcome to order again any time.`, cta: { label: "Visit the boutique", path: "/shop" } }));
  }
}

/**
 * Tell the customer. `channels` defaults to both; `force` re-sends WhatsApp even if one went out already (admin resend).
 * Returns the WhatsApp outcome (null when WhatsApp wasn't attempted).
 */
export async function notifyOrderStatus(
  orderId: string,
  notice: OrderNotice,
  opts: { reason?: string; channels?: ("email" | "whatsapp")[]; force?: boolean } = {},
): Promise<SendOutcome | null> {
  try {
    const o = await loadOrder(orderId);
    if (!o) return null;
    const channels = opts.channels ?? ["email", "whatsapp"];

    if ((notice === "confirmed" && o.codStatus === "AWAITING") || notice === "cod_reminder") {
      if (o.codStatus !== "AWAITING") return null;
      const already = !opts.force && notice === "confirmed" && (await db.whatsAppMessage.count({ where: { orderId, kind: "cod_confirm", status: { not: "FAILED" } } })) > 0;
      if (already) return null;
      return await requestCodConfirmation(o, notice === "cod_reminder");
    }

    if (channels.includes("email")) await emailFor(o, notice, opts.reason);
    if (!channels.includes("whatsapp")) return null;
    const a = addrOf(o.shippingAddress);
    if (!o.whatsappOptIn || !a.phone) return null;
    const kind = NOTICE_KIND[notice];
    if (!opts.force && (await db.whatsAppMessage.count({ where: { orderId, kind, direction: "out", status: { not: "FAILED" } } }))) return null;
    const msg = await whatsappFor(o, notice, opts.reason);
    if (!msg) return null;
    return await sendWhatsApp({ phone: a.phone, kind, consent: "transactional", message: msg, orderId, userId: o.userId });
  } catch (e) {
    console.error(`[notify] ${notice} for ${orderId} failed`, e instanceof Error ? e.message : e);
    return null;
  }
}
