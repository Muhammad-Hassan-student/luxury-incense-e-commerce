import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { addDays, isValidTimeZone, parseVisitSettings, todayIn, weekdayIndex, zonedToUtc } from "./visit-schedule";

// Sales analytics for /admin/reports. All money is integer minor units of the base currency.
//
// What counts as a sale:
//   • "sold"  = confirmed onward: PAID, PACKED, SHIPPED, DELIVERED, confirmed COD/trade-on-terms (PENDING without a
//               payment hold) — plus REFUNDED, which was sold and then given back.
//   • "kept"  = sold minus REFUNDED. Net revenue, orders, AOV, units, margin, products, channels and customers use kept orders.
//   • PENDING with a payment hold (awaiting online payment) and CANCELLED never count, nor do zero-value exchange
//     replacement orders (ReturnRequest.exchangeOrderId) — they are not new sales.
// Orders are bucketed by when they were placed, in the store's time zone. Two kinds of money go back:
//   • whole-order refunds (Order.status REFUNDED) count against the period the order was placed in;
//   • returns resolved as REFUND or STORE_CREDIT (ReturnRequest.status REFUNDED, refundAmount) count against the period
//     they were resolved in — the order itself stays DELIVERED.
// Net revenue = gross − both. Product, margin and customer-value figures are before returns.

// ─────────────────────────────── Ranges ───────────────────────────────

export const RANGE_KEYS = ["7d", "30d", "90d", "12m", "custom"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];
const PRESET_DAYS: Record<Exclude<RangeKey, "custom">, number> = { "7d": 7, "30d": 30, "90d": 90, "12m": 365 };
export const RANGE_LABEL: Record<RangeKey, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days", "12m": "12 months", custom: "Custom" };
/** Longest custom range we will aggregate (about three years). */
export const MAX_RANGE_DAYS = 1096;
const DEFAULT_TZ = "Asia/Kolkata";

export type ReportRange = {
  key: RangeKey;
  /** Inclusive first and last day (YYYY-MM-DD, store time zone). */
  from: string;
  to: string;
  days: number;
  /** UTC instants: start inclusive, end exclusive. */
  start: Date;
  end: Date;
  granularity: "day" | "week";
  tz: string;
};

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from) + 1;

export function makeRange(key: RangeKey, from: string, to: string, tz: string): ReportRange {
  const days = daysBetween(from, to);
  return { key, from, to, days, start: zonedToUtc(from, "00:00", tz), end: zonedToUtc(addDays(to, 1), "00:00", tz), granularity: days > 90 ? "week" : "day", tz };
}

/** `?range=7d|30d|90d|12m` or `?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`; anything invalid falls back to 30 days. */
export function resolveRange(params: { range?: string; from?: string; to?: string }, tz: string, now = new Date()): ReportRange {
  const today = todayIn(tz, now);
  if (params.range === "custom" && isDay(params.from) && isDay(params.to)) {
    let [from, to] = params.from <= params.to ? [params.from, params.to] : [params.to, params.from];
    if (to > today) to = today;
    if (from > to) from = to;
    if (daysBetween(from, to) > MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1));
    return makeRange("custom", from, to, tz);
  }
  const key = params.range && params.range in PRESET_DAYS ? (params.range as Exclude<RangeKey, "custom">) : "30d";
  return makeRange(key, addDays(today, -(PRESET_DAYS[key] - 1)), today, tz);
}

/** The equal-length period immediately before `r`. */
export const previousRange = (r: ReportRange): ReportRange => makeRange(r.key, addDays(r.from, -r.days), addDays(r.from, -1), r.tz);

/** Store time zone (the atelier setting), Asia/Kolkata when unset. */
export async function storeTimeZone(): Promise<string> {
  const row = await db.setting.findUnique({ where: { key: "visits" } });
  const tz = parseVisitSettings(row?.value).timezone;
  return tz && isValidTimeZone(tz) ? tz : DEFAULT_TZ;
}

