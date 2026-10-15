import "server-only";
import { brand } from "@/config/brand";
import { formatMoney } from "@/lib/money";
import { productHref } from "@/lib/product-href";
import { DEFAULT_PREFS, isPushEndpoint, MARKETING_CHANNELS, PREF_FIELD, type BroadcastSegment, type NotificationPrefs, type PushChannel } from "@/lib/push-shared";
import { SEGMENTS } from "@/lib/segments";
import { db } from "../db";
import { forgetIntegrations, getIntegration, saveIntegration } from "../integrations";
import { journeyEmailsAllowed } from "../marketing";
import { recordIntegration } from "../monitoring";

/*
 * Web push (VAPID): device subscriptions per customer, per-channel preferences, frequency caps for marketing
 * channels, and senders for every channel. Delivery goes through `sender` — the real one uses the `web-push`
 * package; tests swap in a fake with setPushSender(). Subscriptions the push service reports gone (404/410) are
 * deleted immediately; ones that keep failing are deleted after MAX_FAILURES.
 */

export type PushMessage = { title: string; body: string; url?: string; tag?: string; image?: string };
type Localised = PushMessage | ((locale: string) => PushMessage);
type Sub = { id: string; endpoint: string; p256dh: string; auth: string; locale: string };

const MAX_FAILURES = 8;

// ─────────────────────────────── VAPID keys ───────────────────────────────

let webpushModule: typeof import("web-push").default | null = null;
async function webpush() {
  webpushModule ??= (await import("web-push")).default;
  return webpushModule;
}

/**
 * The VAPID key pair, generated once and saved (encrypted) in Admin → Integrations → Web push. A Postgres advisory
 * lock makes concurrent first requests agree on one pair (a second pair would orphan every subscription).
 */
