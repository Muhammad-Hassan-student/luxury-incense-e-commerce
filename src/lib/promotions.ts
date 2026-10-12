// Promotion engine — pure maths shared by the server quote, the admin live preview and tests. Client-safe.
// All amounts are integer minor units (paise).
//
// ── Stacking rules (deterministic, applied in this order) ──
//  1. FLASH SALE  → per-unit sale price. One sale per line: lowest `priority` wins, then the bigger saving, then id.
//                   Shown as the price with the list price struck through. Each unit is clamped by the max-discount guard.
//  2. BUNDLES     → BUY_X_GET_Y, MULTI_BUY ("any N for ₹P"), FIXED_BUNDLE, in `priority` order (then id). Each unit can be
//                   used by at most one bundle. Bundles price units at their (sale) price.
//                     • BUY_X_GET_Y: buy units are taken most-expensive first; the discounted "get" units are the cheapest
//                       remaining eligible ones (merchant-favourable, the usual convention). Only full applications count.
//                     • MULTI_BUY: groups of N from the most expensive eligible units, only while a group costs more than P.
//                     • FIXED_BUNDLE: complete sets only (most expensive matching variants first), only if the set costs more than P.
//  3. TIERED      → cart-level % off the highest threshold met, measured on eligible units after sale + bundle discounts.
//                   If several tiered promotions are live, the one giving the biggest discount wins.
//  4. COUPON      → the existing coupon applies last, on the subtotal after 1–3 (src/lib/pricing.ts).
//
//  "Doesn't stack" (stackable = false):
//     • a non-stackable SALE locks its units: no bundle or tier applies to them;
//     • a non-stackable BUNDLE ignores units that are already on sale, and locks the units it uses;
//     • a non-stackable TIER applies only when no other promotion applied anywhere in the bag.
//  allowCoupon = false on any applied promotion → the coupon is refused with a clear message.
//  Max-discount guard: sale savings + bundle + tier + coupon never exceed `maxDiscountPercent` of the list-price
//     merchandise subtotal. Excess is trimmed from the coupon first, then the tier, then bundles (latest first).
//  Exclusions: gift cards and coffrets never take promotions; Subscribe & Save lines and trade accounts only when the
//     promotion enables them (`includeSubscriptions`, `includeTrade`).
import { z } from "zod";

export const PROMOTION_TYPES = ["FLASH_SALE", "BUY_X_GET_Y", "MULTI_BUY", "FIXED_BUNDLE", "TIERED"] as const;
export type PromotionTypeKey = (typeof PROMOTION_TYPES)[number];

export const PROMOTION_TYPE_LABEL: Record<PromotionTypeKey, string> = {
  FLASH_SALE: "Flash sale",
  BUY_X_GET_Y: "Buy X get Y",
  MULTI_BUY: "Any N for ₹",
  FIXED_BUNDLE: "Curated bundle",
  TIERED: "Tiered cart discount",
};

const money = z.number().int().min(0).max(100_000_000);

export const flashSaleConfig = z.object({ kind: z.enum(["PERCENT", "FIXED"]), value: z.number().int().min(1).max(100_000_000) }).refine((c) => c.kind !== "PERCENT" || c.value <= 90, { message: "A sale can take at most 90% off", path: ["value"] });
export const buyXGetYConfig = z.object({
  buyQty: z.number().int().min(1).max(10),
  getQty: z.number().int().min(1).max(10),
  /** Products the discounted units come from. Empty = the same eligible set as the "buy" side. */
  getProductIds: z.array(z.string().min(1).max(64)).max(50).default([]),
  /** 100 = free. */
  getPercentOff: z.number().int().min(1).max(100).default(100),
  maxApplications: z.number().int().min(1).max(50).nullable().default(null),
});
export const multiBuyConfig = z.object({ quantity: z.number().int().min(2).max(10), price: money.refine((n) => n > 0, "Enter a price"), maxApplications: z.number().int().min(1).max(50).nullable().default(null) });
export const fixedBundleConfig = z.object({
  items: z.array(z.object({ productId: z.string().min(1).max(64), quantity: z.number().int().min(1).max(5) })).min(1).max(8),
  price: money.refine((n) => n > 0, "Enter a price"),
}).refine((c) => c.items.reduce((n, i) => n + i.quantity, 0) >= 2, { message: "A bundle needs at least two pieces", path: ["items"] });
export const tieredConfig = z.object({
  tiers: z.array(z.object({ threshold: money.refine((n) => n > 0, "Enter a threshold"), percent: z.number().int().min(1).max(90) })).min(1).max(6),
});

