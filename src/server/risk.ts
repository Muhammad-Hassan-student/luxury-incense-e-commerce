import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { canDo } from "@/lib/permissions";
import { db } from "./db";
import { audit } from "./audit";
import { flag } from "./settings";
import { looksFakePhone, normalizePhone } from "./whatsapp/phone";

/*
 * RTO (return-to-origin) risk: a 0–100 score with explained reasons, COD rules (max value, risk cut-off,
 * blocklists, fee, prepaid incentive) and COD confirmation timing. Settings live in Setting "cod-risk".
 */

export const RISK_SETTINGS_KEY = "cod-risk";

const list = z.array(z.string().trim().min(1).max(32)).max(5000).default([]);

export const riskSettingsSchema = z.object({
  /** Orders above this (minor units) can't be COD. 0 = no limit. */
  codMaxOrderValue: z.number().int().min(0).default(2_500_000),
  /** COD is hidden at/above this risk score. 101 = never by score. */
  codBlockRiskAbove: z.number().int().min(1).max(101).default(70),
  /** Added to COD orders (minor units). */
  codFee: z.number().int().min(0).max(1_000_000).default(0),
  /** Reward for paying online: none, a % off goods, or free shipping. */
  prepaidIncentive: z.enum(["none", "percent", "free_shipping"]).default("none"),
  prepaidPercent: z.number().min(0).max(50).default(5),
  /** COD orders must be confirmed by the customer (WhatsApp / link / email / call) before packing. */
  codConfirmation: z.boolean().default(true),
  confirmWithinHours: z.number().int().min(1).max(168).default(24),
  /** Reminder goes out this many hours before the auto-cancel. */
  reminderBeforeHours: z.number().int().min(0).max(167).default(6),
  blockedPhones: list,
  blockedPincodes: list,
  /** Abandoned-bag WhatsApp reminders (marketing; only with consent). */
  abandonedWhatsApp: z.boolean().default(true),
  /** At most one marketing WhatsApp per phone in this many days. */
  marketingCapDays: z.number().int().min(1).max(90).default(7),
});
export type RiskSettings = z.infer<typeof riskSettingsSchema>;

export async function getRiskSettings(): Promise<RiskSettings> {
  const row = await db.setting.findUnique({ where: { key: RISK_SETTINGS_KEY } });
  const parsed = riskSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : riskSettingsSchema.parse({});
}

export class PermissionError extends Error {
  constructor(message = "You don’t have permission to do that.") {
    super(message);
  }
}

export type Actor = { id: string; permissions: readonly string[] };

export async function saveRiskSettings(actor: Actor, input: z.input<typeof riskSettingsSchema>) {
  if (!canDo(actor.permissions, "settings.manage")) throw new PermissionError();
  const value = riskSettingsSchema.parse(input);
  value.blockedPhones = [...new Set(value.blockedPhones.map((p) => normalizePhone(p) ?? p))];
  value.blockedPincodes = [...new Set(value.blockedPincodes.map((p) => p.replace(/\s/g, "").toUpperCase()))];
  if (value.reminderBeforeHours >= value.confirmWithinHours) value.reminderBeforeHours = Math.max(0, value.confirmWithinHours - 1);
  await db.setting.upsert({ where: { key: RISK_SETTINGS_KEY }, create: { key: RISK_SETTINGS_KEY, value }, update: { value } });
  await audit(actor.id, "risk.settings", "Setting", RISK_SETTINGS_KEY, {
    codMaxOrderValue: value.codMaxOrderValue,
    codBlockRiskAbove: value.codBlockRiskAbove,
    codFee: value.codFee,
    prepaidIncentive: value.prepaidIncentive,
    confirmWithinHours: value.confirmWithinHours,
    blockedPhones: value.blockedPhones.length,
    blockedPincodes: value.blockedPincodes.length,
  });
  return value;
}

// ─────────────────────────────── Scoring ───────────────────────────────

