import "server-only";
import type { OrderStatus, PaymentProvider, PaymentStatus, Prisma } from "@/generated/prisma/client";
import { brand } from "@/config/brand";
import { OrderCancelledEmail } from "@/emails/order-cancelled";
import { db } from "./db";
import { sendEmail } from "./email";
import { cancelOrder, refundOrder } from "./orders";
import { getSettings } from "./settings";

/*
 * Order documents and customer self-service rules:
 *  - tax invoices (shared by the customer and admin print views)
 *  - customer self-cancel
 *  - the staff order CSV export
 */

// ─────────────────────────────── Shared shapes ───────────────────────────────

type AddressJson = { fullName?: string; phone?: string; line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string };

const asAddress = (v: Prisma.JsonValue): AddressJson => (v && typeof v === "object" && !Array.isArray(v) ? (v as AddressJson) : {});

const isDigitalItem = (meta: Prisma.JsonValue | null) =>
  Boolean(meta && typeof meta === "object" && !Array.isArray(meta) && "giftCard" in meta && meta.giftCard);

const invoiceInclude = {
  items: { orderBy: { id: "asc" } },
  payments: { orderBy: { createdAt: "asc" } },
  events: { orderBy: { createdAt: "asc" } },
  user: { select: { name: true, phone: true } },
} satisfies Prisma.OrderInclude;

export type OrderForInvoice = Prisma.OrderGetPayload<{ include: typeof invoiceInclude }>;

// ─────────────────────────────── Invoice ───────────────────────────────

export type InvoiceLine = { name: string; label: string; sku: string; quantity: number; unitPrice: number; amount: number; digital: boolean };

export type InvoiceData = {
  invoiceNumber: string;
  orderNumber: string;
  orderId: string;
  invoiceDate: Date;
  orderDate: Date;
  status: OrderStatus;
  store: { name: string; tagline: string; email: string; phone: string; website: string };
  billTo: { name: string; email: string; phone: string | null; lines: string[] };
  shipTo: { name: string; lines: string[] } | null;
  lines: InvoiceLine[];
  subtotal: number;
  discount: number;
  couponCode: string | null;
  pointsRedeemed: number;
  pointsValue: number;
  /** Shipping plus gift wrap, as charged on the order. */
  shippingAndWrap: number;
  giftWrap: boolean;
  tax: { label: string; ratePercent: number; inclusive: boolean; amount: number; taxableValue: number };
  total: number;
  giftCardApplied: number;
  /** Paid (or due, for COD) by the payment method: total less gift card. */
  amountPaid: number;
  paymentMethod: string;
  paid: boolean;
  /** Cancelled/refunded after confirmation: printed on the invoice. */
  void: "CANCELLED" | "REFUNDED" | null;
};

export const invoiceNumberFor = (orderNumber: string) => `INV-${orderNumber}`;

type EventLike = { status: OrderStatus; message: string };

/** Payment received / COD confirmed, or any later fulfilment step. Placement and cancellation events don't count. */
const isConfirmationEvent = (e: EventLike) => (e.status === "PENDING" ? e.message.startsWith("Confirmed") : e.status !== "CANCELLED" && e.status !== "REFUNDED");

/** When the order was confirmed (the invoice date). Null if it never was. */
function confirmedAt(order: Pick<OrderForInvoice, "events">): Date | null {
  return order.events.find(isConfirmationEvent)?.createdAt ?? null;
}

/**
 * Invoices exist only for confirmed orders: not while awaiting online payment,
 * and not for orders cancelled before payment/confirmation.
 */
export function invoiceAvailable(order: { status: OrderStatus; reservedUntil: Date | null; events: EventLike[] }) {
  if (order.reservedUntil) return false;
  if (order.status === "CANCELLED" || order.status === "REFUNDED") return order.events.some(isConfirmationEvent);
  // PENDING without a hold = confirmed COD; PAID onwards = confirmed.
  return true;
}

const providerLabel: Record<PaymentProvider, string> = {
  COD: "Cash on delivery",
  STRIPE: "Card (Stripe)",
  RAZORPAY: "Razorpay (UPI / card / netbanking)",
  INVOICE: "Trade invoice (bank transfer)",
};

export function paymentMethodLabel(provider: PaymentProvider | undefined, amountPaid: number, giftCardApplied: number) {
  if (amountPaid === 0 && giftCardApplied > 0) return "Gift card";
  const base = provider ? providerLabel[provider] : "—";
  return giftCardApplied > 0 ? `${base} + gift card` : base;
}

