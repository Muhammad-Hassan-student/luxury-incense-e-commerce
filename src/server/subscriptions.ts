import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PaymentProvider, Prisma, Subscription } from "@/generated/prisma/client";
import { brand } from "@/config/brand";
import { env } from "@/env";
import { price } from "@/lib/pricing";
import { formatMoney } from "@/lib/money";
import { SimpleEmail } from "@/emails/simple";
import { db } from "./db";
import { OutOfStockError, reserve } from "./inventory";
import { getSettings } from "./settings";
import { sendEmail } from "./email";
import { chargeSavedCard, paymentProviders, savedPaymentMethod } from "./payments";

/**
 * Subscribe & Save.
 *
 * A subscription is created when a prepaid (Stripe/Razorpay) order containing a "subscribe" line is paid.
 * `nextRunAt` is the due date of the current cycle. The daily `subscriptions` cron:
 *   1. settles open renewals (order paid → next cycle; order cancelled/expired → failure),
 *   2. creates the renewal order for every due subscription (stock reserved for `payWindowDays`), then charges the
 *      saved Stripe card off-session, or emails a one-click payment link (Razorpay, or no saved card),
 *   3. emails "renews in 3 days" reminders.
 * Failures retry after `retryDays`; after `maxFailures` in a row the subscription pauses itself.
 * Everything is idempotent: a renewal row is unique per (subscription, due date, attempt) and created under a
 * row lock, so overlapping or repeated cron runs never create a second order.
 */

// ─────────────────────────────── Settings ───────────────────────────────

export const subscriptionSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  discountPercent: z.number().int().min(0).max(50).default(10),
  maxFailures: z.number().int().min(1).max(10).default(3),
  retryDays: z.number().int().min(1).max(14).default(2),
  /** How long a renewal waits for payment (and holds stock) before it counts as failed. */
  payWindowDays: z.number().int().min(1).max(7).default(3),
  reminderDays: z.number().int().min(1).max(14).default(3),
});
export type SubscriptionSettings = z.infer<typeof subscriptionSettingsSchema>;
const SETTINGS_KEY = "subscriptions";

export async function getSubscriptionSettings(): Promise<SubscriptionSettings> {
  const row = await db.setting.findUnique({ where: { key: SETTINGS_KEY } });
  const parsed = subscriptionSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : subscriptionSettingsSchema.parse({});
}

export async function saveSubscriptionSettings(input: Partial<SubscriptionSettings>) {
  const next = subscriptionSettingsSchema.parse({ ...(await getSubscriptionSettings()), ...input });
  await db.setting.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, value: next }, update: { value: next } });
  return next;
}

// ─────────────────────────────── Helpers ───────────────────────────────

export const INTERVALS = [1, 2, 3] as const;
export type IntervalMonths = (typeof INTERVALS)[number];
export const isInterval = (n: unknown): n is IntervalMonths => INTERVALS.includes(n as IntervalMonths);
export const intervalLabel = (m: number) => (m === 1 ? "Every month" : `Every ${m} months`);

/** Calendar months, clamped to the last day (31 Jan + 1 → 28/29 Feb). */
export function addMonths(d: Date, months: number) {
  const r = new Date(d);
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + months);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
export const discounted = (unitPrice: number, pct: number) => Math.round((unitPrice * (100 - pct)) / 100);

const fmtDay = (d: Date) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(d);

/** Order-item meta written at checkout for a subscribe line. */
export type SubscriptionMeta = { intervalMonths: IntervalMonths; discountPercent: number };

// ─────────────────────────────── Pay links ───────────────────────────────

const linkKey = () => createHmac("sha256", env.AUTH_SECRET).update("maison-oud/pay-link/v1").digest();
const sign = (orderId: string) => createHmac("sha256", linkKey()).update(orderId).digest("base64url").slice(0, 32);

/** Unguessable, stateless token for "pay this renewal" links (bound to one order id). */
export const payToken = (orderId: string) => `${Buffer.from(orderId).toString("base64url")}.${sign(orderId)}`;
export function orderIdFromPayToken(token: string): string | null {
  const [a, sig] = token.split(".");
  if (!a || !sig) return null;
  const id = Buffer.from(a, "base64url").toString("utf8");
  const expected = Buffer.from(sign(id));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got) ? id : null;
}
export const payLinkPath = (orderId: string) => `/pay/${payToken(orderId)}`;