/** Percentage change, or null when there is nothing to compare against. */
export const pctChange = (cur: number, prev: number): number | null => (prev === 0 ? (cur === 0 ? 0 : null) : (cur - prev) / Math.abs(prev));

// ─────────────────────────────── SQL building blocks ───────────────────────────────

const REPLACEMENT = Prisma.sql`EXISTS (SELECT 1 FROM "ReturnRequest" rr WHERE rr."exchangeOrderId" = o.id)`;
const KEPT = Prisma.sql`((o.status IN ('PAID', 'PACKED', 'SHIPPED', 'DELIVERED') OR (o.status = 'PENDING' AND o."reservedUntil" IS NULL)) AND NOT ${REPLACEMENT})`;
const SOLD = Prisma.sql`(o.status = 'REFUNDED' OR ${KEPT})`;
/** UTC instant → the timestamp-without-zone value Prisma stores (independent of the session time zone). */
const ts = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
const inRange = (r: ReportRange) => Prisma.sql`o."placedAt" >= ${ts(r.start)} AND o."placedAt" < ${ts(r.end)}`;
/** Returns refunded (money or store credit) during the range. */
const RETURN_REFUNDED = (r: ReportRange) =>
  Prisma.sql`rr.status = 'REFUNDED' AND rr."refundAmount" IS NOT NULL AND rr."resolvedAt" >= ${ts(r.start)} AND rr."resolvedAt" < ${ts(r.end)}`;
const CUSTOMER = Prisma.sql`COALESCE(o."userId", lower(o.email))`;
const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

// ─────────────────────────────── KPIs ───────────────────────────────

export type Kpis = {
  grossRevenue: number;
  /** All money given back: whole-order refunds + return refunds/credit. */
  refunds: number;
  /** Whole-order refunds (orders placed in the range). */
  orderRefunds: number;
  /** Returns resolved in the range: refunded to the customer, and issued as store credit. */
  returnRefunds: number;
  storeCredit: number;
  returnsRefunded: number;
  netRevenue: number;
  orders: number;
  refundedOrders: number;
  /** money given back ÷ gross revenue (0–1) */
  refundRate: number;
  aov: number;
  units: number;
  /** Merchandise (line) value of kept orders, before order-level discounts. */
  merchandise: number;
  /** Merchandise value whose variant has a cost price, its cost, and the margin on it. */
  costedMerchandise: number;
  cost: number;
  grossMargin: number;
  /** grossMargin ÷ costedMerchandise, null when nothing is costed */
  marginRate: number | null;
  /** share of merchandise value with a known cost (0–1) */
  costCoverage: number;
  customers: number;
  newCustomers: number;
  returningCustomers: number;
  couponDiscount: number;
  couponOrders: number;
};

