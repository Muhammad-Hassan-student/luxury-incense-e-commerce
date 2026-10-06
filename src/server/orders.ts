import "server-only";
import { randomInt } from "node:crypto";
import type { OrderStatus, PaymentProvider, Prisma } from "@/generated/prisma/client";
import { brand } from "@/config/brand";
import { price, pointsEarned } from "@/lib/pricing";
import { OrderConfirmationEmail } from "@/emails/order-confirmation";
import { OrderStatusEmail } from "@/emails/order-status";
import { db } from "./db";
import { commitSale, OutOfStockError, release, reserve, adjustStock, stockMoves } from "./inventory";
import { createRazorpayOrder, createStripeIntent, refundAtProvider } from "./payments";
import { getSettings } from "./settings";
import { sendEmail } from "./email";
import type { CartLine, CartWithItems } from "./cart-lines";
import { findGiftCard, GiftCardError, holdGiftCard, issueGiftCards, restoreGiftCard, sendGiftCardEmails, voidIssuedGiftCards } from "./gift-cards";

export const REFERRAL_BONUS = 200;

export type ShippingAddress = {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export class CheckoutError extends Error {}

const orderNumber = () => `MO-${new Date().getFullYear() % 100}${String(randomInt(0, 1e6)).padStart(6, "0")}`;

const itemMoves = (items: { variantId: string | null; quantity: number; components: string[] }[]) =>
  stockMoves(items.map((i) => ({ variantId: i.variantId, quantity: i.quantity, bundle: i.components })));

/** Shared quote used by both the checkout page and order placement so they never disagree. */
export async function quote(opts: {
  lines: CartLine[];
  cart: CartWithItems | null;
  shippingRateId?: string | null;
  country?: string;
  userId?: string | null;
  pointsRequested?: number;
  giftWrap?: boolean;
}) {
  const settings = await getSettings();
  const rates = await db.shippingRate.findMany({ orderBy: { position: "asc" } });
  const country = opts.country ?? "IN";
  const eligible = rates.filter((r) => r.countries.includes(country) || r.countries.includes("*"));
  const specific = eligible.filter((r) => !r.countries.includes("*"));
  const options = specific.length ? specific : eligible;
  const rate = options.find((r) => r.id === opts.shippingRateId) ?? options[0] ?? null;
  const user = opts.userId ? await db.user.findUnique({ where: { id: opts.userId }, select: { loyaltyPoints: true } }) : null;

  // Gift card as tender. It can't buy other gift cards.
  let giftCard: { code: string; balance: number; error: string | null } | null = null;
  if (opts.cart?.giftCardCode) {
    const { card, error } = await findGiftCard(opts.cart.giftCardCode);
    const buysGiftCards = opts.lines.some((l) => l.digital);
    giftCard = {
      code: opts.cart.giftCardCode,
      balance: error || buysGiftCards ? 0 : (card?.balance ?? 0),
      error: error ?? (buysGiftCards ? "Gift cards can’t be used to buy other gift cards." : null),
    };
  }

  const pricing = price({
    lines: opts.lines,
    coupon: opts.cart?.coupon ?? null,
    shipping: rate,
    pointsRequested: opts.pointsRequested,
    pointsBalance: user?.loyaltyPoints ?? 0,
    pointValue: brand.loyalty.pointValue,
    giftWrap: opts.giftWrap ?? opts.cart?.giftWrap ?? false,
    giftWrapFee: settings.giftWrapFee,
    taxRatePercent: settings.taxRatePercent,
    taxInclusive: settings.taxInclusive,
    giftCardBalance: giftCard?.balance ?? 0,
  });
  return { pricing, rate, rates: options, pointsBalance: user?.loyaltyPoints ?? 0, settings, giftCard };
}

export async function placeOrder(input: {
  cart: CartWithItems;
  lines: CartLine[];
  userId: string | null;
  email: string;
  address: ShippingAddress;
  shippingRateId: string;
  provider: PaymentProvider;
  pointsRequested: number;
  giftWrap: boolean;
  giftNote?: string;
  deliveryDate?: Date | null;
  notes?: string;
}) {
  await releaseExpired();
  if (!input.lines.length) throw new CheckoutError("Your bag is empty.");
  for (const l of input.lines) {
    if (l.quantity > l.available) throw new CheckoutError(`Only ${l.available} left of ${l.name} — please update your bag.`);
  }

  const { pricing, rate, giftCard } = await quote({
    lines: input.lines,
    cart: input.cart,
    shippingRateId: input.shippingRateId,
    country: input.address.country,
    userId: input.userId,
    pointsRequested: input.pointsRequested,
    giftWrap: input.giftWrap,
  });
  if (!rate) throw new CheckoutError("We don't ship to that country yet.");
  if (input.cart.coupon && pricing.couponError) throw new CheckoutError(pricing.couponError);
  if (giftCard?.error) throw new CheckoutError(giftCard.error);
  const digital = input.lines.some((l) => l.digital);
  if (digital && input.provider === "COD") throw new CheckoutError("Gift cards need to be paid online.");
  const giftCardCode = pricing.giftCardApplied > 0 ? giftCard!.code : null;

  const reservedUntil = new Date(Date.now() + brand.reservationMinutes * 60_000);
  let order;
  try {
    order = await db.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          number: orderNumber(),
          userId: input.userId,
          email: input.email,
          currency: brand.baseCurrency,
          subtotal: pricing.subtotal,
          discount: pricing.discount,
          pointsRedeemed: pricing.pointsRedeemed,
          shipping: pricing.shipping + pricing.giftWrap,
          tax: pricing.tax,
          total: pricing.total,
          couponCode: input.cart.coupon?.code,
          giftCardCode,
          giftCardAmount: pricing.giftCardApplied,
          giftWrap: input.giftWrap && !input.lines.every((l) => l.digital),
          giftNote: input.giftNote,
          deliveryDate: input.deliveryDate,
          notes: input.notes,
          shippingAddress: input.address,
          carrier: input.lines.every((l) => l.digital) ? "Email delivery" : rate.name,
          reservedUntil,
          items: {
            create: input.lines.map((l) => ({
              variantId: l.variantId,
              name: l.name,
              label: l.bundle ? l.bundle.map((c) => c.name).join(" · ") : l.label,
              sku: l.sku,
              unitPrice: l.unitPrice,
              quantity: l.quantity,
              components: l.bundle?.map((c) => c.variantId) ?? [],
              meta: l.giftCard ? { giftCard: l.giftCard } : undefined,
            })),
          },
          payments: {
            create: {
              provider: input.provider,
              amount: pricing.payable,
              currency: brand.baseCurrency,
              raw: { cartId: input.cart.id },
            },
          },
          events: { create: { status: "PENDING", message: "Order placed — awaiting payment" } },
        },
        include: { items: true, payments: true },
      });
      for (const m of itemMoves(created.items)) await reserve(tx, m.variantId, m.qty, created.id);
      if (giftCardCode) await holdGiftCard(tx, giftCardCode, pricing.giftCardApplied);
      return created;
    });
  } catch (e) {
    if (e instanceof OutOfStockError) throw new CheckoutError("Something in your bag just sold out. Please review your bag.");
    if (e instanceof GiftCardError) throw new CheckoutError(e.message);
    throw e;
  }

  const payment = order.payments[0];
  try {
    // Fully covered by a gift card (or discounts): nothing left to collect.
    if (pricing.payable === 0 || input.provider === "COD") {
      await confirmOrder(order.id, { captured: pricing.payable === 0 });
      return { order, client: null };
    }
    const charge = { ...order, total: pricing.payable };
    if (input.provider === "STRIPE") {
      const { providerRef, clientSecret } = await createStripeIntent(charge);
      await db.payment.update({ where: { id: payment.id }, data: { providerRef } });
      return { order, client: { provider: "STRIPE" as const, clientSecret } };
    }
    const { providerRef } = await createRazorpayOrder(charge);
    await db.payment.update({ where: { id: payment.id }, data: { providerRef } });
    return { order, client: { provider: "RAZORPAY" as const, razorpayOrderId: providerRef } };
  } catch (e) {
    await cancelOrder(order.id, "Payment could not be started");
    throw e;
  }
}