// ─────────────────────────────── Creation at checkout ───────────────────────────────

/**
 * Turns the subscribe lines of a paid, prepaid order into subscriptions. Idempotent (unique per origin order and
 * variant). For Stripe, the card saved during checkout is kept for off-session renewals. Never throws.
 */
export async function createSubscriptionsForOrder(orderId: string) {
  try {
    const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true, payments: { orderBy: { createdAt: "asc" } } } });
    if (!order?.userId) return 0;
    const payment = order.payments[0];
    if (!payment || (payment.provider !== "STRIPE" && payment.provider !== "RAZORPAY") || payment.status !== "CAPTURED") return 0;
    const lines = order.items
      .map((i) => ({ item: i, sub: (i.meta as { subscription?: SubscriptionMeta } | null)?.subscription }))
      .filter((x): x is { item: typeof x.item; sub: SubscriptionMeta } => Boolean(x.sub && x.item.variantId && isInterval(x.sub.intervalMonths)));
    if (!lines.length) return 0;

    let saved: { customer: string | null; paymentMethod: string | null } = { customer: null, paymentMethod: null };
    if (payment.provider === "STRIPE" && payment.providerRef) {
      saved = await savedPaymentMethod(payment.providerRef).catch((e) => {
        console.error("[subscriptions] could not read the saved card", (e as Error).message);
        return { customer: null, paymentMethod: null };
      });
    }
    const addr = order.shippingAddress as Prisma.InputJsonObject;
    const rate = order.carrier ? await db.shippingRate.findFirst({ where: { name: order.carrier }, select: { id: true } }) : null;
    const res = await db.subscription.createMany({
      data: lines.map(({ item, sub }) => ({
        userId: order.userId!,
        variantId: item.variantId!,
        quantity: item.quantity,
        intervalMonths: sub.intervalMonths,
        intervalDays: sub.intervalMonths * 30,
        discountPercent: sub.discountPercent,
        nextRunAt: addMonths(order.placedAt, sub.intervalMonths),
        provider: payment.provider,
        email: order.email,
        shippingAddress: addr,
        shippingRateId: rate?.id ?? null,
        originOrderId: order.id,
        customerRef: saved.customer,
        paymentMethodRef: saved.paymentMethod,
      })),
      skipDuplicates: true,
    });
    if (res.count) {
      await db.orderEvent.create({ data: { orderId, status: order.status, message: `Subscribe & Save started (${res.count} subscription${res.count > 1 ? "s" : ""})` } });
    }
    return res.count;
  } catch (e) {
    console.error("[subscriptions] create failed", e);
    return 0;
  }
}

// ─────────────────────────────── Renewal orders ───────────────────────────────

type SubWithVariant = Prisma.SubscriptionGetPayload<{ include: { variant: { include: { product: { select: { name: true; isActive: true; isGiftCard: true } } } }; user: { select: { email: true } } } }>;
const subInclude = { variant: { include: { product: { select: { name: true, isActive: true, isGiftCard: true } } } }, user: { select: { email: true } } } as const;

const orderNumber = () => `MO-${new Date().getFullYear() % 100}${String(randomInt(0, 1e6)).padStart(6, "0")}`;

async function chooseProvider(preferred: PaymentProvider | null): Promise<PaymentProvider | null> {
  const p = await paymentProviders();
  if (preferred === "STRIPE" && p.stripe) return "STRIPE";
  if (preferred === "RAZORPAY" && p.razorpay) return "RAZORPAY";
  return p.razorpay ? "RAZORPAY" : p.stripe ? "STRIPE" : null;
}

const recipient = (s: { email: string; user?: { email: string } | null }) => s.email || s.user?.email || "";

async function notify(to: string, subject: string, title: string, body: string, cta?: { label: string; path: string }) {
  if (!to) return;
  await sendEmail({ to, subject, react: SimpleEmail({ preview: title, title, body, cta }) }).catch((e) => console.error("[subscriptions] email failed", e));
}

