import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { CommissionStatus, Prisma } from "@/generated/prisma/client";
import { brand } from "@/config/brand";
import { formatMoney } from "@/lib/money";
import { db } from "./db";
import { getSettings } from "./settings";

// ── Affiliate / influencer program ──
//
// Attribution (decided when the order is placed, src/server/orders.ts → placeOrder):
//   1. the affiliate's personal discount code used at checkout (explicit, so it wins), else
//   2. the last `?aff=CODE` link clicked within the cookie window (cookie mo_aff = "CODE.<ms>", set by src/proxy.ts;
//      every new click overwrites it → last click wins).
// Only APPROVED affiliates earn. Self-referral (same account or same email) is blocked outright; same IP, same device,
// look-alike email and repeat-IP orders are flagged for staff and never auto-approved.
//
// Lifecycle: ATTRIBUTED (placed) → PENDING (confirmed; amount = rate × merchandise net of discounts, points, tax and
// refunds) → APPROVED (delivered, past `holdDays`, no return in progress; daily cron "affiliates") → PAID (payout batch).
// Cancelled / refunded / fully returned orders → REVERSED; partial returns shrink the amount. Reversed after payout →
// `clawback`, netted from the next payout.
//
// Referral program precedence: the existing referral bonus (src/server/orders.ts, loyalty points for the referrer on a
// referred customer's FIRST order) is untouched. When that bonus is paid on an order, the affiliate commission for the
// same order is REJECTED ("referral_precedence") — one order never pays both.

export const AFF_COOKIE = "mo_aff";
export const DEVICE_COOKIE = "mo_did";
export const AFFILIATE_SETTINGS_KEY = "affiliates";

export const affiliateSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  defaultCommissionPercent: z.number().min(0).max(50).default(10),
  /** Attribution window after the last click. */
  cookieDays: z.number().int().min(1).max(90).default(30),
  /** Days after confirmation before a delivered order's commission is approved (covers the return window). */
  holdDays: z.number().int().min(0).max(120).default(30),
  /** Smallest payout (minor units). */
  minPayout: z.number().int().min(0).max(10_000_000).default(50_000),
});
export type AffiliateSettings = z.infer<typeof affiliateSettingsSchema>;

export async function getAffiliateSettings(): Promise<AffiliateSettings> {
  const row = await db.setting.findUnique({ where: { key: AFFILIATE_SETTINGS_KEY } });
  const parsed = affiliateSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : affiliateSettingsSchema.parse({});
}

export async function saveAffiliateSettings(input: AffiliateSettings) {
  const value = affiliateSettingsSchema.parse(input);
  await db.setting.upsert({ where: { key: AFFILIATE_SETTINGS_KEY }, update: { value }, create: { key: AFFILIATE_SETTINGS_KEY, value } });
  return value;
}

export const AFF_CODE_RE = /^[A-Z0-9]{4,20}$/;
export const normalizeAffCode = (s: string) => s.trim().toUpperCase();

/** One-way hash so raw IPs are never stored. */
export const hashIp = (ip: string | null | undefined) => (ip ? createHash("sha256").update(`${process.env.AUTH_SECRET ?? ""}:aff:${ip}`).digest("hex").slice(0, 32) : null);

export function affCookieValue(code: string, at = Date.now()) {
  return `${normalizeAffCode(code)}.${at}`;
}
export function parseAffCookie(v: string | null | undefined): { code: string; at: number } | null {
  const m = v?.match(/^([A-Z0-9]{4,20})\.(\d{10,15})$/i);
  return m ? { code: m[1].toUpperCase(), at: Number(m[2]) } : null;
}

/** Gmail-style normalisation: case, dots and +tags in the local part. Used to spot look-alike emails. */
export function canonicalEmail(email: string) {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  return `${local.split("+")[0].replace(/\./g, "")}@${domain.replace(/^googlemail\.com$/, "gmail.com")}`;
}

export const rateOf = (a: { commissionBps: number | null }, s: AffiliateSettings) => a.commissionBps ?? Math.round(s.defaultCommissionPercent * 100);