export async function ensureVapidKeys(): Promise<{ publicKey: string; privateKey: string; subject: string; generated: boolean }> {
  const subjectOf = (s: string) => (/^(mailto:|https:\/\/)/.test(s) ? s : s.includes("@") ? `mailto:${s}` : `mailto:${brand.email}`);
  const c = await getIntegration("push");
  if (c.vapidPublicKey && c.vapidPrivateKey) return { publicKey: c.vapidPublicKey, privateKey: c.vapidPrivateKey, subject: subjectOf(c.subject), generated: false };
  let generated = false;
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(724501)`;
      forgetIntegrations();
      const again = await getIntegration("push");
      if (again.vapidPublicKey && again.vapidPrivateKey) return;
      const keys = (await webpush()).generateVAPIDKeys();
      await saveIntegration("push", { vapidPublicKey: keys.publicKey, vapidPrivateKey: keys.privateKey });
      generated = true;
    },
    { timeout: 20_000, maxWait: 20_000 },
  );
  forgetIntegrations();
  const saved = await getIntegration("push");
  return { publicKey: saved.vapidPublicKey, privateKey: saved.vapidPrivateKey, subject: subjectOf(saved.subject), generated };
}

/** What the browser needs to subscribe. */
export async function pushClientConfig() {
  const c = await getIntegration("push");
  if (!c.enabled) return { enabled: false as const, publicKey: null };
  const { publicKey } = await ensureVapidKeys();
  return { enabled: true as const, publicKey };
}

// ─────────────────────────────── Sender (injectable) ───────────────────────────────

export type SendOutcome = { ok: true } | { ok: false; statusCode?: number; error: string };
export type PushSender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, opts: { ttl: number; urgency: "low" | "normal" | "high"; topic?: string }) => Promise<SendOutcome>;

const realSender: PushSender = async (sub, payload, opts) => {
  const keys = await ensureVapidKeys();
  try {
    await (await webpush()).sendNotification(sub, payload, {
      vapidDetails: { subject: keys.subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
      TTL: opts.ttl,
      urgency: opts.urgency,
      ...(opts.topic ? { topic: opts.topic } : {}),
      timeout: 10_000,
    });
    return { ok: true };
  } catch (e) {
    const err = e as { statusCode?: number; body?: string; message?: string };
    return { ok: false, statusCode: err.statusCode, error: (err.body || err.message || "push failed").slice(0, 300) };
  }
};

let sender: PushSender = realSender;
/** Tests: replace delivery (pass null to restore the real sender). */
export const setPushSender = (fn: PushSender | null) => {
  sender = fn ?? realSender;
};

// ─────────────────────────────── Subscriptions & preferences ───────────────────────────────

export class PushError extends Error {}

export async function saveSubscription(input: { userId: string | null; endpoint: string; p256dh: string; auth: string; userAgent?: string | null; locale?: string | null; replaces?: string | null }) {
  if (!isPushEndpoint(input.endpoint)) throw new PushError("Unsupported push service.");
  if (!/^[A-Za-z0-9_-]{40,200}={0,2}$/.test(input.p256dh) || !/^[A-Za-z0-9_-]{10,100}={0,2}$/.test(input.auth)) throw new PushError("Invalid subscription keys.");
  if (input.replaces && input.replaces !== input.endpoint) await db.pushSubscription.deleteMany({ where: { endpoint: input.replaces, ...(input.userId ? { userId: input.userId } : {}) } });
  const data = { userId: input.userId, p256dh: input.p256dh, auth: input.auth, userAgent: input.userAgent?.slice(0, 300) ?? null, locale: input.locale === "ar" ? "ar" : "en", failures: 0, lastError: null };
  // One device = one endpoint: re-subscribing (or another account signing in on the device) takes it over.
  return db.pushSubscription.upsert({ where: { endpoint: input.endpoint }, create: { endpoint: input.endpoint, ...data }, update: data });
}

export async function removeSubscription(endpoint: string, userId?: string | null) {
  const r = await db.pushSubscription.deleteMany({ where: { endpoint, ...(userId ? { userId } : {}) } });
  return r.count;
}

export async function listDevices(userId: string) {
  return db.pushSubscription.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true, endpoint: true, userAgent: true, createdAt: true, lastSuccessAt: true } });
}

export async function getPreferences(userId: string): Promise<NotificationPrefs> {
  const p = await db.notificationPreference.findUnique({ where: { userId } });
  return p ? { orders: p.orders, backInStock: p.backInStock, priceDrop: p.priceDrop, abandonedBag: p.abandonedBag, news: p.news } : { ...DEFAULT_PREFS };
}

export async function savePreferences(userId: string, patch: Partial<NotificationPrefs>) {
  const clean = Object.fromEntries(Object.entries(patch).filter(([k, v]) => k in DEFAULT_PREFS && typeof v === "boolean")) as Partial<NotificationPrefs>;
  return db.notificationPreference.upsert({ where: { userId }, create: { userId, ...DEFAULT_PREFS, ...clean }, update: clean });
}

// ─────────────────────────────── Policy ───────────────────────────────

export type SkipReason = "disabled" | "no_devices" | "preference" | "marketing_opt_out" | "daily_cap" | "weekly_cap" | "duplicate";

/** Whether a user may receive a push on `channel` right now (preferences, marketing opt-out, caps). */
export async function pushAllowed(userId: string, channel: PushChannel, now = new Date()): Promise<{ ok: true } | { ok: false; reason: SkipReason }> {
  const c = await getIntegration("push");
  if (!c.enabled) return { ok: false, reason: "disabled" };
  if (channel === "test") return { ok: true };
  const prefs = await getPreferences(userId);
  if (!prefs[PREF_FIELD[channel]]) return { ok: false, reason: "preference" };
  if (MARKETING_CHANNELS.includes(channel)) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user || !(await journeyEmailsAllowed(user.email))) return { ok: false, reason: "marketing_opt_out" };
    const marketing = { userId, channel: { in: MARKETING_CHANNELS as PushChannel[] }, sent: { gt: 0 } };
    const day = await db.pushLog.count({ where: { ...marketing, createdAt: { gte: new Date(now.getTime() - 864e5) } } });
    if (day >= c.marketingPerDay) return { ok: false, reason: "daily_cap" };
    const week = await db.pushLog.count({ where: { ...marketing, createdAt: { gte: new Date(now.getTime() - 7 * 864e5) } } });
    if (week >= c.marketingPerWeek) return { ok: false, reason: "weekly_cap" };
  }
  return { ok: true };
}

async function deliver(subs: Sub[], message: Localised, opts: { ttl: number; urgency: "low" | "normal" | "high"; topic?: string }) {
  let sent = 0;
  let failed = 0;
  let pruned = 0;
  for (const s of subs) {
    const m = typeof message === "function" ? message(s.locale) : message;
    const payload = JSON.stringify({ title: m.title.slice(0, 120), body: m.body.slice(0, 300), url: m.url ?? "/", tag: m.tag, image: m.image, lang: s.locale, dir: s.locale === "ar" ? "rtl" : "ltr" });
    const r = await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, opts).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }) as SendOutcome);
    if (r.ok) {
      sent++;
      await db.pushSubscription.update({ where: { id: s.id }, data: { lastSuccessAt: new Date(), failures: 0, lastError: null } }).catch(() => {});
      continue;
    }
    failed++;
    if (r.statusCode === 404 || r.statusCode === 410) {
      // Expired or unsubscribed in the browser: the push service will never accept it again.
      await db.pushSubscription.deleteMany({ where: { id: s.id } });
      pruned++;
      continue;
    }
    const row = await db.pushSubscription.update({ where: { id: s.id }, data: { failures: { increment: 1 }, lastError: r.error.slice(0, 300) } }).catch(() => null);
    if (row && row.failures >= MAX_FAILURES) {
      await db.pushSubscription.deleteMany({ where: { id: s.id } });
      pruned++;
    }
  }
  if (sent) void recordIntegration("push", true);
  if (failed - pruned > 0) void recordIntegration("push", false, `${failed - pruned} push deliveries failed`);
  return { sent, failed, pruned };
}

const subSelect = { id: true, endpoint: true, p256dh: true, auth: true, locale: true } as const;

export type PushResult = { sent: number; failed: number; pruned: number; skipped?: SkipReason };

/**
 * Sends to every device of one user, after the policy check. `dedupeKey` makes the call idempotent (cron reruns,
 * overlapping triggers): a second call with the same key is skipped.
 */
export async function sendToUser(userId: string, channel: PushChannel, message: Localised, opts: { dedupeKey?: string; broadcastId?: string; urgency?: "low" | "normal" | "high" } = {}): Promise<PushResult> {
  const allowed = await pushAllowed(userId, channel);
  if (!allowed.ok) return { sent: 0, failed: 0, pruned: 0, skipped: allowed.reason };
  const subs = await db.pushSubscription.findMany({ where: { userId }, select: subSelect });
  if (!subs.length) return { sent: 0, failed: 0, pruned: 0, skipped: "no_devices" };
  const sample = typeof message === "function" ? message("en") : message;
  let log: { id: string } | null = null;
  try {
    log = await db.pushLog.create({ data: { userId, channel, dedupeKey: opts.dedupeKey ?? null, title: sample.title.slice(0, 200), body: sample.body.slice(0, 500), url: sample.url ?? null, broadcastId: opts.broadcastId ?? null } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { sent: 0, failed: 0, pruned: 0, skipped: "duplicate" };
    throw e;
  }
  const ttl = channel === "orders" ? 7 * 86400 : 2 * 86400;
  const r = await deliver(subs, message, { ttl, urgency: opts.urgency ?? (channel === "orders" ? "high" : "normal") });
  await db.pushLog.update({ where: { id: log.id }, data: { sent: r.sent, failed: r.failed } });
  return r;
}

// ─────────────────────────────── Channels ───────────────────────────────

type Notice = "confirmed" | "cod_reminder" | "cod_confirmed" | "shipped" | "out_for_delivery" | "delivered" | "cancelled";

const ORDER_TEXT: Record<Notice, { en: (n: string) => [string, string]; ar: (n: string) => [string, string] } | null> = {
  confirmed: { en: (n) => ["Order confirmed", `Thank you — order ${n} is confirmed. We’ll let you know when it ships.`], ar: (n) => ["تم تأكيد الطلب", `شكرًا لك — تم تأكيد الطلب ${n}. سنخبرك عند شحنه.`] },
  cod_confirmed: { en: (n) => ["Order confirmed", `Order ${n} is confirmed and will be wrapped for dispatch.`], ar: (n) => ["تم تأكيد الطلب", `تم تأكيد الطلب ${n} وسيتم تجهيزه للشحن.`] },
  cod_reminder: null,
  shipped: { en: (n) => ["On its way", `Order ${n} has shipped. Tap to track it.`], ar: (n) => ["طلبك في الطريق", `تم شحن الطلب ${n}. اضغط للتتبع.`] },
  out_for_delivery: { en: (n) => ["Out for delivery", `Order ${n} arrives today.`], ar: (n) => ["خرج للتوصيل", `يصل الطلب ${n} اليوم.`] },
  delivered: { en: (n) => ["Delivered", `Order ${n} has been delivered. We hope you love it.`], ar: (n) => ["تم التوصيل", `تم توصيل الطلب ${n}. نتمنى أن ينال إعجابك.`] },
  cancelled: { en: (n) => ["Order cancelled", `Order ${n} was cancelled. Nothing is due.`], ar: (n) => ["تم إلغاء الطلب", `تم إلغاء الطلب ${n}. لا يوجد أي مبلغ مستحق.`] },
};

/** Order status channel — called from src/server/notify.ts. Idempotent per order + notice. Never throws. */
export async function pushOrderStatus(order: { id: string; number: string; userId: string | null }, notice: Notice): Promise<PushResult | null> {
  try {
    const text = ORDER_TEXT[notice];
    if (!order.userId || !text) return null;
    const url = `/account/orders/${encodeURIComponent(order.number)}`;
    return await sendToUser(
      order.userId,
      "orders",
      (locale) => {
        const [title, body] = (locale === "ar" ? text.ar : text.en)(order.number);
        return { title, body, url, tag: `order-${order.number}` };
      },
      { dedupeKey: `order:${order.id}:${notice === "cod_confirmed" ? "confirmed" : notice}` },
    );
  } catch (e) {
    console.error("[push] order status failed", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Back-in-stock channel — called by the stock-alerts cron for each alert it emails. */
export async function pushBackInStock(email: string, product: { id: string; name: string; slug: string }): Promise<PushResult | null> {
  try {
    const user = await db.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
    if (!user) return null;
    return await sendToUser(
      user.id,
      "back_in_stock",
      (locale) => ({
        ...(locale === "ar" ? { title: `${product.name} متوفر من جديد`, body: "وصلت دفعة جديدة — نفدت بسرعة في المرة الماضية." } : { title: `${product.name} is back`, body: "A fresh batch just arrived. It went quickly last time." }),
        url: productHref(product.slug),
        tag: `stock-${product.slug}`,
      }),
      { dedupeKey: `stock:${user.id}:${product.id}:${new Date().toISOString().slice(0, 10)}` },
    );
  } catch (e) {
    console.error("[push] back in stock failed", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Price drops on wishlisted products, compared with the last price seen. Returns counts. */
export async function runPriceDrops() {
  const wished = await db.wishlistItem.findMany({ select: { userId: true, productId: true } });
  const productIds = [...new Set(wished.map((w) => w.productId))];
  if (!productIds.length) return { products: 0, drops: 0, sent: 0 };
  const products = await db.product.findMany({ where: { id: { in: productIds }, isActive: true }, select: { id: true, name: true, slug: true, variants: { select: { price: true, stock: true, reserved: true } } } });
  const snaps = new Map((await db.priceSnapshot.findMany({ where: { productId: { in: productIds } } })).map((s) => [s.productId, s.price]));
  let drops = 0;
  let sent = 0;
  for (const p of products) {
    const inStock = p.variants.filter((v) => v.stock - v.reserved > 0);
    const prices = (inStock.length ? inStock : p.variants).map((v) => v.price);
    if (!prices.length) continue;
    const price = Math.min(...prices);
    const before = snaps.get(p.id);
    await db.priceSnapshot.upsert({ where: { productId: p.id }, create: { productId: p.id, price }, update: { price } });
    if (before === undefined || price >= before || (before - price) / before < 0.01) continue;
    drops++;
    for (const w of wished.filter((x) => x.productId === p.id)) {
      const r = await sendToUser(
        w.userId,
        "price_drop",
        (locale) => ({
          ...(locale === "ar" ? { title: `انخفض سعر ${p.name}`, body: `الآن ${formatMoney(price)} بدلًا من ${formatMoney(before)} — من قائمة أمنياتك.` } : { title: `${p.name} is now ${formatMoney(price)}`, body: `Down from ${formatMoney(before)} — it’s on your wishlist.` }),
          url: productHref(p.slug),
          tag: `price-${p.slug}`,
        }),
        { dedupeKey: `price:${w.userId}:${p.id}:${price}` },
      );
      sent += r.sent;
    }
  }
  return { products: products.length, drops, sent };
}

const BAG_AFTER_MS = 3 * 3600_000;
const BAG_UNTIL_MS = 3 * 864e5;

/** Abandoned-bag push for signed-in customers (marketing: opt-out + caps apply). One per bag version. */
export async function runAbandonedBagPush(now = new Date()) {
  const carts = await db.cart.findMany({
    where: { userId: { not: null }, user: { is: { role: "CUSTOMER" } }, items: { some: {} }, updatedAt: { lt: new Date(now.getTime() - BAG_AFTER_MS), gt: new Date(now.getTime() - BAG_UNTIL_MS) } },
    select: { id: true, userId: true, updatedAt: true, items: { take: 3, select: { variant: { select: { product: { select: { name: true } } } } } } },
    take: 300,
  });
  const userIds = carts.map((c) => c.userId!).filter(Boolean);
  const withPush = new Set((await db.pushSubscription.findMany({ where: { userId: { in: userIds } }, select: { userId: true }, distinct: ["userId"] })).map((s) => s.userId));
  let sent = 0;
  let skipped = 0;
  for (const c of carts) {
    if (!c.userId || !withPush.has(c.userId)) continue;
    const names = c.items.map((i) => i.variant.product.name).join(", ");
    const r = await sendToUser(
      c.userId,
      "abandoned_bag",
      (locale) => ({ ...(locale === "ar" ? { title: "حقيبتك بانتظارك", body: `احتفظنا لك بـ ${names}. الدفعات الصغيرة تنفد سريعًا.` } : { title: "Your bag is waiting", body: `We’ve kept ${names} aside for you. Small batches go quickly.` }), url: "/cart", tag: "bag" }),
      { dedupeKey: `bag:${c.id}:${c.updatedAt.toISOString()}` },
    );
    if (r.skipped) skipped++;
    sent += r.sent;
  }
  return { carts: carts.length, sent, skipped };
}

/** Daily cron: price drops, abandoned bags, and dropping devices that have not worked for a long time. */
export async function runPushDaily(now = new Date()) {
  const c = await getIntegration("push");
  if (!c.enabled) return { skipped: "disabled" };
  const priceDrops = await runPriceDrops();
  const abandoned = await runAbandonedBagPush(now);
  const stale = await db.pushSubscription.deleteMany({ where: { OR: [{ failures: { gte: MAX_FAILURES } }, { lastSuccessAt: null, createdAt: { lt: new Date(now.getTime() - 180 * 864e5) } }, { lastSuccessAt: { lt: new Date(now.getTime() - 180 * 864e5) } }] } });
  const logs = await db.pushLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 120 * 864e5) } } });
  return { priceDrops, abandoned, prunedDevices: stale.count, prunedLogs: logs.count };
}

// ─────────────────────────────── Broadcasts ───────────────────────────────

/** User ids in a segment who have at least one device. */
export async function segmentUserIds(segment: BroadcastSegment): Promise<string[]> {
  const subs = await db.pushSubscription.findMany({ where: { userId: { not: null } }, select: { userId: true }, distinct: ["userId"] });
  const all = subs.map((s) => s.userId!) as string[];
  if (segment === "all" || !all.length) return all;
  if (segment === "customers" || segment === "no_orders") {
    const buyers = new Set((await db.order.findMany({ where: { userId: { in: all }, status: { notIn: ["CANCELLED"] } }, select: { userId: true }, distinct: ["userId"] })).map((o) => o.userId));
    return all.filter((id) => (segment === "customers" ? buyers.has(id) : !buyers.has(id)));
  }
  if (segment === "wishlist") {
    const w = new Set((await db.wishlistItem.findMany({ where: { userId: { in: all } }, select: { userId: true }, distinct: ["userId"] })).map((x) => x.userId));
    return all.filter((id) => w.has(id));
  }
  const name = segment.slice("segment:".length);
  if (!(SEGMENTS as readonly string[]).includes(name)) return [];
  return (await db.customerSegment.findMany({ where: { segment: name, userId: { in: all } }, select: { userId: true } })).map((s) => s.userId);
}

/** Recipients after preferences / opt-out / caps (what "Send" would actually reach). */
export async function broadcastAudience(segment: BroadcastSegment) {
  const ids = await segmentUserIds(segment);
  let eligible = 0;
  for (const id of ids) if ((await pushAllowed(id, "broadcast")).ok) eligible++;
  return { subscribers: ids.length, eligible };
}

export async function sendBroadcast(input: { title: string; body: string; url: string | null; segment: BroadcastSegment; createdById: string }) {
  const ids = await segmentUserIds(input.segment);
  const b = await db.pushBroadcast.create({ data: { title: input.title, body: input.body, url: input.url, segment: input.segment, createdById: input.createdById, recipients: ids.length } });
  let sent = 0;
  let failed = 0;
  for (const userId of ids) {
    const r = await sendToUser(userId, "broadcast", { title: input.title, body: input.body, url: input.url ?? "/", tag: `news-${b.id}` }, { dedupeKey: `broadcast:${b.id}:${userId}`, broadcastId: b.id, urgency: "low" });
    sent += r.sent;
    failed += r.failed;
  }
  await db.pushBroadcast.update({ where: { id: b.id }, data: { sent, failed } });
  return { id: b.id, recipients: ids.length, sent, failed };
}

/** "Send a test to my devices" (admin preview / account page). Not capped. */
export async function sendTestPush(userId: string, message: PushMessage) {
  return sendToUser(userId, "test", message, { urgency: "normal" });
}