/** Records a failed attempt: retry later, or pause after too many in a row. */
async function recordFailure(subId: string, renewalId: string | null, error: string, now: Date) {
  const settings = await getSubscriptionSettings();
  if (renewalId) {
    const claimed = await db.subscriptionRenewal.updateMany({ where: { id: renewalId, status: "PENDING" }, data: { status: "FAILED", error: error.slice(0, 500), resolvedAt: now } });
    if (claimed.count === 0) return null; // already settled by another run
  }
  const sub = await db.subscription.update({
    where: { id: subId },
    data: { failureCount: { increment: 1 }, lastError: error.slice(0, 500), retryAt: addDays(now, settings.retryDays) },
    include: subInclude,
  });
  const name = sub.variant.product.name;
  if (sub.failureCount >= settings.maxFailures && sub.status === "ACTIVE") {
    await db.subscription.update({ where: { id: sub.id }, data: { status: "PAUSED", pausedAt: now, pauseReason: "payment_failed", retryAt: null } });
    await notify(recipient(sub), `Your ${name} subscription is paused`, "Subscription paused", `We couldn’t complete your ${name} renewal after ${sub.failureCount} attempts (${error}). Your subscription is paused — resume it whenever you like.`, { label: "Manage subscription", path: "/account/subscriptions" });
    return "paused" as const;
  }
  await notify(recipient(sub), `We couldn’t renew your ${name}`, "Renewal didn’t go through", `Your ${name} renewal couldn’t be completed (${error}). We’ll try again on ${fmtDay(addDays(now, settings.retryDays))}.`, { label: "Manage subscription", path: "/account/subscriptions" });
  return "retry" as const;
}

/** A renewal order was paid: advance the cycle (idempotent — only the first caller wins). */
export async function settleRenewalPaid(renewalId: string, now = new Date()) {
  const claimed = await db.subscriptionRenewal.updateMany({ where: { id: renewalId, status: "PENDING" }, data: { status: "PAID", resolvedAt: now } });
  if (claimed.count === 0) return false;
  const r = await db.subscriptionRenewal.findUniqueOrThrow({ where: { id: renewalId }, include: { subscription: { include: subInclude } } });
  const sub = r.subscription;
  const next = addMonths(r.dueAt, sub.intervalMonths);
  await db.subscription.updateMany({
    where: { id: sub.id, nextRunAt: r.dueAt },
    data: { nextRunAt: next, failureCount: 0, retryAt: null, lastError: null },
  });
  await db.subscription.update({ where: { id: sub.id }, data: { failureCount: 0, retryAt: null, lastError: null } });
  const order = r.orderId ? await db.order.findUnique({ where: { id: r.orderId }, select: { number: true, total: true } }) : null;
  await notify(
    recipient(sub),
    `Your ${sub.variant.product.name} is on its way`,
    "Subscription renewed",
    `Thank you — your renewal${order ? ` (order ${order.number}, ${formatMoney(order.total)})` : ""} is confirmed and will be wrapped by hand. Next renewal: ${fmtDay(next)}.`,
    { label: "Manage subscription", path: "/account/subscriptions" },
  );
  return true;
}

/**
 * Creates the renewal order for one due subscription, then tries to collect payment.
 * Returns what happened; returns "skipped" when another run got there first.
 */