export async function getKpis(r: ReportRange): Promise<Kpis> {
  const [[o], [m], [c], [ret]] = await Promise.all([
    db.$queryRaw<{ sold: number; gross: bigint; refunded: number; refunds: bigint; coupon: bigint; coupon_orders: number }[]>`
      SELECT COUNT(*)::int AS sold,
             COALESCE(SUM(o.total), 0)::bigint AS gross,
             COUNT(*) FILTER (WHERE o.status = 'REFUNDED')::int AS refunded,
             COALESCE(SUM(o.total) FILTER (WHERE o.status = 'REFUNDED'), 0)::bigint AS refunds,
             COALESCE(SUM(o.discount) FILTER (WHERE o.status <> 'REFUNDED' AND o."couponCode" IS NOT NULL), 0)::bigint AS coupon,
             COUNT(*) FILTER (WHERE o.status <> 'REFUNDED' AND o."couponCode" IS NOT NULL AND o.discount > 0)::int AS coupon_orders
      FROM "Order" o WHERE ${SOLD} AND ${inRange(r)}`,
    db.$queryRaw<{ merch: bigint; costed: bigint; cost: bigint; units: bigint }[]>`
      SELECT COALESCE(SUM(oi."unitPrice"::bigint * oi.quantity), 0)::bigint AS merch,
             COALESCE(SUM(oi."unitPrice"::bigint * oi.quantity) FILTER (WHERE v."costPrice" IS NOT NULL), 0)::bigint AS costed,
             COALESCE(SUM(v."costPrice"::bigint * oi.quantity) FILTER (WHERE v."costPrice" IS NOT NULL), 0)::bigint AS cost,
             COALESCE(SUM(oi.quantity), 0)::bigint AS units
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      LEFT JOIN "ProductVariant" v ON v.id = oi."variantId"
      WHERE ${KEPT} AND ${inRange(r)}`,
    db.$queryRaw<{ customers: number; new: number }[]>`
      WITH cur AS (SELECT DISTINCT ${CUSTOMER} AS ck FROM "Order" o WHERE ${KEPT} AND ${inRange(r)}),
           firsts AS (
             SELECT ${CUSTOMER} AS ck, MIN(o."placedAt") AS first_at FROM "Order" o
             WHERE ${KEPT} AND ${CUSTOMER} IN (SELECT ck FROM cur) GROUP BY 1)
      SELECT COUNT(*)::int AS customers, COUNT(*) FILTER (WHERE f.first_at >= ${ts(r.start)})::int AS new
      FROM cur JOIN firsts f ON f.ck = cur.ck`,
    db.$queryRaw<{ refund: bigint; credit: bigint; count: number }[]>`
      SELECT COALESCE(SUM(rr."refundAmount") FILTER (WHERE rr.resolution IS DISTINCT FROM 'STORE_CREDIT'), 0)::bigint AS refund,
             COALESCE(SUM(rr."refundAmount") FILTER (WHERE rr.resolution = 'STORE_CREDIT'), 0)::bigint AS credit,
             COUNT(*)::int AS count
      FROM "ReturnRequest" rr WHERE ${RETURN_REFUNDED(r)}`,
  ]);
  const gross = n(o?.gross);
  const orderRefunds = n(o?.refunds);
  const returnRefunds = n(ret?.refund);
  const storeCredit = n(ret?.credit);
  const refunds = orderRefunds + returnRefunds + storeCredit;
  const sold = o?.sold ?? 0;
  const refunded = o?.refunded ?? 0;
  const orders = sold - refunded;
  const netRevenue = gross - refunds;
  const merchandise = n(m?.merch);
  const costed = n(m?.costed);
  const cost = n(m?.cost);
  const customers = c?.customers ?? 0;
  const newCustomers = c?.new ?? 0;
  return {
    grossRevenue: gross,
    refunds,
    orderRefunds,
    returnRefunds,
    storeCredit,
    returnsRefunded: ret?.count ?? 0,
    netRevenue,
    orders,
    refundedOrders: refunded,
    refundRate: gross ? refunds / gross : 0,
    aov: orders ? Math.round(netRevenue / orders) : 0,
    units: n(m?.units),
    merchandise,
    costedMerchandise: costed,
    cost,
    grossMargin: costed - cost,
    marginRate: costed ? (costed - cost) / costed : null,
    costCoverage: merchandise ? costed / merchandise : 0,
    customers,
    newCustomers,
    returningCustomers: customers - newCustomers,
    couponDiscount: n(o?.coupon),
    couponOrders: o?.coupon_orders ?? 0,
  };
}

// ─────────────────────────────── Time series ───────────────────────────────

export type SeriesPoint = { date: string; revenue: number; orders: number };

/** Monday of the week containing `day`. */
export const weekStart = (day: string) => addDays(day, -((weekdayIndex(day) + 6) % 7));

/** Bucket keys for a range: every day, or each week's Monday (the first clamped to the range start). */
export function bucketKeys(r: ReportRange): string[] {
  const keys: string[] = [];
  for (let d = r.from; d <= r.to; d = addDays(d, 1)) {
    const k = bucketOf(r, d);
    if (keys[keys.length - 1] !== k) keys.push(k);
  }
  return keys;
}
const bucketOf = (r: ReportRange, day: string) => {
  if (r.granularity === "day") return day;
  const w = weekStart(day);
  return w < r.from ? r.from : w;
};

