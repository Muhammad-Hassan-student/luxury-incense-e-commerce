import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { Permission } from "@/lib/permissions";
import { heatmapGrid } from "@/lib/dashboard";
import { KEPT_ORDER_SQL } from "./analytics";
import { db } from "./db";
import { addDays, todayIn, zonedToUtc } from "./visit-schedule";

/*
 * Data for the admin command centre (/admin). Sales figures follow the reports' definition of a kept order
 * (KEPT_ORDER_SQL from ./analytics): paid onward or confirmed COD/trade terms, never refunded, cancelled, awaiting
 * online payment, or a zero-value exchange replacement. Every widget is one or two set-based queries; nothing loops.
 */

const KEPT = KEPT_ORDER_SQL;
/** UTC instant → the timestamp-without-zone value Prisma stores. */
const ts = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

// ─────────────────────────────── Settings (monthly goal) ───────────────────────────────

export const DASHBOARD_SETTINGS_KEY = "dashboard";
export const dashboardSettingsSchema = z.object({
  /** Monthly revenue target, minor units; 0 = no goal. */
  monthlyTarget: z.number().int().min(0).max(100_000_000_000).default(0),
});
export type DashboardSettings = z.output<typeof dashboardSettingsSchema>;

export function parseDashboardSettings(value: unknown): DashboardSettings {
  const parsed = dashboardSettingsSchema.safeParse(value && typeof value === "object" ? value : {});
  return parsed.success ? parsed.data : dashboardSettingsSchema.parse({});
}

export async function getDashboardSettings() {
  const row = await db.setting.findUnique({ where: { key: DASHBOARD_SETTINGS_KEY } });
  return parseDashboardSettings(row?.value);
}

export async function saveDashboardSettings(input: z.input<typeof dashboardSettingsSchema>) {
  const current = await getDashboardSettings();
  const value = dashboardSettingsSchema.parse({ ...current, ...input });
  await db.setting.upsert({ where: { key: DASHBOARD_SETTINGS_KEY }, update: { value }, create: { key: DASHBOARD_SETTINGS_KEY, value } });
  return value;
}

// ─────────────────────────────── Store-time boundaries ───────────────────────────────

export function storeClock(tz: string, now = new Date()) {
  const today = todayIn(tz, now);
  const todayStart = zonedToUtc(today, "00:00", tz);
  const yesterdayStart = zonedToUtc(addDays(today, -1), "00:00", tz);
  const monthFirst = `${today.slice(0, 8)}01`;
  const [y, m] = today.split("-").map(Number);
  const nextMonthFirst = m === 12 ? `${y! + 1}-01-01` : `${y}-${String(m! + 1).padStart(2, "0")}-01`;
  return {
    today,
    todayStart,
    yesterdayStart,
    /** Same wall-clock moment yesterday (for "vs this time yesterday"). */
    yesterdaySameTime: new Date(yesterdayStart.getTime() + (now.getTime() - todayStart.getTime())),
    monthFirst,
    monthStart: zonedToUtc(monthFirst, "00:00", tz),
    monthEnd: zonedToUtc(nextMonthFirst, "00:00", tz),
  };
}

// ─────────────────────────────── Today ───────────────────────────────

export type Pulse = {
  todayRevenue: number;
  todayOrders: number;
  yesterdayRevenue: number;
  yesterdayOrders: number;
  lastOrder: { id: string; number: string; total: number; placedAt: Date; trade: boolean } | null;
};