async function uniqueCode(seed: string) {
  const base = seed.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  for (let i = 0; i < 8; i++) {
    const code = `${base.length >= 3 ? base : "MO"}${randomBytes(2).toString("hex").toUpperCase()}`.slice(0, 20);
    if (!(await db.affiliate.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
  return `AFF${randomBytes(5).toString("hex").toUpperCase()}`;
}

// ─────────────────────────────── Clicks ───────────────────────────────

/** Logs a link click (stats only — attribution comes from the cookie). Ignores the affiliate's own devices and repeats. */
export async function recordClick(input: { code: string; ip?: string | null; deviceId?: string | null; path?: string | null; referrer?: string | null }) {
  const code = normalizeAffCode(input.code);
  if (!AFF_CODE_RE.test(code)) return { ok: false as const };
  const a = await db.affiliate.findUnique({ where: { code }, select: { id: true, status: true, deviceIds: true, ipHashes: true } });
  if (!a || a.status !== "APPROVED") return { ok: false as const };
  const ipHash = hashIp(input.ip);
  const deviceId = input.deviceId?.slice(0, 64) || null;
  if ((deviceId && a.deviceIds.includes(deviceId)) || (ipHash && a.ipHashes.includes(ipHash))) return { ok: true as const, counted: false };
  if (deviceId) {
    const recent = await db.affiliateClick.findFirst({ where: { affiliateId: a.id, deviceId, createdAt: { gte: new Date(Date.now() - 30 * 60_000) } }, select: { id: true } });
    if (recent) return { ok: true as const, counted: false };
  }
  await db.affiliateClick.create({ data: { affiliateId: a.id, ipHash, deviceId, path: input.path?.slice(0, 300) ?? null, referrer: input.referrer?.slice(0, 300) ?? null } });
  return { ok: true as const, counted: true };
}

// ─────────────────────────────── Attribution ───────────────────────────────

export type AffiliateTouch = { cookie?: string | null; ip?: string | null; deviceId?: string | null };

/**
 * Called inside the placement transaction. Creates the ATTRIBUTED (or blocked REJECTED) commission row.
 * Never throws for business reasons — a bad cookie simply means no attribution.
 */
export async function attributeOrder(
  tx: Prisma.TransactionClient,
  order: { id: string; number: string; userId: string | null; email: string; couponCode: string | null },
  touch: AffiliateTouch | null | undefined,
  now = new Date(),
) {
  const settings = await getAffiliateSettings();
  if (!settings.enabled) return null;
  let affiliate = order.couponCode ? await tx.affiliate.findUnique({ where: { couponCode: order.couponCode } }) : null;
  let source = "code";
  let clickedAt: Date | null = null;
  if (!affiliate || affiliate.status !== "APPROVED") {
    affiliate = null;
    const c = parseAffCookie(touch?.cookie);
    if (c && now.getTime() - c.at <= settings.cookieDays * 86400_000 && c.at <= now.getTime() + 60_000) {
      const a = await tx.affiliate.findUnique({ where: { code: c.code } });
      if (a?.status === "APPROVED") {
        affiliate = a;
        source = "link";
        clickedAt = new Date(c.at);
      }
    }
  }
  if (!affiliate) return null;

  const ipHash = hashIp(touch?.ip);
  const deviceId = touch?.deviceId?.slice(0, 64) || null;
  const self = (order.userId && affiliate.userId === order.userId) || order.email.trim().toLowerCase() === affiliate.email.trim().toLowerCase();
  const flags: string[] = [];
  if (self) flags.push("self_referral");
  else {
    if (canonicalEmail(order.email) === canonicalEmail(affiliate.email)) flags.push("similar_email");
    if (ipHash && affiliate.ipHashes.includes(ipHash)) flags.push("same_ip");
    if (deviceId && affiliate.deviceIds.includes(deviceId)) flags.push("same_device");
    if (ipHash) {
      const repeats = await tx.affiliateCommission.count({ where: { affiliateId: affiliate.id, ipHash, createdAt: { gte: new Date(now.getTime() - 30 * 86400_000) }, status: { notIn: ["REJECTED", "REVERSED"] } } });
      if (repeats >= 2) flags.push("repeat_ip");
    }
  }
  return tx.affiliateCommission.create({
    data: {
      affiliateId: affiliate.id,
      orderId: order.id,
      orderNumber: order.number,
      source,
      clickedAt,
      status: self ? "REJECTED" : "ATTRIBUTED",
      rateBps: rateOf(affiliate, settings),
      flags,
      ipHash,
      deviceId,
      note: self ? "Self-referral blocked" : null,
    },
  });
}

/** Commissionable value: merchandise (no gift cards) net of discounts, points, tax and refunds. */
export async function commissionBase(orderId: string, client: Prisma.TransactionClient | typeof db = db) {
  const order = await client.order.findUnique({ where: { id: orderId }, include: { items: true, returns: { where: { status: "REFUNDED" }, select: { refundAmount: true } } } });
  if (!order) return 0;
  const store = await getSettings();
  const goods = order.items.filter((i) => !(i.meta && typeof i.meta === "object" && "giftCard" in (i.meta as object))).reduce((n, i) => n + i.unitPrice * i.quantity, 0);
  const net = Math.max(0, goods - order.discount - order.pointsRedeemed * brand.loyalty.pointValue);
  const exTax = store.taxInclusive ? Math.max(0, net - order.tax) : net;
  const refunded = order.returns.reduce((n, r) => n + (r.refundAmount ?? 0), 0);
  const kept = order.total > 0 ? Math.max(0, 1 - refunded / order.total) : 1;
  return Math.round(exTax * kept);
}

const amountFor = (base: number, rateBps: number) => Math.round((base * rateBps) / 10_000);

/** Order confirmed (afterOrderConfirmed): price the commission, or reject it if the referral bonus took this order. */
export async function confirmCommission(orderId: string, now = new Date()) {
  const c = await db.affiliateCommission.findUnique({ where: { orderId } });
  if (!c || c.status !== "ATTRIBUTED") return c;
  const order = await db.order.findUnique({ where: { id: orderId }, select: { userId: true, user: { select: { referredById: true } } } });
  if (order?.userId && order.user?.referredById) {
    const prior = await db.order.count({ where: { userId: order.userId, id: { not: orderId }, reservedUntil: null, status: { notIn: ["CANCELLED", "PENDING"] } } });
    if (prior === 0) {
      return db.affiliateCommission.update({ where: { id: c.id }, data: { status: "REJECTED", flags: { push: "referral_precedence" }, note: "Referral bonus paid on this order", confirmedAt: now } });
    }
  }
  const base = await commissionBase(orderId);
  return db.affiliateCommission.update({ where: { id: c.id }, data: { status: "PENDING", base, amount: amountFor(base, c.rateBps), confirmedAt: now } });
}

/**
 * Brings a commission in line with its order: cancelled/refunded → reversed (clawback if already paid);
 * partial refunds → smaller amount. Safe to call any time (refund, return, cron).
 */
export async function reconcileCommission(orderId: string, now = new Date()) {
  const c = await db.affiliateCommission.findUnique({ where: { orderId } });
  if (!c || c.status === "REJECTED" || c.status === "REVERSED") return c;
  const order = await db.order.findUnique({ where: { id: orderId }, select: { status: true } });
  const gone = !order || order.status === "CANCELLED" || order.status === "REFUNDED";
  if (gone) {
    return db.affiliateCommission.update({
      where: { id: c.id },
      data: { status: "REVERSED", reversedAt: now, note: order ? `Order ${order.status.toLowerCase()}` : "Order removed", ...(c.status === "PAID" ? { clawback: c.amount } : { amount: 0 }) },
    });
  }
  if (c.status === "ATTRIBUTED") return c;
  const base = await commissionBase(orderId);
  const amount = amountFor(base, c.rateBps);
  if (amount === c.amount) return c;
  if (c.status === "PAID") {
    const owed = Math.max(0, c.amount - amount);
    return owed > c.clawback ? db.affiliateCommission.update({ where: { id: c.id }, data: { clawback: owed, note: "Partly returned after payout" } }) : c;
  }
  if (base === 0) return db.affiliateCommission.update({ where: { id: c.id }, data: { status: "REVERSED", base: 0, amount: 0, reversedAt: now, note: "Returned in full" } });
  return db.affiliateCommission.update({ where: { id: c.id }, data: { base, amount } });
}

/** Daily: reconcile open commissions and approve the ones past the hold (delivered, unflagged, no return in progress). */
export async function runAffiliateSweep(now = new Date()) {
  const settings = await getAffiliateSettings();
  const open = await db.affiliateCommission.findMany({ where: { status: { in: ["ATTRIBUTED", "PENDING", "APPROVED", "PAID"] } }, select: { orderId: true }, take: 2000 });
  for (const c of open) await reconcileCommission(c.orderId, now);
  const due = await db.affiliateCommission.findMany({
    where: { status: "PENDING", flags: { isEmpty: true }, confirmedAt: { lte: new Date(now.getTime() - settings.holdDays * 86400_000) } },
    select: { id: true, orderId: true },
  });
  let approved = 0;
  for (const c of due) {
    const order = await db.order.findUnique({ where: { id: c.orderId }, select: { status: true, returns: { where: { status: { in: ["REQUESTED", "APPROVED", "RECEIVED"] } }, select: { id: true } } } });
    if (order?.status !== "DELIVERED" || order.returns.length) continue;
    await db.affiliateCommission.updateMany({ where: { id: c.id, status: "PENDING" }, data: { status: "APPROVED", approvedAt: now } });
    approved++;
  }
  // Abandoned attributions: orders that never got confirmed.
  const stale = await db.affiliateCommission.findMany({ where: { status: "ATTRIBUTED", createdAt: { lt: new Date(now.getTime() - 7 * 86400_000) } }, select: { orderId: true } });
  for (const s of stale) await reconcileCommission(s.orderId, now);
  return { reconciled: open.length, approved };
}

// ─────────────────────────────── Affiliates ───────────────────────────────

/** Customer applies (or accepts an emailed invite: invited by email → approved on joining). */
export async function joinProgram(user: { id: string; email: string; name: string | null }) {
  const existing = await db.affiliate.findUnique({ where: { userId: user.id } });
  if (existing) return existing;
  const invited = await db.affiliate.findFirst({ where: { userId: null, status: "INVITED", email: { equals: user.email, mode: "insensitive" } } });
  if (invited) return db.affiliate.update({ where: { id: invited.id }, data: { userId: user.id, status: "APPROVED", approvedAt: new Date(), name: invited.name ?? user.name } });
  return db.affiliate.create({ data: { userId: user.id, email: user.email, name: user.name, code: await uniqueCode(user.name ?? user.email.split("@")[0]), status: "PENDING" } });
}

export async function inviteAffiliate(input: { email: string; name?: string | null; commissionBps?: number | null; code?: string | null }) {
  const email = input.email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true } });
  if (user && (await db.affiliate.findUnique({ where: { userId: user.id }, select: { id: true } }))) throw new Error("That customer is already an affiliate.");
  if (await db.affiliate.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } })) throw new Error("That email is already in the program.");
  const code = input.code ? normalizeAffCode(input.code) : await uniqueCode(input.name ?? email.split("@")[0]);
  if (!AFF_CODE_RE.test(code)) throw new Error("Codes are 4–20 letters or numbers.");
  return db.affiliate.create({
    data: {
      email,
      name: input.name ?? user?.name ?? null,
      code,
      commissionBps: input.commissionBps ?? null,
      // An existing customer is linked straight away; others are linked when they sign in with this email.
      userId: user?.id ?? null,
      status: user ? "APPROVED" : "INVITED",
      approvedAt: user ? new Date() : null,
    },
  });
}