/**
 * Finalises an order once payment is captured (or immediately for COD).
 * Idempotent: replays from webhooks + client callbacks are no-ops.
 */
export async function confirmOrder(
  orderId: string,
  opts: { captured: boolean; providerRef?: string; raw?: Prisma.InputJsonObject },
) {
  let issued: Awaited<ReturnType<typeof issueGiftCards>> = [];
  const result = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true, payments: true, user: true } });
    if (!order) return null;
    const payment = order.payments[0];

    // Payment landed after the hold expired: try to take the stock again.
    if (order.status === "CANCELLED" && opts.captured && !order.reservedUntil) {
      try {
        for (const m of itemMoves(order.items)) await reserve(tx, m.variantId, m.qty, order.id);
        if (order.giftCardCode) await holdGiftCard(tx, order.giftCardCode, order.giftCardAmount);
      } catch {
        await tx.orderEvent.create({ data: { orderId, status: "CANCELLED", message: "Paid after hold expired and stock is gone — refund required" } });
        await tx.payment.update({ where: { id: payment.id }, data: { status: "CAPTURED", raw: { ...(payment.raw as object), ...opts.raw } } });
        return null;
      }
    } else {
      const claimed = await tx.order.updateMany({
        where: { id: orderId, status: "PENDING", reservedUntil: { not: null } },
        data: { reservedUntil: null },
      });
      if (claimed.count === 0) {
        // Already confirmed (e.g. COD later marked paid) — just record capture.
        if (opts.captured && payment.status !== "CAPTURED") {
          await tx.payment.update({ where: { id: payment.id }, data: { status: "CAPTURED" } });
        }
        return null;
      }
    }

    for (const m of itemMoves(order.items)) await commitSale(tx, m.variantId, m.qty, order.id);

    const status: OrderStatus = opts.captured ? "PAID" : "PENDING";
    await tx.order.update({ where: { id: orderId }, data: { status, reservedUntil: null } });
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: opts.captured ? "CAPTURED" : "CREATED",
        providerRef: opts.providerRef ?? payment.providerRef,
        raw: { ...(payment.raw as object), ...opts.raw },
      },
    });
    await tx.orderEvent.create({
      data: { orderId, status, message: opts.captured ? "Payment received" : "Confirmed — cash on delivery" },
    });

    if (order.couponCode) await tx.coupon.update({ where: { code: order.couponCode }, data: { usedCount: { increment: 1 } } });

    // Gift card purchases are only issued once money is actually captured.
    if (opts.captured) issued = await issueGiftCards(tx, order);

    if (order.userId) {
      // Points are earned on what was paid, not on gift card spend.
      const earned = pointsEarned(order.total - order.giftCardAmount, brand.loyalty.earnPer100);
      const delta = earned - order.pointsRedeemed;
      if (order.pointsRedeemed) {
        await tx.loyaltyEntry.create({ data: { userId: order.userId, points: -order.pointsRedeemed, reason: `Redeemed on ${order.number}`, orderId } });
      }
      if (earned) {
        await tx.loyaltyEntry.create({ data: { userId: order.userId, points: earned, reason: `Earned on ${order.number}`, orderId } });
      }
      await tx.user.update({ where: { id: order.userId }, data: { loyaltyPoints: { increment: delta } } });

      const priorOrders = await tx.order.count({ where: { userId: order.userId, id: { not: orderId }, reservedUntil: null, status: { notIn: ["CANCELLED", "PENDING"] } } });
      if (priorOrders === 0 && order.user?.referredById) {
        await tx.loyaltyEntry.create({ data: { userId: order.user.referredById, points: REFERRAL_BONUS, reason: `Referral: ${order.user.email}` } });
        await tx.user.update({ where: { id: order.user.referredById }, data: { loyaltyPoints: { increment: REFERRAL_BONUS } } });
      }
    }

    const cartId = (payment.raw as { cartId?: string } | null)?.cartId;
    if (cartId) {
      await tx.cartItem.deleteMany({ where: { cartId } });
      await tx.cart.updateMany({ where: { id: cartId }, data: { couponId: null, giftCardCode: null, giftWrap: false, giftNote: null } });
    }
    return order;
  });

  if (result) {
    const full = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (full) {
      await sendEmail({
        to: full.email,
        subject: `Order ${full.number} confirmed`,
        react: OrderConfirmationEmail({ order: full }),
      }).catch((e) => console.error("[orders] email failed", e));
      await sendGiftCardEmails(issued, full.email);
    }
  }
  return Boolean(result);
}