/** Kept orders today so far vs the same span yesterday, plus the latest kept order. */
export async function getPulse(tz: string, now = new Date()): Promise<Pulse> {
  const c = storeClock(tz, now);
  const [[agg], last] = await Promise.all([
    db.$queryRaw<{ t_rev: bigint; t_orders: number; y_rev: bigint; y_orders: number }[]>`
      SELECT COALESCE(SUM(o.total) FILTER (WHERE o."placedAt" >= ${ts(c.todayStart)}), 0)::bigint AS t_rev,
             COUNT(*) FILTER (WHERE o."placedAt" >= ${ts(c.todayStart)})::int AS t_orders,
             COALESCE(SUM(o.total) FILTER (WHERE o."placedAt" < ${ts(c.yesterdaySameTime)}), 0)::bigint AS y_rev,
             COUNT(*) FILTER (WHERE o."placedAt" < ${ts(c.yesterdaySameTime)})::int AS y_orders
      FROM "Order" o
      WHERE ${KEPT} AND o."placedAt" >= ${ts(c.yesterdayStart)} AND o."placedAt" < ${ts(now)}
        AND (o."placedAt" >= ${ts(c.todayStart)} OR o."placedAt" < ${ts(c.yesterdaySameTime)})`,
    db.$queryRaw<{ id: string; number: string; total: number; placed_at: Date; trade: boolean }[]>`
      SELECT o.id, o.number, o.total, o."placedAt" AS placed_at, (o."tradeAccountId" IS NOT NULL) AS trade
      FROM "Order" o WHERE ${KEPT} AND o."placedAt" <= ${ts(now)} ORDER BY o."placedAt" DESC LIMIT 1`,
  ]);
  const l = last[0];
  return {
    todayRevenue: n(agg?.t_rev),
    todayOrders: agg?.t_orders ?? 0,
    yesterdayRevenue: n(agg?.y_rev),
    yesterdayOrders: agg?.y_orders ?? 0,
    lastOrder: l ? { id: l.id, number: l.number, total: l.total, placedAt: l.placed_at, trade: l.trade } : null,
  };
}

// ─────────────────────────────── Heatmap ───────────────────────────────

/** Kept orders by store-time weekday × hour over the last `weeks` whole weeks (today included). */
export async function getSalesHeatmap(tz: string, now = new Date(), weeks = 8) {
  const today = todayIn(tz, now);
  const start = zonedToUtc(addDays(today, -(weeks * 7 - 1)), "00:00", tz);
  const end = zonedToUtc(addDays(today, 1), "00:00", tz);
  const local = Prisma.sql`((o."placedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}::text)`;
  const rows = await db.$queryRaw<{ dow: number; hour: number; orders: number; revenue: bigint }[]>`
    SELECT EXTRACT(ISODOW FROM ${local})::int AS dow, EXTRACT(HOUR FROM ${local})::int AS hour,
           COUNT(*)::int AS orders, SUM(o.total)::bigint AS revenue
    FROM "Order" o WHERE ${KEPT} AND o."placedAt" >= ${ts(start)} AND o."placedAt" < ${ts(end)}
    GROUP BY 1, 2`;
  return { ...heatmapGrid(rows.map((r) => ({ dow: r.dow, hour: r.hour, orders: r.orders, revenue: n(r.revenue) }))), weeks, from: addDays(today, -(weeks * 7 - 1)), to: today };
}

// ─────────────────────────────── Top movers ───────────────────────────────

export type Mover = { key: string; productId: string | null; name: string; current: number; previous: number; units: number; change: number };

/** Products whose line revenue moved most between the last 7 store days and the 7 before. */
export async function getTopMovers(tz: string, now = new Date(), limit = 5): Promise<Mover[]> {
  const today = todayIn(tz, now);
  const curStart = zonedToUtc(addDays(today, -6), "00:00", tz);
  const prevStart = zonedToUtc(addDays(today, -13), "00:00", tz);
  const end = zonedToUtc(addDays(today, 1), "00:00", tz);
  const rows = await db.$queryRaw<{ key: string; product_id: string | null; name: string; cur: bigint; prev: bigint; units: number }[]>`
    SELECT * FROM (
      SELECT COALESCE(v."productId", 'sku:' || oi.sku) AS key, MAX(p.id) AS product_id, MAX(COALESCE(p.name, oi.name)) AS name,
             COALESCE(SUM(oi."unitPrice"::bigint * oi.quantity) FILTER (WHERE o."placedAt" >= ${ts(curStart)}), 0)::bigint AS cur,
             COALESCE(SUM(oi."unitPrice"::bigint * oi.quantity) FILTER (WHERE o."placedAt" < ${ts(curStart)}), 0)::bigint AS prev,
             COALESCE(SUM(oi.quantity) FILTER (WHERE o."placedAt" >= ${ts(curStart)}), 0)::int AS units
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      LEFT JOIN "ProductVariant" v ON v.id = oi."variantId"
      LEFT JOIN "Product" p ON p.id = v."productId"
      WHERE ${KEPT} AND o."placedAt" >= ${ts(prevStart)} AND o."placedAt" < ${ts(end)}
      GROUP BY 1
    ) m
    WHERE m.cur <> m.prev
    ORDER BY ABS(m.cur - m.prev) DESC, m.name ASC LIMIT ${limit}`;
  return rows.map((r) => ({ key: r.key, productId: r.product_id, name: r.name, current: n(r.cur), previous: n(r.prev), units: r.units, change: n(r.cur) - n(r.prev) }));
}