/** Pure: computes everything printed on the invoice from an order snapshot and the store tax settings. */
export function buildInvoice(order: OrderForInvoice, settings: { taxRatePercent: number; taxInclusive: boolean }): InvoiceData {
  const addr = asAddress(order.shippingAddress);
  const lines: InvoiceLine[] = order.items.map((i) => ({
    name: i.name,
    label: i.label,
    sku: i.sku,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    amount: i.unitPrice * i.quantity,
    digital: isDigitalItem(i.meta),
  }));
  const goodsSubtotal = lines.filter((l) => !l.digital).reduce((s, l) => s + l.amount, 0);
  const pointsValue = order.pointsRedeemed * brand.loyalty.pointValue;
  // Same base as checkout pricing: physical goods after discount and points. Shipping, wrap and gift cards are untaxed.
  const goods = Math.max(0, goodsSubtotal - order.discount - pointsValue);
  const taxableValue = settings.taxInclusive ? goods - order.tax : goods;

  const payment = order.payments.find((p) => p.status === "CAPTURED" || p.status === "REFUNDED") ?? order.payments[0];
  const amountPaid = order.total - order.giftCardAmount;
  const paidStatuses: PaymentStatus[] = ["CAPTURED", "REFUNDED"];
  const paid = amountPaid === 0 || Boolean(payment && paidStatuses.includes(payment.status));
  const addressLines = [
    [addr.line1, addr.line2].filter(Boolean).join(", "),
    [addr.city, [addr.state, addr.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    addr.country ?? "",
  ].filter(Boolean);
  const allDigital = lines.length > 0 && lines.every((l) => l.digital);

  return {
    invoiceNumber: invoiceNumberFor(order.number),
    orderNumber: order.number,
    orderId: order.id,
    invoiceDate: confirmedAt(order) ?? order.placedAt,
    orderDate: order.placedAt,
    status: order.status,
    store: {
      name: brand.name,
      tagline: brand.tagline,
      email: brand.email,
      phone: brand.whatsapp,
      website: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/^https?:\/\//, ""),
    },
    billTo: { name: addr.fullName || order.user?.name || order.email, email: order.email, phone: addr.phone ?? order.user?.phone ?? null, lines: addressLines },
    shipTo: allDigital ? null : { name: addr.fullName ?? "", lines: addressLines },
    lines,
    subtotal: order.subtotal,
    discount: order.discount,
    couponCode: order.couponCode,
    pointsRedeemed: order.pointsRedeemed,
    pointsValue,
    shippingAndWrap: order.shipping,
    giftWrap: order.giftWrap,
    tax: {
      label: settings.taxInclusive ? "GST (included)" : "GST",
      ratePercent: settings.taxRatePercent,
      inclusive: settings.taxInclusive,
      amount: order.tax,
      taxableValue,
    },
    total: order.total,
    giftCardApplied: order.giftCardAmount,
    amountPaid,
    paymentMethod: paymentMethodLabel(payment?.provider, amountPaid, order.giftCardAmount),
    paid,
    void: order.status === "CANCELLED" || order.status === "REFUNDED" ? order.status : null,
  };
}

async function invoiceFor(where: Prisma.OrderWhereInput) {
  const order = await db.order.findFirst({ where, include: invoiceInclude });
  if (!order || !invoiceAvailable(order)) return null;
  return buildInvoice(order, await getSettings());
}

/** Customer view: only their own, confirmed orders. */
export const getCustomerInvoice = (userId: string, orderNumber: string) => invoiceFor({ number: orderNumber, userId });

/** Staff view: any confirmed order. Callers must check `orders.view` first. */
export const getStaffInvoice = (orderId: string) => invoiceFor({ id: orderId });

// ─────────────────────────────── Customer self-cancel ───────────────────────────────

export type SelfCancelMode = "cancel" | "refund";

/**
 * What a customer may do with their own order, before it is packed:
 * confirmed COD → cancel; paid online → cancel with full refund. Everything else → nothing.
 */
export function selfCancelMode(order: { status: OrderStatus; reservedUntil: Date | null }): SelfCancelMode | null {
  if (order.reservedUntil) return null; // still awaiting online payment
  if (order.status === "PENDING") return "cancel";
  if (order.status === "PAID") return "refund";
  return null;
}

export const SELF_CANCEL_REASONS = ["Changed my mind", "Ordered by mistake", "Found it elsewhere", "Delivery takes too long", "Other"] as const;
export type SelfCancelReason = (typeof SELF_CANCEL_REASONS)[number];

export class SelfCancelError extends Error {}

/** Cancels (and refunds, if paid online) the customer's own order. Throws SelfCancelError with a customer-safe message. */
export async function selfCancelOrder(input: { userId: string; orderNumber: string; reason?: SelfCancelReason | null }) {
  const order = await db.order.findFirst({ where: { number: input.orderNumber, userId: input.userId }, select: { id: true, status: true, reservedUntil: true } });
  if (!order) throw new SelfCancelError("We couldn’t find that order.");
  const mode = selfCancelMode(order);
  if (!mode) {
    throw new SelfCancelError(
      order.status === "PACKED" || order.status === "SHIPPED" || order.status === "DELIVERED"
        ? `This order has already been ${order.status.toLowerCase()} and can no longer be cancelled. Write to ${brand.email} and we’ll help.`
        : "This order can’t be cancelled.",
    );
  }
  const suffix = input.reason ? ` (${input.reason})` : "";

  if (mode === "cancel") {
    // Re-checked under a row lock: staff may have packed it since we read it.
    const cancelled = await cancelOrder(order.id, `Cancelled by customer${suffix}`, ["PENDING"]);
    if (!cancelled) throw new SelfCancelError(`This order was just packed and can no longer be cancelled. Write to ${brand.email} and we’ll help.`);
  } else {
    try {
      await refundOrder(order.id, `Cancelled by customer — refunded${suffix}`);
    } catch (e) {
      // refundOrder calls the provider before touching our records, so nothing has changed.
      console.error("[self-cancel] refund failed", order.id, e);
      throw new SelfCancelError(`We couldn’t process the refund automatically, so your order has not been changed. Please contact us at ${brand.email} and we’ll sort it out.`);
    }
  }

  const updated = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  const expected: OrderStatus = mode === "cancel" ? "CANCELLED" : "REFUNDED";
  if (updated.status !== expected) throw new SelfCancelError(`This order could not be cancelled. Write to ${brand.email} and we’ll help.`);

  await sendEmail({
    to: updated.email,
    subject: `Order ${updated.number} cancelled`,
    react: OrderCancelledEmail({ order: updated, refunded: mode === "refund", reason: input.reason ?? null }),
  }).catch((e) => console.error("[self-cancel] email failed", e));

  return { mode, status: updated.status };
}

// ─────────────────────────────── Staff CSV export ───────────────────────────────

export const CSV_MAX_ROWS = 10_000;

export const CSV_HEADER = [
  "Number",
  "Placed at",
  "Status",
  "Email",
  "Customer name",
  "City",
  "Country",
  "Items",
  "Subtotal",
  "Discount",
  "Points value",
  "Shipping",
  "Tax",
  "Gift card",
  "Total",
  "Payment provider",
  "Payment status",
  "Coupon",
] as const;

/** Escapes one CSV cell; neutralises spreadsheet formulas (= + - @, and tab/CR leaders). */
export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells: (string | number | null | undefined)[]) => cells.map(csvCell).join(",");

/** Integer paise → "1234.50". */
export const rupees = (minor: number) => (minor / 100).toFixed(2);

export type OrderExportFilter = { status?: OrderStatus; from?: Date; to?: Date };

export async function ordersCsv(filter: OrderExportFilter) {
  const orders = await db.order.findMany({
    where: {
      status: filter.status,
      placedAt: filter.from || filter.to ? { gte: filter.from, lte: filter.to } : undefined,
    },
    orderBy: { placedAt: "desc" },
    take: CSV_MAX_ROWS,
    include: {
      items: { select: { quantity: true } },
      payments: { orderBy: { createdAt: "asc" }, select: { provider: true, status: true } },
      user: { select: { name: true } },
    },
  });
  const rows = orders.map((o) => {
    const addr = asAddress(o.shippingAddress);
    const pay = o.payments[0];
    return csvRow([
      o.number,
      o.placedAt.toISOString(),
      o.status === "PENDING" && o.reservedUntil ? "AWAITING_PAYMENT" : o.status,
      o.email,
      addr.fullName ?? o.user?.name ?? "",
      addr.city ?? "",
      addr.country ?? "",
      o.items.reduce((n, i) => n + i.quantity, 0),
      rupees(o.subtotal),
      rupees(o.discount),
      rupees(o.pointsRedeemed * brand.loyalty.pointValue),
      rupees(o.shipping),
      rupees(o.tax),
      rupees(o.giftCardAmount),
      rupees(o.total),
      pay?.provider ?? "",
      pay?.status ?? "",
      o.couponCode ?? "",
    ]);
  });
  // BOM so Excel opens UTF-8 (₹, names) correctly; CRLF per RFC 4180.
  return { csv: "﻿" + [csvRow([...CSV_HEADER]), ...rows].join("\r\n") + "\r\n", count: orders.length, truncated: orders.length === CSV_MAX_ROWS };
}
