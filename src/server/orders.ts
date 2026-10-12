import "server-only";
import { randomInt } from "node:crypto";
import type { OrderStatus, PaymentProvider, Prisma } from "@/generated/prisma/client";
import { brand } from "@/config/brand";
import { price, pointsEarned } from "@/lib/pricing";
import { db } from "./db";
import { commitSale, OutOfStockError, release, reserveOrder, adjustStock, stockMoves } from "./inventory";
import { createRazorpayOrder, createStripeIntent, refundAtProvider } from "./payments";
import { getSettings } from "./settings";
import { personalCouponProblem } from "./marketing";
import type { CartLine, CartWithItems } from "./cart-lines";
import { findGiftCard, GiftCardError, holdGiftCard, issueGiftCards, restoreGiftCard, sendGiftCardEmails, voidIssuedGiftCards } from "./gift-cards";
import { notifyOrderStatus } from "./notify";
import { applyStorefrontRules, codDecision, getRiskSettings, type RiskReason } from "./risk";
import { normalizePhone } from "./whatsapp/phone";
import { recordOptIn } from "./whatsapp/messages";
import { withLiveCourierRate } from "./courier/checkout";
import { priceCart, recordOrderPromotions } from "./promotions";
import { allocatePreorder, PreorderFullError, reclaimPreorderAllocation, releasePreorderAllocation } from "./preorders";
import { attributeOrder, reconcileCommission, type AffiliateTouch } from "./affiliates";
import { orderPreorderHold, preorderPending } from "@/lib/preorder";
import { getFxTable, getRegion } from "./region";
import { planCharge } from "./charge";

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

// Unreleased pre-order lines never move on-hand stock (src/lib/preorder.ts).
const itemMoves = (items: { variantId: string | null; quantity: number; components: string[]; meta?: Prisma.JsonValue | null }[]) =>
  stockMoves(items.filter((i) => !preorderPending(i.meta)).map((i) => ({ variantId: i.variantId, quantity: i.quantity, bundle: i.components })));

/** OrderItem.meta for a bag line: gift card details, Subscribe & Save, pre-order ship date. */
function lineMeta(l: CartLine): Prisma.InputJsonObject | undefined {
  if (l.giftCard) return { giftCard: l.giftCard };
  const meta: Record<string, Prisma.InputJsonValue> = {};
  if (l.subscription) meta.subscription = l.subscription;
  if (l.preorder) meta.preorder = { shipDate: l.preorder.shipDate };
  return Object.keys(meta).length ? meta : undefined;
}