// ─────────────────────────────── Needs attention ───────────────────────────────

export type AttentionItem = { key: string; label: string; count: number; href: string; hint?: string; urgent?: boolean };

type Perms = readonly string[];
const has = (perms: Perms, p: Permission) => perms.includes(p);

/** Counts of everything waiting on staff, limited to what the viewer may see. One round of parallel queries. */
export async function getAttention(perms: Perms, lowStockThreshold: number, now = new Date()) {
  const unpaidTrade: Prisma.OrderWhereInput = { tradeAccountId: { not: null }, paidAt: null, reservedUntil: null, status: { notIn: ["CANCELLED", "REFUNDED"] } };
  const q = <T>(perm: Permission, fn: () => Promise<T>) => (has(perms, perm) ? fn() : Promise.resolve(null));
  const [toPack, toShip, returns, tradeApps, overdue, quotes, reviews, lowStock, visits, drafts] = await Promise.all([
    q("orders.view", () => db.order.aggregate({ where: { OR: [{ status: "PAID" }, { status: "PENDING", reservedUntil: null }] }, _count: true, _min: { placedAt: true } })),
    q("orders.view", () => db.order.aggregate({ where: { status: "PACKED" }, _count: true, _min: { placedAt: true } })),
    q("returns.manage", () => db.returnRequest.groupBy({ by: ["status"], where: { status: { in: ["REQUESTED", "RECEIVED"] } }, _count: true })),
    q("trade.view", () => db.tradeAccount.count({ where: { status: "PENDING" } })),
    q("trade.view", () => db.order.aggregate({ where: { ...unpaidTrade, dueDate: { lt: now } }, _count: true, _sum: { total: true } })),
    q("trade.view", () => db.quote.count({ where: { status: "REQUESTED" } })),
    q("reviews.view", () => db.review.count({ where: { approved: false } })),
    q("inventory.view", () =>
      db.$queryRaw<{ low: number; out: number }[]>`
        SELECT COUNT(*) FILTER (WHERE v.stock - v.reserved <= COALESCE(v."reorderPoint", ${lowStockThreshold}))::int AS low,
               COUNT(*) FILTER (WHERE v.stock - v.reserved <= 0)::int AS out
        FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId" WHERE p."isGiftCard" = false`,
    ),
    q("visits.manage", () => db.visit.aggregate({ where: { status: "REQUESTED", startsAt: { gte: now } }, _count: true, _min: { startsAt: true } })),
    q("purchasing.manage", () => db.purchaseOrder.count({ where: { status: "DRAFT" } })),
  ]);

  const age = (d: Date | null | undefined) => (d ? Math.floor((now.getTime() - d.getTime()) / 3_600_000) : 0);
  const ageHint = (d: Date | null | undefined) => {
    if (!d) return undefined;
    const h = age(d);
    return `oldest ${h < 48 ? `${Math.max(1, h)} h` : `${Math.floor(h / 24)} days`}`;
  };
  const items: AttentionItem[] = [];
  if (toPack) items.push({ key: "pack", label: "Orders to pack", count: toPack._count, href: "/admin/orders?status=TO_PACK", hint: ageHint(toPack._min.placedAt), urgent: toPack._count > 0 && age(toPack._min.placedAt) >= 48 });
  if (toShip) items.push({ key: "ship", label: "Packed, to ship", count: toShip._count, href: "/admin/orders?status=PACKED", hint: ageHint(toShip._min.placedAt), urgent: toShip._count > 0 && age(toShip._min.placedAt) >= 72 });
  if (returns) {
    const requested = returns.find((r) => r.status === "REQUESTED")?._count ?? 0;
    const received = returns.find((r) => r.status === "RECEIVED")?._count ?? 0;
    items.push({ key: "returns", label: "Returns to handle", count: requested + received, href: "/admin/returns?status=OPEN", hint: requested + received ? `${requested} to review · ${received} to inspect` : undefined });
  }
  if (tradeApps != null) items.push({ key: "trade-apps", label: "Trade applications", count: tradeApps, href: "/admin/trade?status=pending" });
  if (overdue) items.push({ key: "overdue", label: "Overdue trade invoices", count: overdue._count, href: "/admin/trade?status=approved", hint: overdue._count ? `${(n(overdue._sum.total) / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })} owed` : undefined, urgent: overdue._count > 0 });
  if (quotes != null) items.push({ key: "quotes", label: "Quote requests", count: quotes, href: "/admin/trade/quotes" });
  if (reviews != null) items.push({ key: "reviews", label: "Reviews to moderate", count: reviews, href: "/admin/reviews" });
  if (lowStock) {
    const l = lowStock[0];
    items.push({ key: "low-stock", label: "Low stock variants", count: l?.low ?? 0, href: "/admin/inventory?filter=low", hint: l?.out ? `${l.out} out of stock` : undefined, urgent: (l?.out ?? 0) > 0 });
  }
  if (visits) items.push({ key: "visits", label: "Visits to confirm", count: visits._count, href: "/admin/visits?view=list&status=REQUESTED", hint: visits._min.startsAt ? `next ${new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(visits._min.startsAt)}` : undefined });
  if (drafts != null) items.push({ key: "drafts", label: "Draft purchase orders", count: drafts, href: "/admin/purchasing?status=DRAFT" });
  return items;
}