/** Reverses all loyalty movement tied to an order (earned and redeemed). */
async function reverseLoyalty(tx: Prisma.TransactionClient, order: { id: string; number: string; userId: string | null }, why: string) {
  if (!order.userId) return;
  const sum = await tx.loyaltyEntry.aggregate({ where: { orderId: order.id, userId: order.userId }, _sum: { points: true } });
  const net = sum._sum.points ?? 0;
  if (!net) return;
  await tx.loyaltyEntry.create({ data: { userId: order.userId, points: -net, reason: `Reversed: ${why} ${order.number}`, orderId: order.id } });
  await tx.user.update({ where: { id: order.userId }, data: { loyaltyPoints: { decrement: net } } });
}

/** Cancels an order that has not been shipped. Unpaid holds are released; committed stock is returned. */
export async function cancelOrder(orderId: string, reason: string) {
  await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order || ["CANCELLED", "REFUNDED", "SHIPPED", "DELIVERED"].includes(order.status)) return;
    const moves = itemMoves(order.items);
    if (order.reservedUntil) {
      for (const m of moves) await release(tx, m.variantId, m.qty, order.id);
    } else {
      for (const m of moves) await adjustStock(tx, m.variantId, m.qty, "RETURN", undefined, order.id);
      await reverseLoyalty(tx, order, "cancellation of");
    }
    if (order.giftCardCode) await restoreGiftCard(tx, order.giftCardCode, order.giftCardAmount);
    await voidIssuedGiftCards(tx, orderId);
    await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED", reservedUntil: null } });
    await tx.payment.updateMany({ where: { orderId, status: { in: ["CREATED", "AUTHORIZED"] } }, data: { status: "FAILED" } });
    await tx.orderEvent.create({ data: { orderId, status: "CANCELLED", message: reason } });
  });
}