export async function renewSubscription(subId: string, now = new Date()): Promise<"skipped" | "charged" | "link" | "failed" | "paused"> {
  const settings = await getSubscriptionSettings();
  // 1. Claim the attempt under a row lock (overlapping cron runs serialise here).
  const claim = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${subId} FOR UPDATE`;
    const sub = await tx.subscription.findUnique({ where: { id: subId } });
    if (!sub || sub.status !== "ACTIVE" || sub.nextRunAt > now || (sub.retryAt && sub.retryAt > now)) return null;
    if (await tx.subscriptionRenewal.count({ where: { subscriptionId: sub.id, status: "PENDING" } })) return null;
    const attempt = (await tx.subscriptionRenewal.count({ where: { subscriptionId: sub.id, dueAt: sub.nextRunAt } })) + 1;
    const renewal = await tx.subscriptionRenewal.create({ data: { subscriptionId: sub.id, dueAt: sub.nextRunAt, attempt } });
    return { renewalId: renewal.id };
  });
  if (!claim) return "skipped";
  const sub = (await db.subscription.findUniqueOrThrow({ where: { id: subId }, include: subInclude })) as SubWithVariant;
  const fail = async (why: string) => ((await recordFailure(sub.id, claim.renewalId, why, now)) === "paused" ? "paused" : "failed");

  if (!sub.variant.product.isActive || sub.variant.product.isGiftCard) return fail("this piece is no longer available");
  const provider = await chooseProvider(sub.provider);
  if (!provider) return fail("online payments are not set up");

  // 2. Price it like checkout (discounted unit price, shipping rate, tax settings) and hold the stock.
  const [store, rate] = await Promise.all([
    getSettings(),
    sub.shippingRateId ? db.shippingRate.findUnique({ where: { id: sub.shippingRateId } }) : null,
  ]);
  const address = (sub.shippingAddress ?? {}) as { country?: string };
  const fallbackRate = rate ?? (await db.shippingRate.findFirst({ where: { OR: [{ countries: { has: address.country ?? "IN" } }, { countries: { has: "*" } }] }, orderBy: { position: "asc" } }));
  const unitPrice = discounted(sub.variant.price, sub.discountPercent);
  const pricing = price({
    lines: [{ unitPrice, quantity: sub.quantity }],
    shipping: fallbackRate,
    pointValue: brand.loyalty.pointValue,
    taxRatePercent: store.taxRatePercent,
    taxInclusive: store.taxInclusive,
  });
  let order;
  try {
    order = await db.$transaction(async (tx) => {
      const o = await tx.order.create({
        data: {
          number: orderNumber(),
          userId: sub.userId,
          email: recipient(sub),
          currency: brand.baseCurrency,
          subtotal: pricing.subtotal,
          shipping: pricing.shipping,
          tax: pricing.tax,
          total: pricing.total,
          shippingAddress: (sub.shippingAddress ?? {}) as Prisma.InputJsonObject,
          carrier: fallbackRate?.name,
          notes: `Subscribe & Save renewal (${intervalLabel(sub.intervalMonths).toLowerCase()})`,
          reservedUntil: addDays(now, settings.payWindowDays),
          items: {
            create: [
              {
                variantId: sub.variantId,
                name: sub.variant.product.name,
                label: `${sub.variant.label} · Subscribe & Save`,
                sku: sub.variant.sku,
                unitPrice,
                quantity: sub.quantity,
                meta: { renewalOf: sub.id },
              },
            ],
          },
          payments: { create: { provider, amount: pricing.total, currency: brand.baseCurrency, raw: { subscriptionId: sub.id, renewalId: claim.renewalId } } },
          events: { create: { status: "PENDING", message: "Subscription renewal — awaiting payment" } },
        },
        include: { payments: true },
      });
      await reserve(tx, sub.variantId, sub.quantity, o.id);
      await tx.subscriptionRenewal.update({ where: { id: claim.renewalId }, data: { orderId: o.id } });
      return o;
    });
  } catch (e) {
    if (e instanceof OutOfStockError) return fail("out of stock");
    console.error("[subscriptions] renewal order failed", e);
    return fail("we couldn’t create the renewal order");
  }

  // 3. Collect: saved card off-session where we have one, otherwise a one-click payment link.
  if (provider === "STRIPE" && sub.customerRef && sub.paymentMethodRef) {
    const r = await chargeSavedCard({ orderId: order.id, number: order.number, amount: order.total, currency: order.currency, customer: sub.customerRef, paymentMethod: sub.paymentMethodRef, email: order.email }).catch((e) => ({
      intent: null,
      error: (e as Error).message,
    }));
    if (r.intent) await db.payment.update({ where: { id: order.payments[0].id }, data: { providerRef: r.intent.id } });
    if (r.intent?.status === "succeeded") {
      const { confirmOrder } = await import("./orders");
      await confirmOrder(order.id, { captured: true, raw: { chargeId: String(r.intent.latest_charge ?? "") } });
      await settleRenewalPaid(claim.renewalId, now);
      return "charged";
    }
    // Declined or needs authentication: fall through to the payment link.
    await db.orderEvent.create({ data: { orderId: order.id, status: "PENDING", message: `Saved card not charged (${r.error ?? r.intent?.status ?? "unknown"}) — payment link sent` } });
  }
  const until = addDays(now, settings.payWindowDays);
  await notify(
    recipient(sub),
    `Your ${sub.variant.product.name} renewal is ready`,
    "Complete your renewal",
    `Your Subscribe & Save renewal of ${sub.quantity} × ${sub.variant.product.name} (${formatMoney(order.total)}) is set aside for you until ${fmtDay(until)}. One tap to pay and we’ll ship it.`,
    { label: `Pay ${formatMoney(order.total)}`, path: payLinkPath(order.id) },
  );
  return "link";
}

/** Order outcome of open renewals: paid → advance; cancelled/expired → failure. */
export async function syncOpenRenewals(now = new Date()) {
  const open = await db.subscriptionRenewal.findMany({ where: { status: "PENDING", orderId: { not: null } }, take: 500 });
  let paid = 0;
  let failed = 0;
  for (const r of open) {
    const o = await db.order.findUnique({ where: { id: r.orderId! }, select: { status: true, reservedUntil: true } });
    if (!o || o.status === "CANCELLED" || o.status === "REFUNDED") {
      if (await recordFailure(r.subscriptionId, r.id, o ? "payment wasn’t completed in time" : "renewal order missing", now)) failed++;
    } else if (!o.reservedUntil && o.status !== "PENDING") {
      if (await settleRenewalPaid(r.id, now)) paid++;
    }
  }
  // A renewal claimed but never turned into an order (crash between steps): count it as a failure.
  const orphans = await db.subscriptionRenewal.findMany({ where: { status: "PENDING", orderId: null, createdAt: { lt: new Date(now.getTime() - 60 * 60_000) } }, take: 100 });
  for (const r of orphans) if (await recordFailure(r.subscriptionId, r.id, "renewal could not be started", now)) failed++;
  return { paid, failed };
}

/** "Renews in N days" email, once per cycle. */
export async function sendUpcomingReminders(now = new Date()) {
  const settings = await getSubscriptionSettings();
  const subs = await db.subscription.findMany({
    where: { status: "ACTIVE", nextRunAt: { gt: now, lte: addDays(now, settings.reminderDays) } },
    include: subInclude,
    take: 500,
  });
  let sent = 0;
  for (const s of subs) {
    if (s.reminderFor && s.reminderFor.getTime() === s.nextRunAt.getTime()) continue;
    const claimed = await db.subscription.updateMany({ where: { id: s.id, OR: [{ reminderFor: null }, { reminderFor: { not: s.nextRunAt } }] }, data: { reminderFor: s.nextRunAt } });
    if (!claimed.count) continue;
    const amount = formatMoney(discounted(s.variant.price, s.discountPercent) * s.quantity);
    await notify(
      recipient(s),
      `Your ${s.variant.product.name} renews on ${fmtDay(s.nextRunAt)}`,
      "Your next delivery",
      `${s.quantity} × ${s.variant.product.name} (${s.variant.label}) renews on ${fmtDay(s.nextRunAt)} for ${amount} plus any shipping. Want it later, a different amount, or a pause? Change it in a tap.`,
      { label: "Manage subscription", path: "/account/subscriptions" },
    );
    sent++;
  }
  return sent;
}

/** The daily cron job. Safe to run repeatedly (and concurrently). */
export async function runSubscriptions(now = new Date()) {
  const settled = await syncOpenRenewals(now);
  const due = await db.subscription.findMany({
    where: { status: "ACTIVE", nextRunAt: { lte: now }, OR: [{ retryAt: null }, { retryAt: { lte: now } }], renewals: { none: { status: "PENDING" } } },
    select: { id: true },
    orderBy: { nextRunAt: "asc" },
    take: 200,
  });
  const outcome = { charged: 0, link: 0, failed: 0, paused: 0, skipped: 0 };
  for (const s of due) {
    try {
      outcome[await renewSubscription(s.id, now)]++;
    } catch (e) {
      console.error("[subscriptions] renewal crashed", s.id, e);
      outcome.failed++;
    }
  }
  const reminded = await sendUpcomingReminders(now);
  // settled: earlier renewals now paid / given up on; the rest: what happened to today's due subscriptions.
  return { renewalsPaid: settled.paid, renewalsFailed: settled.failed, due: due.length, ...outcome, reminded };
}

// ─────────────────────────────── Changes (customer portal + admin) ───────────────────────────────

export type SubscriptionChange =
  | { type: "skip" }
  | { type: "interval"; months: IntervalMonths }
  | { type: "quantity"; quantity: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "cancel" }
  | { type: "renew_now" };

export class SubscriptionRuleError extends Error {}

/**
 * Applies one change, enforcing the rules (cancelled is final; skip only when nothing is being processed;
 * pause only when active; resume only when paused). Returns the updated subscription.
 */
export async function changeSubscription(subId: string, change: SubscriptionChange, by: "customer" | "staff", now = new Date()): Promise<Subscription> {
  const sub = await db.subscription.findUnique({ where: { id: subId }, include: { renewals: { where: { status: "PENDING" } } } });
  if (!sub) throw new SubscriptionRuleError("Subscription not found.");
  if (sub.status === "CANCELLED") throw new SubscriptionRuleError("This subscription has been cancelled.");
  const processing = sub.renewals.length > 0;

  switch (change.type) {
    case "skip": {
      if (sub.status !== "ACTIVE") throw new SubscriptionRuleError("Resume the subscription before skipping a delivery.");
      if (processing) throw new SubscriptionRuleError("Your next renewal is already being processed — pay or wait for it, then skip the one after.");
      return db.subscription.update({ where: { id: sub.id }, data: { nextRunAt: addMonths(sub.nextRunAt, sub.intervalMonths), retryAt: null } });
    }
    case "interval": {
      if (!isInterval(change.months)) throw new SubscriptionRuleError("Choose every 1, 2 or 3 months.");
      return db.subscription.update({ where: { id: sub.id }, data: { intervalMonths: change.months, intervalDays: change.months * 30 } });
    }
    case "quantity": {
      if (!Number.isInteger(change.quantity) || change.quantity < 1 || change.quantity > 10) throw new SubscriptionRuleError("Quantity must be between 1 and 10.");
      return db.subscription.update({ where: { id: sub.id }, data: { quantity: change.quantity } });
    }
    case "pause": {
      if (sub.status !== "ACTIVE") throw new SubscriptionRuleError("Only an active subscription can be paused.");
      return db.subscription.update({ where: { id: sub.id }, data: { status: "PAUSED", pausedAt: now, pauseReason: by, retryAt: null } });
    }
    case "resume": {
      if (sub.status !== "PAUSED") throw new SubscriptionRuleError("Only a paused subscription can be resumed.");
      // Never bill in the past: the next renewal is at the earliest tomorrow.
      const tomorrow = addDays(now, 1);
      return db.subscription.update({
        where: { id: sub.id },
        data: { status: "ACTIVE", pausedAt: null, pauseReason: null, failureCount: 0, retryAt: null, lastError: null, nextRunAt: sub.nextRunAt < tomorrow ? tomorrow : sub.nextRunAt },
      });
    }
    case "renew_now": {
      if (by !== "staff") throw new SubscriptionRuleError("Not allowed.");
      if (sub.status !== "ACTIVE") throw new SubscriptionRuleError("Resume the subscription first.");
      if (processing) throw new SubscriptionRuleError("A renewal is already awaiting payment.");
      await db.subscription.update({ where: { id: sub.id }, data: { nextRunAt: now, retryAt: null } });
      await renewSubscription(sub.id, now);
      return db.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    }
    case "cancel": {
      // Release an unpaid renewal too, so its stock goes back on the shelf.
      for (const r of sub.renewals) {
        await db.subscriptionRenewal.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: "SKIPPED", error: "subscription cancelled", resolvedAt: now } });
        if (r.orderId) {
          const { cancelOrder } = await import("./orders");
          await cancelOrder(r.orderId, "Subscription cancelled before payment", ["PENDING"]);
        }
      }
      return db.subscription.update({ where: { id: sub.id }, data: { status: "CANCELLED", cancelledAt: now, retryAt: null } });
    }
  }
}

// ─────────────────────────────── Reporting ───────────────────────────────

/** Monthly recurring revenue (minor units), churn over the last 30 days, counts. */
export async function subscriptionStats(now = new Date()) {
  const [active, paused, cancelled30, upcoming] = await Promise.all([
    db.subscription.findMany({ where: { status: "ACTIVE" }, select: { quantity: true, intervalMonths: true, discountPercent: true, variant: { select: { price: true } } } }),
    db.subscription.count({ where: { status: "PAUSED" } }),
    db.subscription.count({ where: { status: "CANCELLED", cancelledAt: { gte: addDays(now, -30) } } }),
    db.subscription.count({ where: { status: "ACTIVE", nextRunAt: { lte: addDays(now, 7) } } }),
  ]);
  const mrr = Math.round(active.reduce((s, x) => s + (discounted(x.variant.price, x.discountPercent) * x.quantity) / x.intervalMonths, 0));
  const base = active.length + paused + cancelled30;
  return { mrr, active: active.length, paused, cancelled30, churn30: base ? cancelled30 / base : 0, upcoming7: upcoming };
}