/**
 * Net revenue and order count per day (or week when the range is over 90 days), zero-filled.
 * Return refunds are taken off the day they were resolved, so a day can be negative.
 */
export async function getSalesSeries(r: ReportRange): Promise<SeriesPoint[]> {
  const rows = await db.$queryRaw<{ day: string; revenue: bigint; orders: number }[]>`
    SELECT to_char((o."placedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${r.tz}::text, 'YYYY-MM-DD') AS day,
           SUM(o.total)::bigint AS revenue, COUNT(*)::int AS orders
    FROM "Order" o WHERE ${KEPT} AND ${inRange(r)} GROUP BY 1
    UNION ALL
    SELECT to_char((rr."resolvedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${r.tz}::text, 'YYYY-MM-DD') AS day,
           -SUM(rr."refundAmount")::bigint AS revenue, 0 AS orders
    FROM "ReturnRequest" rr WHERE ${RETURN_REFUNDED(r)} GROUP BY 1`;
  const buckets = new Map(bucketKeys(r).map((date) => [date, { date, revenue: 0, orders: 0 }]));
  for (const row of rows) {
    const b = buckets.get(bucketOf(r, row.day));
    if (!b) continue;
    b.revenue += n(row.revenue);
    b.orders += row.orders;
  }
  return [...buckets.values()];
}

// ─────────────────────────────── Products & categories ───────────────────────────────

export type MarginStats = { revenue: number; units: number; orders: number; costedRevenue: number; cost: number; margin: number | null; marginRate: number | null };
export type ProductRow = MarginStats & { key: string; productId: string | null; name: string; slug: string | null };
export type VariantRow = MarginStats & { sku: string; name: string; label: string; productId: string | null };
export type CategoryRow = MarginStats & { key: string; name: string; share: number };

type RawStats = { revenue: bigint; units: bigint; orders: number; costed: bigint; cost: bigint };
const stats = (s: RawStats): MarginStats => {
  const costed = n(s.costed);
  const cost = n(s.cost);
  return {
    revenue: n(s.revenue),
    units: n(s.units),
    orders: s.orders,
    costedRevenue: costed,
    cost,
    margin: costed ? costed - cost : null,
    marginRate: costed ? (costed - cost) / costed : null,
  };
};
const STATS = Prisma.sql`
  SUM(oi."unitPrice"::bigint * oi.quantity)::bigint AS revenue,
  SUM(oi.quantity)::bigint AS units,
  COUNT(DISTINCT oi."orderId")::int AS orders,
  COALESCE(SUM(oi."unitPrice"::bigint * oi.quantity) FILTER (WHERE v."costPrice" IS NOT NULL), 0)::bigint AS costed,
  COALESCE(SUM(v."costPrice"::bigint * oi.quantity) FILTER (WHERE v."costPrice" IS NOT NULL), 0)::bigint AS cost`;

/** Best-selling products by line revenue (before order-level discounts). Deleted variants group by their SKU snapshot. */
export async function getTopProducts(r: ReportRange, limit = 10): Promise<ProductRow[]> {
  const rows = await db.$queryRaw<(RawStats & { key: string; product_id: string | null; name: string; slug: string | null })[]>`
    SELECT COALESCE(v."productId", 'sku:' || oi.sku) AS key, MAX(p.id) AS product_id,
           MAX(COALESCE(p.name, oi.name)) AS name, MAX(p.slug) AS slug, ${STATS}
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    LEFT JOIN "ProductVariant" v ON v.id = oi."variantId"
    LEFT JOIN "Product" p ON p.id = v."productId"
    WHERE ${KEPT} AND ${inRange(r)}
    GROUP BY 1 ORDER BY revenue DESC, units DESC, name ASC LIMIT ${limit}`;
  return rows.map((x) => ({ key: x.key, productId: x.product_id, name: x.name, slug: x.slug, ...stats(x) }));
}