/** Refunds a captured order in full at the provider, restocks unshipped goods and reverses loyalty. */
export async function refundOrder(orderId: string, reason: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true, payments: true } });
  if (!order) throw new Error("Order not found");
  const payment = order.payments.find((p) => p.status === "CAPTURED");
  if (payment) await refundAtProvider(payment);

  await db.$transaction(async (tx) => {
    if (!["SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"].includes(order.status)) {
      for (const m of itemMoves(order.items)) await adjustStock(tx, m.variantId, m.qty, "RETURN", undefined, order.id);
    }
    if (payment) await tx.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
    if (order.giftCardCode && !["CANCELLED", "REFUNDED"].includes(order.status)) await restoreGiftCard(tx, order.giftCardCode, order.giftCardAmount);
    await voidIssuedGiftCards(tx, orderId);
    await tx.order.update({ where: { id: orderId }, data: { status: "REFUNDED", reservedUntil: null } });
    await tx.orderEvent.create({ data: { orderId, status: "REFUNDED", message: reason } });
    await reverseLoyalty(tx, order, "refund of");
  });
}

const allowedNext: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["PACKED", "CANCELLED"],
  PAID: ["PACKED", "CANCELLED"],
  PACKED: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
  REFUNDED: [],
};
export const nextStatuses = (s: OrderStatus) => allowedNext[s];

/** Fulfilment transitions from admin. Sends the customer an update for shipped/delivered. */
export async function advanceOrder(orderId: string, to: OrderStatus, extra: { trackingNumber?: string; carrier?: string } = {}) {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("Order not found");
  if (!allowedNext[order.status].includes(to)) throw new Error(`Cannot move ${order.status} → ${to}`);
  if (to === "CANCELLED") return cancelOrder(orderId, "Cancelled by store");
  if (order.status === "PENDING" && order.reservedUntil) throw new Error("This order is still awaiting payment.");

  const messages: Partial<Record<OrderStatus, string>> = {
    PACKED: "Packed and wrapped",
    SHIPPED: `Shipped${extra.trackingNumber ? ` — tracking ${extra.trackingNumber}` : ""}`,
    DELIVERED: "Delivered",
  };
  const updated = await db.order.update({
    where: { id: orderId },
    data: { status: to, trackingNumber: extra.trackingNumber ?? undefined, carrier: extra.carrier ?? undefined, events: { create: { status: to, message: messages[to] ?? to } } },
  });
  // Cash on delivery is collected on delivery.
  if (to === "DELIVERED") await db.payment.updateMany({ where: { orderId, provider: "COD" }, data: { status: "CAPTURED" } });
  if (to === "SHIPPED" || to === "DELIVERED") {
    await sendEmail({ to: updated.email, subject: `Order ${updated.number}: ${messages[to]}`, react: OrderStatusEmail({ order: updated }) }).catch(() => {});
  }
}

/** Releases holds on unpaid orders past their reservation window. Safe to call often. */
export async function releaseExpired() {
  const stale = await db.order.findMany({
    where: { status: "PENDING", reservedUntil: { lt: new Date() } },
    select: { id: true },
    take: 50,
  });
  for (const o of stale) await cancelOrder(o.id, "Payment window expired — items released");
  return stale.length;
}