/** Remembers the affiliate's own IP/device (last 10 each) so orders from them are flagged. */
export async function noteAffiliateDevice(affiliateId: string, ip: string | null, deviceId: string | null) {
  const a = await db.affiliate.findUnique({ where: { id: affiliateId }, select: { ipHashes: true, deviceIds: true } });
  if (!a) return;
  const h = hashIp(ip);
  const ips = h && !a.ipHashes.includes(h) ? [h, ...a.ipHashes].slice(0, 10) : a.ipHashes;
  const devs = deviceId && !a.deviceIds.includes(deviceId) ? [deviceId, ...a.deviceIds].slice(0, 10) : a.deviceIds;
  if (ips !== a.ipHashes || devs !== a.deviceIds) await db.affiliate.update({ where: { id: affiliateId }, data: { ipHashes: ips, deviceIds: devs } });
}

const sumBy = (rows: { status: CommissionStatus; _sum: { amount: number | null; clawback?: number | null }; _count: { _all: number } }[], ...s: CommissionStatus[]) =>
  rows.filter((r) => s.includes(r.status)).reduce((n, r) => n + (r._sum.amount ?? 0), 0);

export async function affiliateStats(affiliateId: string) {
  const since = new Date(Date.now() - 30 * 86400_000);
  const [clicks, clicks30, groups, owed] = await Promise.all([
    db.affiliateClick.count({ where: { affiliateId } }),
    db.affiliateClick.count({ where: { affiliateId, createdAt: { gte: since } } }),
    db.affiliateCommission.groupBy({ by: ["status"], where: { affiliateId }, _sum: { amount: true }, _count: { _all: true } }),
    db.affiliateCommission.aggregate({ where: { affiliateId, clawback: { gt: 0 }, clawbackPayoutId: null }, _sum: { clawback: true } }),
  ]);
  const orders = groups.filter((g) => ["PENDING", "APPROVED", "PAID"].includes(g.status)).reduce((n, g) => n + g._count._all, 0);
  return {
    clicks,
    clicks30,
    orders,
    conversion: clicks ? orders / clicks : 0,
    pending: sumBy(groups, "PENDING"),
    approved: sumBy(groups, "APPROVED"),
    paid: sumBy(groups, "PAID"),
    clawback: owed._sum.clawback ?? 0,
  };
}