/** Shared quote used by both the checkout page and order placement so they never disagree. */
export async function quote(opts: {
  lines: CartLine[];
  cart: CartWithItems | null;
  shippingRateId?: string | null;
  country?: string;
  userId?: string | null;
  pointsRequested?: number;
  giftWrap?: boolean;
  /** Delivery pincode: enables the live courier price when that's switched on (src/server/courier/checkout.ts). */
  postalCode?: string | null;
}) {
  const settings = await getSettings();
  const rates = await db.shippingRate.findMany({ orderBy: { position: "asc" } });
  const country = opts.country ?? (await getRegion()).country;
  const eligible = rates.filter((r) => r.countries.includes(country) || r.countries.includes("*"));
  const specific = eligible.filter((r) => !r.countries.includes("*"));
  const options = await withLiveCourierRate(specific.length ? specific : eligible, { country, postalCode: opts.postalCode, lines: opts.lines });
  const rate = options.find((r) => r.id === opts.shippingRateId) ?? options[0] ?? null;
  const user = opts.userId ? await db.user.findUnique({ where: { id: opts.userId }, select: { loyaltyPoints: true } }) : null;
  // Promotions: every line re-priced from the database (flash-sale prices; any client-side price is ignored), then
  // bundles and tiered discounts. Stacking rules: src/lib/promotions.ts.
  const promo = await priceCart(opts.lines, { userId: opts.userId ?? opts.cart?.userId ?? null });

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
    lines: promo.lines,
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
    promo: { discount: promo.result.promoDiscount, couponCap: promo.result.couponCap, couponBlockedBy: promo.result.couponBlockedBy },
  });
  return { pricing, rate, rates: options, pointsBalance: user?.loyaltyPoints ?? 0, settings, giftCard, lines: promo.lines, promotions: promo.result };
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
  /** Consent-gated attribution for server-side purchase events (src/server/tracking.ts). */
  tracking?: Prisma.InputJsonObject;
  /** Storefront checkout: COD rules, RTO risk, COD confirmation and WhatsApp consent (see src/server/risk.ts, cod.ts). */
  storefront?: { whatsappOptIn?: boolean };
  /** Affiliate cookie + IP/device for attribution and fraud flags (src/server/affiliates.ts). */
  affiliate?: AffiliateTouch | null;
  /** Shopper's display currency: Stripe charges in it (src/server/charge.ts); everything else charges the base. */
  displayCurrency?: string | null;
}) {
  await releaseExpired();
  if (!input.lines.length) throw new CheckoutError("Your bag is empty.");
  for (const l of input.lines) {
    if (l.quantity > l.available) throw new CheckoutError(`Only ${l.available} left of ${l.name} — please update your bag.`);
  }

  const { pricing, rate, giftCard, lines, promotions } = await quote({
    lines: input.lines,
    cart: input.cart,
    shippingRateId: input.shippingRateId,
    country: input.address.country,
    postalCode: input.address.postalCode,
    userId: input.userId,
    pointsRequested: input.pointsRequested,
    giftWrap: input.giftWrap,
  });
  if (!rate) throw new CheckoutError("We don't ship to that country yet.");
  if (input.cart.coupon && pricing.couponError) throw new CheckoutError(pricing.couponError);
  if (input.cart.coupon) {
    // Personal journey codes: single use, only for the address they were sent to.
    const personal = await personalCouponProblem(input.cart.coupon.code, input.email);
    if (personal) throw new CheckoutError(personal);
  }
  if (giftCard?.error) throw new CheckoutError(giftCard.error);
  const digital = lines.some((l) => l.digital);
  if (digital && input.provider === "COD") throw new CheckoutError("Gift cards need to be paid online.");

  // Storefront: COD limits/risk, COD fee or prepaid incentive, and the risk score kept on the order.
  let storefront: { riskScore: number; riskReasons: RiskReason[]; codConfirmBy: Date | null } | null = null;
  if (input.storefront) {
    const settings = await getRiskSettings();
    const store = await getSettings();
    const goodsSubtotal = lines.filter((l) => !l.digital).reduce((n, l) => n + l.unitPrice * l.quantity, 0);
    applyStorefrontRules(pricing, { provider: input.provider === "COD" ? "COD" : "ONLINE", goodsSubtotal, giftCardBalance: giftCard?.balance ?? 0, settings, taxRatePercent: store.taxRatePercent, taxInclusive: store.taxInclusive });
    const decision = await codDecision({ email: input.email, phone: input.address.phone, country: input.address.country, postalCode: input.address.postalCode, amount: pricing.payable, userId: input.userId, digital, settings });
    if (input.provider === "COD" && pricing.payable > 0 && !decision.allowed) throw new CheckoutError(decision.message ?? "Cash on delivery isn’t available for this order.");
    storefront = {
      riskScore: decision.risk.score,
      riskReasons: decision.risk.reasons,
      codConfirmBy: input.provider === "COD" && pricing.payable > 0 && settings.codConfirmation ? new Date(Date.now() + settings.confirmWithinHours * 3600_000) : null,
    };
  }
  const giftCardCode = pricing.giftCardApplied > 0 ? giftCard!.code : null;

  const reservedUntil = new Date(Date.now() + brand.reservationMinutes * 60_000);
  // Multi-currency: amounts stay in the base currency; a Stripe charge in the shopper's currency is frozen on the order.
  const [region, fx] = await Promise.all([getRegion(), getFxTable()]);
  const base = region.baseCurrency;
  const charge = planCharge({ provider: input.provider, display: input.displayCurrency, payable: pricing.payable, fx, region });
  let order;
  try {
    order = await db.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          number: orderNumber(),
          userId: input.userId,
          email: input.email,
          currency: base,
          ...(charge ? { chargeCurrency: charge.currency, chargeAmount: charge.amount, fxRate: charge.rate, fxRounding: charge.rounding } : {}),
          subtotal: pricing.subtotal,
          discount: pricing.discount,
          pointsRedeemed: pricing.pointsRedeemed,
          shipping: pricing.shipping + pricing.giftWrap,
          tax: pricing.tax,
          total: pricing.total,
          couponCode: input.cart.coupon?.code,
          giftCardCode,
          giftCardAmount: pricing.giftCardApplied,
          giftWrap: input.giftWrap && !lines.every((l) => l.digital),
          giftNote: input.giftNote,
          deliveryDate: input.deliveryDate,
          notes: input.notes,
          shippingAddress: input.address,
          carrier: lines.every((l) => l.digital) ? "Email delivery" : rate.name,
          reservedUntil,
          items: {
            create: lines.map((l) => ({
              variantId: l.variantId,
              name: l.name,
              label: l.bundle ? l.bundle.map((c) => c.name).join(" · ") : l.label,
              sku: l.sku,
              unitPrice: l.unitPrice,
              quantity: l.quantity,
              components: l.bundle?.map((c) => c.variantId) ?? [],
              meta: lineMeta(l),
            })),
          },
          payments: {
            create: {
              provider: input.provider,
              amount: pricing.payable,
              currency: base,
              raw: { cartId: input.cart.id, ...(input.tracking ? { tracking: input.tracking } : {}), ...(charge ? { charge: { currency: charge.currency, amount: charge.amount, rate: charge.rate } } : {}) },
            },
          },
          events: { create: { status: "PENDING", message: "Order placed — awaiting payment" } },
          ...(storefront
            ? {
                riskScore: storefront.riskScore,
                riskReasons: storefront.riskReasons,
                whatsappOptIn: Boolean(input.storefront?.whatsappOptIn && normalizePhone(input.address.phone, input.address.country)),
                ...(storefront.codConfirmBy ? { codStatus: "AWAITING" as const, codConfirmBy: storefront.codConfirmBy } : input.provider === "COD" ? { codStatus: "CONFIRMED" as const, codConfirmedVia: "auto" } : {}),
              }
            : {}),
        },
        include: { items: true, payments: true },
      });
      // Pre-orders take their own allocation (capped), never on-hand stock.
      for (const l of lines) if (l.preorder && !l.digital && !l.bundle) await allocatePreorder(tx, l.variantId, l.quantity);
      if (lines.some((l) => l.preorder)) {
        const ship = lines.filter((l) => l.preorder).map((l) => l.preorder!.shipDate).sort().pop()!;
        await tx.orderEvent.create({ data: { orderId: created.id, status: "PENDING", message: `Includes pre-order pieces — held until stock arrives (expected ${new Date(ship).toLocaleDateString(region.locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })})` } });
      }
      await recordOrderPromotions(tx, created.id, promotions);
      await attributeOrder(tx, { id: created.id, number: created.number, userId: created.userId, email: created.email, couponCode: created.couponCode }, input.affiliate);
      // Multi-warehouse: one allocation for the whole order (nearest warehouse that can send everything, else split).
      await reserveOrder(tx, created.id, itemMoves(created.items), input.address.postalCode);
      if (giftCardCode) await holdGiftCard(tx, giftCardCode, pricing.giftCardApplied);
      return created;
    });
  } catch (e) {
    if (e instanceof OutOfStockError) throw new CheckoutError("Something in your bag just sold out. Please review your bag.");
    if (e instanceof GiftCardError) throw new CheckoutError(e.message);
    if (e instanceof PreorderFullError) throw new CheckoutError("The pre-order allocation for something in your bag just filled up. Please review your bag.");
    throw e;
  }

  if (input.storefront?.whatsappOptIn) {
    const phone = normalizePhone(input.address.phone, input.address.country);
    if (phone) await recordOptIn(phone, { email: input.email, userId: input.userId, source: "checkout" }).catch(() => {});
  }

  const payment = order.payments[0];
  try {
    // Fully covered by a gift card (or discounts): nothing left to collect.
    if (pricing.payable === 0 || input.provider === "COD") {
      await confirmOrder(order.id, { captured: pricing.payable === 0 });
      return { order, client: null };
    }
    const toCharge = charge ? { ...order, total: charge.amount, currency: charge.currency } : { ...order, total: pricing.payable };
    if (input.provider === "STRIPE") {
      const { providerRef, clientSecret } = await createStripeIntent(toCharge);
      await db.payment.update({ where: { id: payment.id }, data: { providerRef } });
      return { order, client: { provider: "STRIPE" as const, clientSecret } };
    }
    const { providerRef } = await createRazorpayOrder(toCharge);
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
        await reserveOrder(tx, order.id, itemMoves(order.items));
        if (order.giftCardCode) await holdGiftCard(tx, order.giftCardCode, order.giftCardAmount);
        await reclaimPreorderAllocation(tx, order.items);
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

    if (order.userId && !order.tradeAccountId) {
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
      // Email + WhatsApp; awaiting-COD orders get the confirmation request instead.
      await notifyOrderStatus(orderId, "confirmed");
      await sendGiftCardEmails(issued, full.email);
    }
    // Subscribe & Save + server-side purchase events (never throws).
    const { afterOrderConfirmed } = await import("./order-confirmed");
    await afterOrderConfirmed(orderId);
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

/**
 * Cancels an order that has not been shipped. Unpaid holds are released; committed stock is returned.
 * `onlyIf` restricts the statuses it may cancel from, checked under a row lock (so e.g. a customer
 * can't cancel an order staff packed a moment ago). Returns whether it cancelled.
 */
export async function cancelOrder(orderId: string, reason: string, onlyIf?: OrderStatus[]) {
  const cancelled = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order || ["CANCELLED", "REFUNDED", "SHIPPED", "DELIVERED"].includes(order.status)) return false;
    if (onlyIf && !onlyIf.includes(order.status)) return false;
    const moves = itemMoves(order.items);
    if (order.reservedUntil) {
      for (const m of moves) await release(tx, m.variantId, m.qty, order.id);
    } else {
      for (const m of moves) await adjustStock(tx, m.variantId, m.qty, "RETURN", undefined, order.id);
      await reverseLoyalty(tx, order, "cancellation of");
    }
    if (order.giftCardCode) await restoreGiftCard(tx, order.giftCardCode, order.giftCardAmount);
    await voidIssuedGiftCards(tx, orderId);
    await releasePreorderAllocation(tx, order.items);
    await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED", reservedUntil: null, ...(order.codStatus === "AWAITING" ? { codStatus: "CANCELLED" as const, codTokenHash: null } : {}) } });
    await tx.payment.updateMany({ where: { orderId, status: { in: ["CREATED", "AUTHORIZED"] } }, data: { status: "FAILED" } });
    await tx.orderEvent.create({ data: { orderId, status: "CANCELLED", message: reason } });
    return true;
  });
  if (cancelled) await reconcileCommission(orderId).catch((e) => console.error("[affiliates] reconcile", e));
  // GST credit note straight away if this order was already invoiced (no-op otherwise; the daily sync is the backstop).
  if (cancelled) await import("./accounting/documents").then((m) => m.creditNoteOnOrderClosed(orderId));
  return cancelled;
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
    if (!["CANCELLED", "REFUNDED"].includes(order.status)) await releasePreorderAllocation(tx, order.items);
    if (payment) await tx.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
    if (order.giftCardCode && !["CANCELLED", "REFUNDED"].includes(order.status)) await restoreGiftCard(tx, order.giftCardCode, order.giftCardAmount);
    await voidIssuedGiftCards(tx, orderId);
    await tx.order.update({ where: { id: orderId }, data: { status: "REFUNDED", reservedUntil: null } });
    await tx.orderEvent.create({ data: { orderId, status: "REFUNDED", message: reason } });
    await reverseLoyalty(tx, order, "refund of");
  });
  await reconcileCommission(orderId).catch((e) => console.error("[affiliates] reconcile", e));
  await import("./accounting/documents").then((m) => m.creditNoteOnOrderClosed(orderId));
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
  // COD verification hold (src/server/cod.ts): don't pack until the customer has confirmed.
  if (order.codStatus === "AWAITING") throw new Error("This cash-on-delivery order is awaiting the customer’s confirmation.");
  // Pre-order hold (src/lib/preorder.ts): nothing to pack or ship until the pre-ordered stock is released.
  if (to === "PACKED" || to === "SHIPPED") {
    const hold = orderPreorderHold(await db.orderItem.findMany({ where: { orderId }, select: { meta: true } }));
    if (hold) throw new Error("This order has pre-order pieces still waiting for stock — release them from Promotions › Pre-orders first.");
  }

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
  // Email + WhatsApp via the notification hub (idempotent per order + event).
  if (to === "SHIPPED" || to === "DELIVERED") await notifyOrderStatus(updated.id, to === "SHIPPED" ? "shipped" : "delivered");
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