// ─────────────────────────────── Activity feed ───────────────────────────────

export type ActivityKind = "order" | "return" | "trade" | "quote" | "visit" | "review";
export type Activity = { id: string; kind: ActivityKind; at: Date; title: string; detail: string; href: string; amount?: number };

/** Latest events across the store (each source limited, then merged) — only the kinds the viewer may open. */
export async function getActivity(perms: Perms, limit = 15): Promise<Activity[]> {
  const take = limit;
  const q = <T>(perm: Permission, fn: () => Promise<T[]>) => (has(perms, perm) ? fn() : Promise.resolve([] as T[]));
  const [orders, returns, accounts, quotes, visits, reviews] = await Promise.all([
    q("orders.view", () => db.order.findMany({ orderBy: { placedAt: "desc" }, take, select: { id: true, number: true, total: true, placedAt: true, status: true, reservedUntil: true, email: true, tradeAccount: { select: { businessName: true } } } })),
    q("returns.manage", () => db.returnRequest.findMany({ orderBy: { requestedAt: "desc" }, take, select: { id: true, number: true, requestedAt: true, status: true, order: { select: { number: true } } } })),
    q("trade.view", () => db.tradeAccount.findMany({ orderBy: { createdAt: "desc" }, take, select: { id: true, businessName: true, createdAt: true, status: true, contactName: true } })),
    q("trade.view", () => db.quote.findMany({ orderBy: { createdAt: "desc" }, take, select: { id: true, number: true, createdAt: true, tradeAccount: { select: { businessName: true } }, _count: { select: { items: true } } } })),
    q("visits.manage", () => db.visit.findMany({ orderBy: { createdAt: "desc" }, take, select: { id: true, reference: true, name: true, groupSize: true, createdAt: true, status: true } })),
    q("reviews.view", () => db.review.findMany({ orderBy: { createdAt: "desc" }, take, select: { id: true, rating: true, createdAt: true, approved: true, product: { select: { name: true } }, user: { select: { name: true } } } })),
  ]);
  const all: Activity[] = [
    ...orders.map((o) => ({
      id: `o-${o.id}`,
      kind: "order" as const,
      at: o.placedAt,
      title: o.tradeAccount ? `Trade order ${o.number}` : `Order ${o.number}`,
      detail: o.tradeAccount?.businessName ?? (o.status === "PENDING" && o.reservedUntil ? `${o.email} · awaiting payment` : o.email),
      href: `/admin/orders/${o.id}`,
      amount: o.total,
    })),
    ...returns.map((r) => ({ id: `r-${r.id}`, kind: "return" as const, at: r.requestedAt, title: `Return ${r.number}`, detail: `for ${r.order.number} · ${r.status.toLowerCase()}`, href: `/admin/returns/${r.id}` })),
    ...accounts.map((a) => ({ id: `t-${a.id}`, kind: "trade" as const, at: a.createdAt, title: a.status === "PENDING" ? "Trade application" : "Trade account opened", detail: `${a.businessName} · ${a.contactName}`, href: `/admin/trade/${a.id}` })),
    ...quotes.map((x) => ({ id: `q-${x.id}`, kind: "quote" as const, at: x.createdAt, title: `Quote request ${x.number}`, detail: `${x.tradeAccount.businessName} · ${x._count.items} line${x._count.items === 1 ? "" : "s"}`, href: `/admin/trade/quotes/${x.id}` })),
    ...visits.map((v) => ({ id: `v-${v.id}`, kind: "visit" as const, at: v.createdAt, title: `Visit ${v.reference}`, detail: `${v.name} · party of ${v.groupSize} · ${v.status.toLowerCase().replace("_", " ")}`, href: `/admin/visits/${v.id}` })),
    ...reviews.map((r) => ({ id: `rv-${r.id}`, kind: "review" as const, at: r.createdAt, title: `${"★".repeat(r.rating)}${"☆".repeat(Math.max(0, 5 - r.rating))} review`, detail: `${r.product.name}${r.user.name ? ` · ${r.user.name}` : ""}${r.approved ? "" : " · awaiting approval"}`, href: "/admin/reviews" })),
  ];
  return all.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

// ─────────────────────────────── Visits & trade receivables ───────────────────────────────

/** Today's atelier visitors (store time): guests expected, arrived, and the next booking still to come. */
export async function getTodayVisits(tz: string, now = new Date()) {
  const c = storeClock(tz, now);
  const visits = await db.visit.findMany({
    where: { startsAt: { gte: c.todayStart, lt: zonedToUtc(addDays(c.today, 1), "00:00", tz) }, status: { in: ["REQUESTED", "CONFIRMED", "CHECKED_IN", "COMPLETED"] } },
    orderBy: { startsAt: "asc" },
    select: { id: true, name: true, groupSize: true, startsAt: true, status: true },
  });
  const guests = visits.reduce((s, v) => s + v.groupSize, 0);
  const arrived = visits.filter((v) => v.status === "CHECKED_IN" || v.status === "COMPLETED").reduce((s, v) => s + v.groupSize, 0);
  const next = visits.find((v) => (v.status === "CONFIRMED" || v.status === "REQUESTED") && v.startsAt.getTime() >= now.getTime() - 30 * 60_000) ?? null;
  return { bookings: visits.length, guests, arrived, next };
}

/** Unpaid trade invoices (confirmed trade orders not yet paid). */
export async function getTradeReceivables(now = new Date()) {
  const where: Prisma.OrderWhereInput = { tradeAccountId: { not: null }, paidAt: null, reservedUntil: null, status: { notIn: ["CANCELLED", "REFUNDED"] } };
  const [open, late] = await Promise.all([
    db.order.aggregate({ where, _count: true, _sum: { total: true } }),
    db.order.aggregate({ where: { ...where, dueDate: { lt: now } }, _count: true }),
  ]);
  return { open: open._count, amount: open._sum.total ?? 0, overdue: late._count };
}