// ─────────────────────────────── Payouts ───────────────────────────────

/**
 * Pays every APPROVED commission of the chosen affiliates (all when empty) whose net (after outstanding clawbacks)
 * reaches the minimum payout. One AffiliatePayout per affiliate, sharing a batch reference. Returns the batch.
 */
export async function createPayoutBatch(actorId: string, opts: { affiliateIds?: string[]; reference?: string | null } = {}) {
  const settings = await getAffiliateSettings();
  const batch = `PAY-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
  const approved = await db.affiliateCommission.groupBy({
    by: ["affiliateId"],
    where: { status: "APPROVED", ...(opts.affiliateIds?.length ? { affiliateId: { in: opts.affiliateIds } } : {}) },
    _sum: { amount: true },
  });
  const paid: { affiliateId: string; amount: number }[] = [];
  for (const g of approved) {
    const out = await db.$transaction(async (tx) => {
      const rows = await tx.affiliateCommission.findMany({ where: { affiliateId: g.affiliateId, status: "APPROVED" }, select: { id: true, amount: true } });
      const claw = await tx.affiliateCommission.findMany({ where: { affiliateId: g.affiliateId, clawback: { gt: 0 }, clawbackPayoutId: null }, select: { id: true, clawback: true } });
      const gross = rows.reduce((n, r) => n + r.amount, 0);
      const back = claw.reduce((n, r) => n + r.clawback, 0);
      const net = gross - back;
      if (!rows.length || net < Math.max(1, settings.minPayout)) return null;
      const payout = await tx.affiliatePayout.create({ data: { batch, affiliateId: g.affiliateId, amount: net, commissions: rows.length, clawback: back, reference: opts.reference ?? null, createdById: actorId } });
      await tx.affiliateCommission.updateMany({ where: { id: { in: rows.map((r) => r.id) }, status: "APPROVED" }, data: { status: "PAID", paidAt: new Date(), payoutId: payout.id } });
      if (claw.length) await tx.affiliateCommission.updateMany({ where: { id: { in: claw.map((c) => c.id) } }, data: { clawbackPayoutId: payout.id } });
      return { affiliateId: g.affiliateId, amount: net };
    });
    if (out) paid.push(out);
  }
  return { batch, paid, total: paid.reduce((n, p) => n + p.amount, 0) };
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // Neutralise spreadsheet formulas and quote everything.
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

export async function payoutCsv(batch: string) {
  const rows = await db.affiliatePayout.findMany({ where: { batch }, orderBy: { createdAt: "asc" } });
  const affs = await db.affiliate.findMany({ where: { id: { in: rows.map((r) => r.affiliateId) } } });
  const byId = new Map(affs.map((a) => [a.id, a]));
  const head = ["batch", "affiliate_code", "name", "email", "payout_details", "commissions", "clawback_inr", "amount_inr", "reference", "created_at"];
  const lines = rows.map((r) => {
    const a = byId.get(r.affiliateId);
    return [r.batch, a?.code, a?.name, a?.email, a?.payoutDetails, r.commissions, (r.clawback / 100).toFixed(2), (r.amount / 100).toFixed(2), r.reference, r.createdAt.toISOString()].map(csvCell).join(",");
  });
  return [head.join(","), ...lines].join("\r\n");
}

export const describeCommission = (c: { amount: number; rateBps: number; base: number }) => `${formatMoney(c.amount)} (${(c.rateBps / 100).toFixed(c.rateBps % 100 ? 1 : 0)}% of ${formatMoney(c.base)})`;