export async function getTopVariants(r: ReportRange, limit = 10): Promise<VariantRow[]> {
  const rows = await db.$queryRaw<(RawStats & { sku: string; name: string; label: string; product_id: string | null })[]>`
    SELECT oi.sku, MAX(oi.name) AS name, MAX(oi.label) AS label, MAX(v."productId") AS product_id, ${STATS}
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    LEFT JOIN "ProductVariant" v ON v.id = oi."variantId"
    WHERE ${KEPT} AND ${inRange(r)}
    GROUP BY oi.sku ORDER BY revenue DESC, units DESC, oi.sku ASC LIMIT ${limit}`;
  return rows.map((x) => ({ sku: x.sku, name: x.name, label: x.label, productId: x.product_id, ...stats(x) }));
}

export async function getTopCategories(r: ReportRange, limit = 10): Promise<CategoryRow[]> {
  const rows = await db.$queryRaw<(RawStats & { key: string; name: string })[]>`
    SELECT COALESCE(c.id, '-') AS key, COALESCE(MAX(c.name), 'Uncategorised') AS name, ${STATS}
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    LEFT JOIN "ProductVariant" v ON v.id = oi."variantId"
    LEFT JOIN "Product" p ON p.id = v."productId"
    LEFT JOIN "Category" c ON c.id = p."categoryId"
    WHERE ${KEPT} AND ${inRange(r)}
    GROUP BY 1 ORDER BY revenue DESC, name ASC`;
  const total = rows.reduce((s, x) => s + n(x.revenue), 0);
  return rows.slice(0, limit).map((x) => ({ key: x.key, name: x.name, share: total ? n(x.revenue) / total : 0, ...stats(x) }));
}

// ─────────────────────────────── Channels ───────────────────────────────

export type SplitRow = { key: string; label: string; orders: number; revenue: number; share: number };

const withShares = (rows: { key: string; label: string; orders: number; revenue: number }[]): SplitRow[] => {
  const total = rows.reduce((s, x) => s + x.revenue, 0);
  return rows.map((x) => ({ ...x, share: total ? x.revenue / total : 0 }));
};

/** Retail vs trade (wholesale orders carry a trade account). Both rows are always present. */
export async function getChannelSplit(r: ReportRange): Promise<SplitRow[]> {
  const rows = await db.$queryRaw<{ trade: boolean; orders: number; revenue: bigint }[]>`
    SELECT (o."tradeAccountId" IS NOT NULL) AS trade, COUNT(*)::int AS orders, SUM(o.total)::bigint AS revenue
    FROM "Order" o WHERE ${KEPT} AND ${inRange(r)} GROUP BY 1`;
  const get = (trade: boolean) => rows.find((x) => x.trade === trade);
  return withShares([
    { key: "retail", label: "Retail", orders: get(false)?.orders ?? 0, revenue: n(get(false)?.revenue) },
    { key: "trade", label: "Trade", orders: get(true)?.orders ?? 0, revenue: n(get(true)?.revenue) },
  ]);
}

export const PROVIDER_LABEL: Record<string, string> = { STRIPE: "Card (Stripe)", RAZORPAY: "Razorpay", COD: "Cash on delivery", INVOICE: "Trade invoice", NONE: "No payment record" };

/** Split by the order's payment provider (the captured payment, else the first attempt). */
export async function getPaymentSplit(r: ReportRange): Promise<SplitRow[]> {
  const rows = await db.$queryRaw<{ provider: string | null; orders: number; revenue: bigint }[]>`
    SELECT pay.provider::text AS provider, COUNT(*)::int AS orders, SUM(o.total)::bigint AS revenue
    FROM "Order" o
    LEFT JOIN LATERAL (
      SELECT p.provider FROM "Payment" p WHERE p."orderId" = o.id
      ORDER BY (p.status = 'CAPTURED') DESC, p."createdAt" ASC LIMIT 1
    ) pay ON TRUE
    WHERE ${KEPT} AND ${inRange(r)}
    GROUP BY 1 ORDER BY revenue DESC`;
  return withShares(rows.map((x) => ({ key: x.provider ?? "NONE", label: PROVIDER_LABEL[x.provider ?? "NONE"] ?? x.provider ?? "—", orders: x.orders, revenue: n(x.revenue) })));
}

// ─────────────────────────────── Customers ───────────────────────────────