export type RiskReason = { code: string; label: string; points: number };
export type RiskResult = { score: number; reasons: RiskReason[]; blocked: string | null; phone: string | null };

/** Common throwaway-inbox domains. */
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "10minutemail.com", "tempmail.com", "temp-mail.org", "yopmail.com", "trashmail.com",
  "getnada.com", "sharklasers.com", "dispostable.com", "maildrop.cc", "throwawaymail.com", "fakeinbox.com", "mintemail.com", "mohmal.com",
  "emailondeck.com", "tempinbox.com", "spamgourmet.com", "mailnesia.com", "tempr.email", "discard.email", "burnermail.io", "moakt.com",
]);
export const isDisposableEmail = (email: string) => DISPOSABLE.has(email.trim().toLowerCase().split("@")[1] ?? "");

const normPin = (pin: string) => pin.replace(/\s/g, "").toUpperCase();

/** Ways the same number may have been typed into past orders' shipping addresses. */
function phoneVariants(raw: string, e164: string | null) {
  const out = new Set([raw.trim()]);
  if (e164) {
    out.add(e164);
    if (e164.startsWith("+91")) {
      const local = e164.slice(3);
      for (const v of [local, `0${local}`, `91${local}`, `+91 ${local}`, `+91-${local}`, `+91 ${local.slice(0, 5)} ${local.slice(5)}`]) out.add(v);
    }
  }
  return [...out];
}

/** Orders that came back or were refused: cancelled COD orders and anything whose timeline mentions RTO. */
const failedCod: Prisma.OrderWhereInput = {
  OR: [
    { status: "CANCELLED", payments: { some: { provider: "COD" } } },
    { codStatus: "CANCELLED" },
    { events: { some: { message: { contains: "RTO", mode: "insensitive" } } } },
  ],
};