export const CONFIG_SCHEMAS = { FLASH_SALE: flashSaleConfig, BUY_X_GET_Y: buyXGetYConfig, MULTI_BUY: multiBuyConfig, FIXED_BUNDLE: fixedBundleConfig, TIERED: tieredConfig } as const;

export type PromoConfig =
  | { type: "FLASH_SALE"; config: z.infer<typeof flashSaleConfig> }
  | { type: "BUY_X_GET_Y"; config: z.infer<typeof buyXGetYConfig> }
  | { type: "MULTI_BUY"; config: z.infer<typeof multiBuyConfig> }
  | { type: "FIXED_BUNDLE"; config: z.infer<typeof fixedBundleConfig> }
  | { type: "TIERED"; config: z.infer<typeof tieredConfig> };

export type PromoDef = PromoConfig & {
  id: string;
  name: string;
  badge: string | null;
  productIds: string[];
  categoryIds: string[];
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  priority: number;
  stackable: boolean;
  allowCoupon: boolean;
  includeTrade: boolean;
  includeSubscriptions: boolean;
};

/** Parses a stored promotion's JSON config; returns null when it's invalid (an invalid promotion never applies). */
export function parsePromo<T extends Omit<PromoDef, "config" | "type"> & { type: string; config: unknown }>(row: T): PromoDef | null {
  const schema = CONFIG_SCHEMAS[row.type as PromotionTypeKey];
  if (!schema) return null;
  const parsed = schema.safeParse(row.config);
  if (!parsed.success) return null;
  return { ...row, type: row.type, config: parsed.data } as PromoDef;
}

/** Live at `now`: active, started, and not yet ended. The end is exclusive: at endsAt the promotion is over. */
export const isLive = (p: { isActive: boolean; startsAt: Date | null; endsAt: Date | null }, now: Date) =>
  p.isActive && (!p.startsAt || now.getTime() >= p.startsAt.getTime()) && (!p.endsAt || now.getTime() < p.endsAt.getTime());

export const targets = (p: { productIds: string[]; categoryIds: string[] }, productId: string, categoryId: string) =>
  (!p.productIds.length && !p.categoryIds.length) || p.productIds.includes(productId) || p.categoryIds.includes(categoryId);

/** Unit sale price, never below the max-discount floor. */
export function salePrice(list: number, sale: { kind: "PERCENT" | "FIXED"; value: number }, maxDiscountPercent = 100) {
  const raw = sale.kind === "PERCENT" ? Math.round((list * (100 - sale.value)) / 100) : list - sale.value;
  const floor = Math.ceil((list * (100 - Math.min(100, Math.max(0, maxDiscountPercent)))) / 100);
  return Math.max(0, floor, raw);
}

export type PromoLine = {
  id: string;
  productId: string;
  categoryId: string;
  /** Unit price before any promotion (Subscribe & Save lines: their subscription price). */
  listPrice: number;
  quantity: number;
  /** Gift cards and coffrets: never discounted. */
  excluded?: boolean;
  subscription?: boolean;
};

export type PromoContext = { now: Date; trade?: boolean; maxDiscountPercent?: number };

export type AppliedPromo = { promotionId: string; name: string; type: PromotionTypeKey; badge: string | null; discount: number; revenue: number; allowCoupon: boolean };

export type PromoNudge =
  | { promotionId: string; name: string; kind: "BUY_X_GET_Y"; addQty: number; getQty: number; percentOff: number; getProductIds: string[] }
  | { promotionId: string; name: string; kind: "MULTI_BUY"; addQty: number; quantity: number; price: number }
  | { promotionId: string; name: string; kind: "FIXED_BUNDLE"; missing: { productId: string; quantity: number }[]; price: number }
  | { promotionId: string; name: string; kind: "TIERED"; remaining: number; percent: number; threshold: number };

export type PricedPromoLine = { id: string; listPrice: number; unitPrice: number; quantity: number; sale: { promotionId: string; name: string; badge: string | null; endsAt: Date | null } | null };

export type PromoResult = {
  lines: PricedPromoLine[];
  /** List-price merchandise subtotal (excluded lines included at their price). */
  listSubtotal: number;
  saleSavings: number;
  /** Bundle + tier discount (on top of sale prices, before the coupon). */
  promoDiscount: number;
  applied: AppliedPromo[];
  nudges: PromoNudge[];
  tier: { promotionId: string; base: number; percent: number; next: { threshold: number; percent: number; remaining: number } | null } | null;
  /** Name of the applied promotion that refuses coupons, if any. */
  couponBlockedBy: string | null;
  /** Most the coupon may take under the max-discount guard. */
  couponCap: number;
  maxDiscount: number;
};