export const SEGMENTS = ["Champions", "Loyal", "New", "At risk", "Lost"] as const;
export type Segment = (typeof SEGMENTS)[number];
export const SEGMENT_HINT: Record<Segment, string> = {
  Champions: "3+ orders, last within 30 days",
  Loyal: "2+ orders, last within 90 days",
  New: "First order within 60 days",
  "At risk": "No order for 2–6 months",
  Lost: "No order for over 6 months",
};

/** RFM-style segment from days since the last order and lifetime order count. */
export function segmentOf(recencyDays: number, frequency: number): Segment {
  if (recencyDays <= 30 && frequency >= 3) return "Champions";
  if (recencyDays <= 90 && frequency >= 2) return "Loyal";
  if (recencyDays <= 60 && frequency === 1) return "New";
  if (recencyDays <= 180) return "At risk";
  return "Lost";
}

export type TopCustomer = { key: string; userId: string | null; name: string | null; email: string; orders: number; lifetimeValue: number; rangeRevenue: number; lastOrderAt: Date; segment: Segment };
export type SegmentRow = { segment: Segment; customers: number; revenue: number; share: number };
export type CustomerInsights = { customers: number; repeatCustomers: number; repeatRate: number; top: TopCustomer[]; segments: SegmentRow[] };

/**
 * Customers are signed-in users, or guest e-mails. Everything is "as of" the end of the range:
 * repeat rate = buyers in the range with 2+ lifetime orders; top customers = buyers in the range by lifetime value;
 * segments cover every customer who had ordered by the end of the range.
 */
export async function getCustomerInsights(r: ReportRange, limit = 10): Promise<CustomerInsights> {
  const end = ts(r.end);
  const [[repeat], top, buckets] = await Promise.all([
    db.$queryRaw<{ customers: number; repeat: number }[]>`
      WITH cur AS (SELECT DISTINCT ${CUSTOMER} AS ck FROM "Order" o WHERE ${KEPT} AND ${inRange(r)}),
           life AS (SELECT ${CUSTOMER} AS ck, COUNT(*) AS orders FROM "Order" o
                    WHERE ${KEPT} AND o."placedAt" < ${end} AND ${CUSTOMER} IN (SELECT ck FROM cur) GROUP BY 1)
      SELECT COUNT(*)::int AS customers, COUNT(*) FILTER (WHERE orders >= 2)::int AS repeat FROM life`,
    db.$queryRaw<{ ck: string; user_id: string | null; name: string | null; email: string; orders: number; ltv: bigint; in_range: bigint; recency: number; last_at: Date }[]>`
      WITH cur AS (SELECT DISTINCT ${CUSTOMER} AS ck FROM "Order" o WHERE ${KEPT} AND ${inRange(r)})
      SELECT ${CUSTOMER} AS ck, MAX(o."userId") AS user_id, MAX(u.name) AS name,
             (ARRAY_AGG(o.email ORDER BY o."placedAt" DESC))[1] AS email,
             COUNT(*)::int AS orders, SUM(o.total)::bigint AS ltv,
             COALESCE(SUM(o.total) FILTER (WHERE ${inRange(r)}), 0)::bigint AS in_range,
             FLOOR(EXTRACT(EPOCH FROM (${end} - MAX(o."placedAt"))) / 86400)::int AS recency,
             MAX(o."placedAt") AS last_at
      FROM "Order" o LEFT JOIN "User" u ON u.id = o."userId"
      WHERE ${KEPT} AND o."placedAt" < ${end} AND ${CUSTOMER} IN (SELECT ck FROM cur)
      GROUP BY 1 ORDER BY ltv DESC, ck ASC LIMIT ${limit}`,
    db.$queryRaw<{ recency: number; freq: number; customers: number; revenue: bigint }[]>`
      WITH c AS (
        SELECT ${CUSTOMER} AS ck, COUNT(*)::int AS freq, SUM(o.total)::bigint AS ltv,
               FLOOR(EXTRACT(EPOCH FROM (${end} - MAX(o."placedAt"))) / 86400)::int AS recency
        FROM "Order" o WHERE ${KEPT} AND o."placedAt" < ${end} GROUP BY 1)
      SELECT recency, LEAST(freq, 3) AS freq, COUNT(*)::int AS customers, SUM(ltv)::bigint AS revenue FROM c GROUP BY 1, 2`,
  ]);
  const seg = new Map<Segment, SegmentRow>(SEGMENTS.map((s) => [s, { segment: s, customers: 0, revenue: 0, share: 0 }]));
  for (const b of buckets) {
    const row = seg.get(segmentOf(b.recency, b.freq))!;
    row.customers += b.customers;
    row.revenue += n(b.revenue);
  }
  const all = [...seg.values()];
  const totalCustomers = all.reduce((s, x) => s + x.customers, 0);
  for (const row of all) row.share = totalCustomers ? row.customers / totalCustomers : 0;
  const customers = repeat?.customers ?? 0;
  const repeatCustomers = repeat?.repeat ?? 0;
  return {
    customers,
    repeatCustomers,
    repeatRate: customers ? repeatCustomers / customers : 0,
    top: top.map((t) => ({
      key: t.ck,
      userId: t.user_id,
      name: t.name,
      email: t.email,
      orders: t.orders,
      lifetimeValue: n(t.ltv),
      rangeRevenue: n(t.in_range),
      lastOrderAt: t.last_at,
      segment: segmentOf(t.recency, t.orders),
    })),
    segments: all,
  };
}