export async function scoreRisk(input: {
  email: string;
  phone: string;
  country?: string;
  postalCode: string;
  /** What the customer would pay on delivery (minor units). */
  amount: number;
  userId?: string | null;
  /** Exclude this order from history (re-scoring a placed order). */
  orderId?: string;
  settings?: RiskSettings;
  now?: Date;
}): Promise<RiskResult> {
  const s = input.settings ?? (await getRiskSettings());
  const now = input.now ?? new Date();
  const reasons: RiskReason[] = [];
  const add = (code: string, label: string, points: number) => reasons.push({ code, label, points });
  const country = input.country ?? "IN";
  const phone = normalizePhone(input.phone, country);
  const pin = normPin(input.postalCode);
  const email = input.email.trim().toLowerCase();
  let blocked: string | null = null;

  if (phone && s.blockedPhones.includes(phone)) {
    blocked = "phone";
    add("blocked_phone", "Phone number is on the COD blocklist", 100);
  }
  if (s.blockedPincodes.includes(pin)) {
    blocked ??= "pincode";
    add("blocked_pincode", `Pincode ${pin} is on the COD blocklist`, 100);
  }

  if (!phone) add("invalid_phone", "Phone number isn’t a valid mobile number", 30);
  else if (looksFakePhone(phone)) add("fake_phone", "Phone number looks made up", 25);

  if (isDisposableEmail(email)) add("disposable_email", "Disposable email address", 20);

  const notThis: Prisma.OrderWhereInput = input.orderId ? { id: { not: input.orderId } } : {};
  const variants = phoneVariants(input.phone, phone);
  const samePerson: Prisma.OrderWhereInput = {
    OR: [
      { email: { equals: email, mode: "insensitive" } },
      ...(input.userId ? [{ userId: input.userId }] : []),
      ...variants.map((v) => ({ shippingAddress: { path: ["phone"], equals: v } })),
    ],
  };

  const [completed, failed, recent, user] = await Promise.all([
    db.order.count({ where: { ...notThis, ...samePerson, status: { in: ["DELIVERED", "SHIPPED", "PAID", "PACKED"] }, reservedUntil: null } }),
    db.order.count({ where: { AND: [notThis, samePerson, failedCod] } }),
    db.order.count({ where: { ...notThis, ...samePerson, placedAt: { gte: new Date(now.getTime() - 24 * 3600_000) } } }),
    input.userId ? db.user.findUnique({ where: { id: input.userId }, select: { phone: true } }) : null,
  ]);

  if (completed === 0) add("new_customer", "First order from this customer", 15);
  if (failed > 0) add("past_rto", `${failed} earlier cash-on-delivery order${failed === 1 ? " was" : "s were"} refused, returned or cancelled`, Math.min(50, 25 * failed));
  if (recent >= 2) add("velocity", `${recent} other orders in the last 24 hours`, recent >= 4 ? 25 : 15);

  const savedPhone = user?.phone ? normalizePhone(user.phone, country) : null;
  if (phone && savedPhone && savedPhone !== phone) add("phone_mismatch", "Phone differs from the one on the account", 10);

  // Pincode history (last 180 days of COD orders delivered to this pincode).
  const since = new Date(now.getTime() - 180 * 864e5);
  const pinWhere: Prisma.OrderWhereInput = { ...notThis, placedAt: { gte: since }, shippingAddress: { path: ["postalCode"], equals: input.postalCode.trim() }, payments: { some: { provider: "COD" } } };
  const [pinTotal, pinFailed] = await Promise.all([db.order.count({ where: pinWhere }), db.order.count({ where: { AND: [pinWhere, failedCod] } })]);
  if (pinTotal >= 3 && pinFailed / pinTotal >= 0.3) add("pincode_rto", `${Math.round((pinFailed / pinTotal) * 100)}% of COD orders to ${pin} failed (${pinFailed}/${pinTotal})`, pinFailed / pinTotal >= 0.5 ? 25 : 15);

  if (s.codMaxOrderValue > 0) {
    if (input.amount > s.codMaxOrderValue) add("over_cod_limit", "Order value is above the COD limit", 20);
    else if (input.amount >= s.codMaxOrderValue * 0.6) add("high_value", "High order value for cash on delivery", 10);
  }

  const score = Math.min(100, reasons.reduce((n, r) => n + r.points, 0));
  return { score, reasons, blocked, phone };
}

// ─────────────────────────────── COD availability ───────────────────────────────

export type CodDecision = {
  allowed: boolean;
  /** Customer-facing explanation when not allowed. */
  message: string | null;
  fee: number;
  incentive: string | null;
  risk: RiskResult;
};

export function incentiveLabel(s: RiskSettings) {
  if (s.prepaidIncentive === "percent" && s.prepaidPercent > 0) return `${s.prepaidPercent}% off`;
  if (s.prepaidIncentive === "free_shipping") return "free shipping";
  return null;
}

/** Whether cash on delivery may be offered for this customer, address and amount. */
export async function codDecision(input: Parameters<typeof scoreRisk>[0] & { digital?: boolean }): Promise<CodDecision> {
  const s = input.settings ?? (await getRiskSettings());
  const risk = await scoreRisk({ ...input, settings: s });
  const incentive = incentiveLabel(s);
  const prepaid = incentive ? ` Pay online instead and get ${incentive}.` : " Please pay online instead.";
  let message: string | null = null;
  if (input.digital) message = "Gift cards need to be paid online.";
  else if (!(await flag("cod"))) message = "Cash on delivery isn’t available right now.";
  else if (input.country && input.country !== "IN") message = "Cash on delivery is available for Indian addresses only.";
  else if (risk.blocked) message = `Cash on delivery isn’t available for this ${risk.blocked === "phone" ? "phone number" : "pincode"}.${prepaid}`;
  else if (s.codMaxOrderValue > 0 && input.amount > s.codMaxOrderValue) message = `Cash on delivery is available on orders up to ₹${Math.floor(s.codMaxOrderValue / 100).toLocaleString("en-IN")}.${prepaid}`;
  else if (risk.score >= s.codBlockRiskAbove) message = `We can’t offer cash on delivery for this order.${prepaid}`;
  return { allowed: !message, message, fee: s.codFee, incentive, risk };
}