type Unit = { line: number; productId: string; categoryId: string; price: number; sub: boolean; saleId: string | null; locked: boolean; usedBy: string | null; discount: number };

const byPriority = (a: PromoDef, b: PromoDef) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function evaluatePromotions(input: { lines: PromoLine[]; promotions: PromoDef[]; ctx: PromoContext }): PromoResult {
  const { now } = input.ctx;
  const maxPct = Math.min(100, Math.max(0, input.ctx.maxDiscountPercent ?? 100));
  const live = input.promotions.filter((p) => isLive(p, now)).sort(byPriority);
  const eligible = (p: PromoDef, l: { excluded?: boolean; subscription?: boolean; productId: string; categoryId: string }) =>
    !l.excluded && (!l.subscription || p.includeSubscriptions) && (!input.ctx.trade || p.includeTrade) && targets(p, l.productId, l.categoryId);

  const applied = new Map<string, AppliedPromo>();
  const addApplied = (p: PromoDef, discount: number, revenue: number) => {
    const a = applied.get(p.id) ?? { promotionId: p.id, name: p.name, type: p.type, badge: p.badge, discount: 0, revenue: 0, allowCoupon: p.allowCoupon };
    a.discount += discount;
    a.revenue += revenue;
    applied.set(p.id, a);
  };

  // ── 1. Flash sales ──
  const sales = live.filter((p): p is PromoDef & { type: "FLASH_SALE" } => p.type === "FLASH_SALE");
  const lines: PricedPromoLine[] = input.lines.map((l) => {
    let best: { p: PromoDef & { type: "FLASH_SALE" }; price: number } | null = null;
    for (const p of sales) {
      if (!eligible(p, l)) continue;
      const price = salePrice(l.listPrice, p.config, maxPct);
      if (price >= l.listPrice) continue;
      if (!best || p.priority < best.p.priority || (p.priority === best.p.priority && price < best.price)) best = { p, price };
    }
    if (best) addApplied(best.p, (l.listPrice - best.price) * l.quantity, best.price * l.quantity);
    return { id: l.id, listPrice: l.listPrice, unitPrice: best?.price ?? l.listPrice, quantity: l.quantity, sale: best ? { promotionId: best.p.id, name: best.p.name, badge: best.p.badge, endsAt: best.p.endsAt } : null };
  });
  const saleIdOf = new Map(sales.map((s) => [s.id, s]));

  const units: Unit[] = [];
  input.lines.forEach((l, i) => {
    const sale = lines[i].sale ? saleIdOf.get(lines[i].sale!.promotionId) : undefined;
    for (let q = 0; q < l.quantity; q++) {
      units.push({ line: i, productId: l.productId, categoryId: l.categoryId, price: lines[i].unitPrice, sub: Boolean(l.subscription), saleId: sale?.id ?? null, locked: Boolean(sale && !sale.stackable), usedBy: null, discount: 0 });
    }
  });
  const unitOk = (p: PromoDef, u: Unit) => !u.locked && !u.usedBy && !(p.stackable === false && u.saleId) && eligible(p, { ...input.lines[u.line], subscription: u.sub });
  const desc = (a: Unit, b: Unit) => b.price - a.price || a.line - b.line;
  const asc = (a: Unit, b: Unit) => a.price - b.price || b.line - a.line;
  const nudges: PromoNudge[] = [];
  const bundleOrder: string[] = [];

  // ── 2. Bundles ──
  for (const p of live) {
    if (p.type === "BUY_X_GET_Y") {
      const { buyQty, getQty, getProductIds, getPercentOff, maxApplications } = p.config;
      const inGet = (u: Unit) => (getProductIds.length ? getProductIds.includes(u.productId) && !u.locked && !u.usedBy && !(p.stackable === false && u.saleId) && !input.lines[u.line].excluded && (!u.sub || p.includeSubscriptions) && (!input.ctx.trade || p.includeTrade) : unitOk(p, u));
      let apps = 0;
      for (;;) {
        if (maxApplications != null && apps >= maxApplications) break;
        const buy = units.filter((u) => unitOk(p, u)).sort(desc);
        if (buy.length < buyQty) break;
        const chosen = buy.slice(0, buyQty);
        const gets = units.filter((u) => !chosen.includes(u) && inGet(u)).sort(asc);
        if (gets.length < getQty) break;
        const free = gets.slice(0, getQty);
        let discount = 0;
        let revenue = 0;
        for (const u of chosen) {
          u.usedBy = p.id;
          revenue += u.price;
        }
        for (const u of free) {
          u.usedBy = p.id;
          u.discount = Math.round((u.price * getPercentOff) / 100);
          discount += u.discount;
          revenue += u.price - u.discount;
        }
        if (!p.stackable) for (const u of [...chosen, ...free]) u.locked = true;
        addApplied(p, discount, revenue);
        apps++;
      }
      if (maxApplications == null || apps < maxApplications) {
        const leftBuy = units.filter((u) => unitOk(p, u));
        if (getProductIds.length) {
          if (leftBuy.length >= buyQty) nudges.push({ promotionId: p.id, name: p.name, kind: "BUY_X_GET_Y", addQty: getQty, getQty, percentOff: getPercentOff, getProductIds });
          else if (leftBuy.length > 0) nudges.push({ promotionId: p.id, name: p.name, kind: "BUY_X_GET_Y", addQty: buyQty - leftBuy.length, getQty, percentOff: getPercentOff, getProductIds: [] });
        } else if (leftBuy.length > 0) {
          nudges.push({ promotionId: p.id, name: p.name, kind: "BUY_X_GET_Y", addQty: buyQty + getQty - leftBuy.length, getQty, percentOff: getPercentOff, getProductIds: [] });
        }
      }
      if (applied.has(p.id)) bundleOrder.push(p.id);
    } else if (p.type === "MULTI_BUY") {
      const { quantity, price, maxApplications } = p.config;
      let apps = 0;
      for (;;) {
        if (maxApplications != null && apps >= maxApplications) break;
        const pool = units.filter((u) => unitOk(p, u)).sort(desc);
        if (pool.length < quantity) break;
        const group = pool.slice(0, quantity);
        const sum = group.reduce((n, u) => n + u.price, 0);
        if (sum <= price) break;
        spread(group, sum - price);
        for (const u of group) {
          u.usedBy = p.id;
          if (!p.stackable) u.locked = true;
        }
        addApplied(p, sum - price, price);
        apps++;
      }
      const left = units.filter((u) => unitOk(p, u)).length;
      if ((maxApplications == null || apps < maxApplications) && left > 0 && left < quantity) nudges.push({ promotionId: p.id, name: p.name, kind: "MULTI_BUY", addQty: quantity - left, quantity, price });
      if (applied.has(p.id)) bundleOrder.push(p.id);
    } else if (p.type === "FIXED_BUNDLE") {
      const { items, price } = p.config;
      const okFor = (productId: string) => (u: Unit) => u.productId === productId && !u.locked && !u.usedBy && !(p.stackable === false && u.saleId) && !input.lines[u.line].excluded && (!u.sub || p.includeSubscriptions) && (!input.ctx.trade || p.includeTrade);
      for (;;) {
        const picked: Unit[] = [];
        let complete = true;
        for (const it of items) {
          const pool = units.filter((u) => okFor(it.productId)(u) && !picked.includes(u)).sort(desc);
          if (pool.length < it.quantity) {
            complete = false;
            break;
          }
          picked.push(...pool.slice(0, it.quantity));
        }
        if (!complete) break;
        const sum = picked.reduce((n, u) => n + u.price, 0);
        if (sum <= price) break;
        spread(picked, sum - price);
        for (const u of picked) {
          u.usedBy = p.id;
          if (!p.stackable) u.locked = true;
        }
        addApplied(p, sum - price, price);
      }
      // Nudge when part of the set is in the bag.
      const missing = items
        .map((it) => ({ productId: it.productId, quantity: Math.max(0, it.quantity - units.filter(okFor(it.productId)).length) }))
        .filter((m) => m.quantity > 0);
      if (missing.length && missing.length < items.length) nudges.push({ promotionId: p.id, name: p.name, kind: "FIXED_BUNDLE", missing, price });
      if (applied.has(p.id)) bundleOrder.push(p.id);
    }
  }

  // ── 3. Tiered ──
  let tier: PromoResult["tier"] = null;
  let tierPromo: PromoDef | null = null;
  let tierDiscount = 0;
  for (const p of live) {
    if (p.type !== "TIERED") continue;
    if (!p.stackable && applied.size > 0) continue;
    const pool = units.filter((u) => !u.locked && !(p.stackable === false && (u.saleId || u.usedBy)) && eligible(p, { ...input.lines[u.line], subscription: u.sub }));
    const base = pool.reduce((n, u) => n + u.price - u.discount, 0);
    const tiers = [...p.config.tiers].sort((a, b) => a.threshold - b.threshold);
    const met = tiers.filter((t) => base >= t.threshold).pop() ?? null;
    const nextT = tiers.find((t) => base < t.threshold) ?? null;
    const discount = met ? Math.round((base * met.percent) / 100) : 0;
    const candidate = { promotionId: p.id, base, percent: met?.percent ?? 0, next: nextT ? { threshold: nextT.threshold, percent: nextT.percent, remaining: nextT.threshold - base } : null };
    if (!tier || discount > tierDiscount || (discount === tierDiscount && !tierPromo)) {
      tier = candidate;
      tierPromo = p;
      tierDiscount = discount;
    }
  }
  if (tierPromo && tier) {
    if (tierDiscount > 0) addApplied(tierPromo, tierDiscount, tier.base - tierDiscount);
    if (tier.next) nudges.push({ promotionId: tierPromo.id, name: tierPromo.name, kind: "TIERED", remaining: tier.next.remaining, percent: tier.next.percent, threshold: tier.next.threshold });
  }

  // ── Guard ──
  const listSubtotal = input.lines.reduce((n, l) => n + l.listPrice * l.quantity, 0);
  const guardBase = input.lines.filter((l) => !l.excluded).reduce((n, l) => n + l.listPrice * l.quantity, 0);
  const maxDiscount = Math.floor((guardBase * maxPct) / 100);
  const saleSavings = lines.reduce((n, l) => n + (l.listPrice - l.unitPrice) * l.quantity, 0);
  let over = saleSavings + [...applied.values()].filter((a) => a.type !== "FLASH_SALE").reduce((n, a) => n + a.discount, 0) - maxDiscount;
  const trimOrder = [...(tierPromo ? [tierPromo.id] : []), ...bundleOrder.reverse()];
  for (const id of trimOrder) {
    if (over <= 0) break;
    const a = applied.get(id);
    if (!a) continue;
    const cut = Math.min(a.discount, over);
    a.discount -= cut;
    a.revenue += cut;
    over -= cut;
  }
  const promoDiscount = [...applied.values()].filter((a) => a.type !== "FLASH_SALE").reduce((n, a) => n + a.discount, 0);
  const result = [...applied.values()].filter((a) => a.discount > 0);
  const blocker = result.find((a) => !a.allowCoupon);

  return {
    lines,
    listSubtotal,
    saleSavings,
    promoDiscount,
    applied: result,
    nudges,
    tier,
    couponBlockedBy: blocker?.name ?? null,
    couponCap: Math.max(0, maxDiscount - saleSavings - promoDiscount),
    maxDiscount,
  };
}