// ─────────────────────────────── Cart funnel ───────────────────────────────

export type FunnelStep = { key: string; label: string; count: number; hint: string };

/**
 * Best effort from existing data — carts aren't linked to orders, and checkout empties a cart, so the steps are not
 * strictly nested: "holding items" means carts from the range that still have something in them (open or abandoned).
 */
export async function getCartFunnel(r: ReportRange): Promise<FunnelStep[]> {
  const cartRange = Prisma.sql`c."createdAt" >= ${ts(r.start)} AND c."createdAt" < ${ts(r.end)}`;
  const [[carts], [orders]] = await Promise.all([
    db.$queryRaw<{ created: number; with_items: number }[]>`
      SELECT COUNT(*)::int AS created,
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "CartItem" ci WHERE ci."cartId" = c.id))::int AS with_items
      FROM "Cart" c WHERE ${cartRange}`,
    db.$queryRaw<{ placed: number; paid: number }[]>`
      SELECT COUNT(*)::int AS placed, COUNT(*) FILTER (WHERE ${SOLD})::int AS paid
      FROM "Order" o WHERE ${inRange(r)} AND NOT ${REPLACEMENT}`,
  ]);
  return [
    { key: "carts", label: "Carts created", count: carts?.created ?? 0, hint: "New bags opened by shoppers" },
    { key: "items", label: "Still holding items", count: carts?.with_items ?? 0, hint: "Open or abandoned — checkout empties a bag" },
    { key: "placed", label: "Orders placed", count: orders?.placed ?? 0, hint: "Every checkout, including unpaid and cancelled" },
    { key: "paid", label: "Confirmed or paid", count: orders?.paid ?? 0, hint: "Paid online, confirmed COD or trade terms" },
  ];
}

// ─────────────────────────────── Everything for the page ───────────────────────────────

export async function getSalesReport(r: ReportRange) {
  const prev = previousRange(r);
  const [kpis, prevKpis, series, prevSeries, products, variants, categories, channels, payments, customers, funnel] = await Promise.all([
    getKpis(r),
    getKpis(prev),
    getSalesSeries(r),
    getSalesSeries(prev),
    getTopProducts(r),
    getTopVariants(r, 8),
    getTopCategories(r, 8),
    getChannelSplit(r),
    getPaymentSplit(r),
    getCustomerInsights(r),
    getCartFunnel(r),
  ]);
  return { range: r, prev, kpis, prevKpis, series, prevSeries, products, variants, categories, channels, payments, customers, funnel };
}
export type SalesReport = Awaited<ReturnType<typeof getSalesReport>>;