export type StorefrontAdjustment = { codFee: number; prepaidDiscount: number; shippingWaived: number };

/**
 * Storefront money rules on top of the normal quote: the COD fee, or the prepaid incentive for paying online.
 * Mutates and returns `p` (a `price()` result) so totals, tax and the gift-card split stay consistent.
 */
export function applyStorefrontRules<
  P extends { discount: number; pointsValue: number; shipping: number; tax: number; total: number; giftCardApplied: number; payable: number },
>(p: P, o: { provider: "COD" | "ONLINE"; goodsSubtotal: number; giftCardBalance: number; settings: RiskSettings; taxRatePercent: number; taxInclusive: boolean }): { pricing: P; adjust: StorefrontAdjustment } {
  const s = o.settings;
  const adjust: StorefrontAdjustment = { codFee: 0, prepaidDiscount: 0, shippingWaived: 0 };
  if (o.goodsSubtotal <= 0) return { pricing: p, adjust };
  if (o.provider === "COD") {
    adjust.codFee = s.codFee;
    p.shipping += s.codFee;
    p.total += s.codFee;
  } else if (p.payable > 0 && s.prepaidIncentive === "free_shipping") {
    adjust.shippingWaived = p.shipping;
    p.total -= p.shipping;
    p.shipping = 0;
  } else if (p.payable > 0 && s.prepaidIncentive === "percent" && s.prepaidPercent > 0) {
    const goods = Math.max(0, o.goodsSubtotal - p.discount - p.pointsValue);
    const d = Math.round((goods * s.prepaidPercent) / 100);
    const rate = o.taxRatePercent / 100;
    const taxDelta = o.taxInclusive ? Math.round(d - d / (1 + rate)) : Math.round(d * rate);
    adjust.prepaidDiscount = d;
    p.discount += d;
    p.tax -= taxDelta;
    p.total -= d + (o.taxInclusive ? 0 : taxDelta);
  }
  p.giftCardApplied = Math.max(0, Math.min(o.giftCardBalance, p.total));
  p.payable = p.total - p.giftCardApplied;
  return { pricing: p, adjust };
}

// ─────────────────────────────── Reporting ───────────────────────────────

export type PincodeStat = { pin: string; total: number; failed: number; delivered: number; rate: number };

/** COD outcomes per pincode over the last `days` (failed = cancelled/refused or marked RTO). */
export async function pincodeStats(days = 180, limit = 25): Promise<PincodeStat[]> {
  const since = new Date(Date.now() - days * 864e5);
  const rows = await db.$queryRaw<{ pin: string | null; total: number; failed: number; delivered: number }[]>`
    SELECT o."shippingAddress"->>'postalCode' AS pin,
           count(*)::int AS total,
           count(*) FILTER (WHERE o.status = 'CANCELLED' OR o."codStatus" = 'CANCELLED'
             OR EXISTS (SELECT 1 FROM "OrderEvent" e WHERE e."orderId" = o.id AND e.message ILIKE '%RTO%'))::int AS failed,
           count(*) FILTER (WHERE o.status = 'DELIVERED')::int AS delivered
      FROM "Order" o
     WHERE o."placedAt" >= ${since}
       AND EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o.id AND p.provider = 'COD')
     GROUP BY 1
     ORDER BY failed DESC, total DESC
     LIMIT ${limit}`;
  return rows.filter((r) => r.pin).map((r) => ({ pin: r.pin!, total: r.total, failed: r.failed, delivered: r.delivered, rate: r.total ? r.failed / r.total : 0 }));
}

export const riskTone = (score: number | null | undefined): "gold" | "ember" | "muted" => (score == null ? "muted" : score >= 60 ? "ember" : score >= 30 ? "gold" : "muted");