/** Spreads a group discount over its units (for per-unit bookkeeping; the order keeps the total). */
function spread(units: Unit[], discount: number) {
  const sum = units.reduce((n, u) => n + u.price, 0) || 1;
  let left = discount;
  units.forEach((u, i) => {
    const share = i === units.length - 1 ? left : Math.round((discount * u.price) / sum);
    u.discount = share;
    left -= share;
  });
}

// ── Storefront display helpers (client) ──

export type StorefrontSale = { id: string; name: string; badge: string | null; kind: "PERCENT" | "FIXED"; value: number; priority: number; startsAt: string | null; endsAt: string | null; productIds: string[]; categoryKeys: string[] };

/** Same choice rule as the engine: lowest priority, then the bigger saving. `categoryKey` is a slug or id, matching how the sale was published. */
export function pickSale(sales: StorefrontSale[], productId: string, categoryKey: string, list: number, now: number, maxDiscountPercent = 100) {
  let best: { sale: StorefrontSale; price: number } | null = null;
  for (const s of sales) {
    if (s.startsAt && now < Date.parse(s.startsAt)) continue;
    if (s.endsAt && now >= Date.parse(s.endsAt)) continue;
    const all = !s.productIds.length && !s.categoryKeys.length;
    if (!all && !s.productIds.includes(productId) && !s.categoryKeys.includes(categoryKey)) continue;
    const price = salePrice(list, s, maxDiscountPercent);
    if (price >= list) continue;
    if (!best || s.priority < best.sale.priority || (s.priority === best.sale.priority && price < best.price)) best = { sale: s, price };
  }
  return best;
}
