import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { coffretPrice } from "@/lib/pricing";
import { evaluatePromotions, isLive, parsePromo, type PromoDef, type PromoLine, type PromoResult, type StorefrontSale } from "@/lib/promotions";
import { db } from "./db";
import { activePreorders } from "./preorders";
import type { CartLine } from "./cart-lines";

// Promotions on the server: loads live promotions, re-prices bag lines from the database (so a tampered client price
// is never used), runs the engine (src/lib/promotions.ts — stacking rules documented there) and records usage.
// quote() in src/server/orders.ts is the single place checkout totals come from.

export const PROMOTION_SETTINGS_KEY = "promotions";
export const promotionSettingsSchema = z.object({
  /** Max share of the list-price merchandise subtotal all promotions + coupon together may take. */
  maxDiscountPercent: z.number().int().min(5).max(95).default(60),
});
export type PromotionSettings = z.infer<typeof promotionSettingsSchema>;

export async function getPromotionSettings(): Promise<PromotionSettings> {
  const row = await db.setting.findUnique({ where: { key: PROMOTION_SETTINGS_KEY } });
  const parsed = promotionSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : promotionSettingsSchema.parse({});
}

export async function savePromotionSettings(input: PromotionSettings) {
  const value = promotionSettingsSchema.parse(input);
  await db.setting.upsert({ where: { key: PROMOTION_SETTINGS_KEY }, update: { value }, create: { key: PROMOTION_SETTINGS_KEY, value } });
  return value;
}

type PromotionRow = Prisma.PromotionGetPayload<object>;
export const toDef = (row: PromotionRow): PromoDef | null => parsePromo(row);

/** Promotions live at `now` (paused or out-of-window ones are left out by the query and again by the engine). */
export async function livePromotions(now = new Date()): Promise<PromoDef[]> {
  const rows = await db.promotion.findMany({
    where: { isActive: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] },
  });
  return rows.map(toDef).filter((p): p is PromoDef => p !== null && isLive(p, now));
}

async function isTradeBuyer(userId: string | null | undefined) {
  if (!userId) return false;
  const t = await db.tradeAccount.findUnique({ where: { userId }, select: { status: true } });
  return t?.status === "APPROVED";
}

async function subscribePercent(): Promise<number | null> {
  const row = await db.setting.findUnique({ where: { key: "subscriptions" } });
  const v = (row?.value ?? {}) as { enabled?: boolean; discountPercent?: number };
  if (v.enabled === false) return null;
  return typeof v.discountPercent === "number" && v.discountPercent >= 0 && v.discountPercent <= 50 ? Math.round(v.discountPercent) : 10;
}

export type PricedCart = { lines: CartLine[]; result: PromoResult };

/**
 * Re-prices bag lines from the database and applies promotions. Every unit price, including coffrets, gift cards and
 * Subscribe & Save lines, comes from the catalog — whatever `unitPrice` the lines arrived with is ignored.
 * Pre-order lines get their availability from the pre-order allocation instead of on-hand stock.
 */
export async function priceCart(lines: CartLine[], opts: { userId?: string | null; now?: Date; promotions?: PromoDef[]; settings?: PromotionSettings } = {}): Promise<PricedCart> {
  const now = opts.now ?? new Date();
  const ids = [...new Set(lines.flatMap((l) => [l.variantId, ...(l.bundle?.map((c) => c.variantId) ?? [])]))];
  const [variants, promotions, settings, trade, preorders, subPct] = await Promise.all([
    ids.length ? db.productVariant.findMany({ where: { id: { in: ids } }, select: { id: true, price: true, compareAtPrice: true, product: { select: { id: true, categoryId: true, isGiftCard: true } } } }) : [],
    opts.promotions ?? (lines.length ? livePromotions(now) : Promise.resolve([] as PromoDef[])),
    opts.settings ?? getPromotionSettings(),
    isTradeBuyer(opts.userId),
    activePreorders(lines.map((l) => l.variantId)),
    lines.some((l) => l.subscription) ? subscribePercent() : Promise.resolve(null),
  ]);
  const byId = new Map(variants.map((v) => [v.id, v]));

  const known = lines.filter((l) => byId.has(l.variantId));
  const base = known.map((l) => {
    const v = byId.get(l.variantId)!;
    const bundle = l.bundle?.length ? l.bundle.map((c) => byId.get(c.variantId)?.price ?? c.price) : null;
    const sub = l.subscription && subPct !== null && !bundle && !v.product.isGiftCard ? subPct : null;
    const list = bundle ? coffretPrice(bundle) : sub !== null ? Math.round((v.price * (100 - sub)) / 100) : v.price;
    return { l, v, list, bundle: Boolean(bundle), sub };
  });
  const promoLines: PromoLine[] = base.map(({ l, v, list, bundle, sub }) => ({
    id: l.id,
    productId: v.product.id,
    categoryId: v.product.categoryId,
    listPrice: list,
    quantity: l.quantity,
    excluded: v.product.isGiftCard || bundle,
    subscription: sub !== null,
  }));
  const result = evaluatePromotions({ lines: promoLines, promotions, ctx: { now, trade, maxDiscountPercent: settings.maxDiscountPercent } });

  const priced: CartLine[] = base.map(({ l, v, list, bundle, sub }, i) => {
    const r = result.lines[i];
    const pre = preorders.get(l.variantId);
    const preorderOk = pre && !bundle && !v.product.isGiftCard;
    return {
      ...l,
      productId: v.product.id,
      unitPrice: r.unitPrice,
      compareAtPrice: r.sale ? list : bundle ? null : sub ? v.price : v.compareAtPrice,
      subscription: sub !== null && l.subscription ? { ...l.subscription, discountPercent: sub } : null,
      sale: r.sale ? { promotionId: r.sale.promotionId, name: r.sale.badge || r.sale.name, endsAt: r.sale.endsAt?.toISOString() ?? null } : null,
      preorder: preorderOk ? { shipDate: pre.shipDate.toISOString() } : null,
      available: preorderOk ? pre.remaining : l.available,
    };
  });
  return { lines: priced, result };
}

/** Rows for OrderPromotion (usage + attributed revenue), written in the placement transaction. */
export async function recordOrderPromotions(tx: Prisma.TransactionClient, orderId: string, result: PromoResult) {
  if (!result.applied.length) return;
  await tx.orderPromotion.createMany({
    data: result.applied.map((a) => ({ orderId, promotionId: a.promotionId, name: a.name, type: a.type, discount: a.discount, revenue: a.revenue })),
    skipDuplicates: true,
  });
}

/** Uses / discount / revenue per promotion over orders that count (not cancelled, refunded or still awaiting payment). */
export async function promotionStats(): Promise<Map<string, { uses: number; discount: number; revenue: number }>> {
  const rows = await db.$queryRaw<{ promotionId: string; uses: number; discount: number; revenue: number }[]>`
    SELECT op."promotionId", count(*)::int AS uses, coalesce(sum(op.discount), 0)::int AS discount, coalesce(sum(op.revenue), 0)::int AS revenue
    FROM "OrderPromotion" op JOIN "Order" o ON o.id = op."orderId"
    WHERE o.status NOT IN ('CANCELLED', 'REFUNDED') AND NOT (o.status = 'PENDING' AND o."reservedUntil" IS NOT NULL)
    GROUP BY op."promotionId"`;
  return new Map(rows.map((r) => [r.promotionId, { uses: r.uses, discount: r.discount, revenue: r.revenue }]));
}

/** What the storefront needs to show sale prices, countdowns and pre-order buttons on cards and product pages. */
export type StorefrontPromos = {
  serverNow: number;
  maxDiscountPercent: number;
  sales: StorefrontSale[];
  preorders: Record<string, { shipDate: string; remaining: number }>;
};

export async function storefrontPromos(now = new Date()): Promise<StorefrontPromos> {
  const [promotions, settings, preorders] = await Promise.all([livePromotions(now), getPromotionSettings(), activePreorders()]);
  const sales = promotions.filter((p): p is PromoDef & { type: "FLASH_SALE" } => p.type === "FLASH_SALE");
  const catIds = [...new Set(sales.flatMap((s) => s.categoryIds))];
  const cats = catIds.length ? await db.category.findMany({ where: { id: { in: catIds } }, select: { id: true, slug: true } }) : [];
  const slugOf = new Map(cats.map((c) => [c.id, c.slug]));
  return {
    serverNow: now.getTime(),
    maxDiscountPercent: settings.maxDiscountPercent,
    sales: sales.map((s) => ({
      id: s.id,
      name: s.name,
      badge: s.badge,
      kind: s.config.kind,
      value: s.config.value,
      priority: s.priority,
      startsAt: s.startsAt?.toISOString() ?? null,
      endsAt: s.endsAt?.toISOString() ?? null,
      productIds: s.productIds,
      // Cards know their category by slug; ids are kept too so either matches.
      categoryKeys: s.categoryIds.flatMap((id) => [id, slugOf.get(id) ?? id]),
    })),
    preorders: Object.fromEntries([...preorders.values()].map((p) => [p.variantId, { shipDate: p.shipDate.toISOString(), remaining: p.remaining }])),
  };
}

/** Product ids on a live flash sale (the "Sale" page). A sale with no targets covers everything. */
export async function saleProductWhere(now = new Date()): Promise<Prisma.ProductWhereInput | null> {
  const sales = (await livePromotions(now)).filter((p) => p.type === "FLASH_SALE");
  if (!sales.length) return null;
  if (sales.some((s) => !s.productIds.length && !s.categoryIds.length)) return { isActive: true, isGiftCard: false };
  return {
    isActive: true,
    isGiftCard: false,
    OR: [{ id: { in: [...new Set(sales.flatMap((s) => s.productIds))] } }, { categoryId: { in: [...new Set(sales.flatMap((s) => s.categoryIds))] } }],
  };
}

/** Product names for nudges ("add Rose Attar to get it free"). */
export async function productNames(ids: string[]) {
  if (!ids.length) return {} as Record<string, string>;
  const rows = await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return Object.fromEntries(rows.map((r) => [r.id, r.name])) as Record<string, string>;
}

/** Bag summary for the drawer / bag page: applied promotions, nudges and tier progress. */
export function bagPromoView(result: PromoResult, names: Record<string, string>) {
  return {
    applied: result.applied.map((a) => ({ id: a.promotionId, name: a.badge || a.name, type: a.type, discount: a.discount })),
    promoDiscount: result.promoDiscount,
    saleSavings: result.saleSavings,
    tier: result.tier,
    nudges: result.nudges.map((n) =>
      n.kind === "BUY_X_GET_Y"
        ? { ...n, products: n.getProductIds.map((id) => names[id]).filter(Boolean) }
        : n.kind === "FIXED_BUNDLE"
          ? { ...n, products: n.missing.map((m) => names[m.productId]).filter(Boolean) }
          : { ...n, products: [] as string[] },
    ),
  };
}
export type BagPromoView = ReturnType<typeof bagPromoView>;

export async function bagPromotions(result: PromoResult) {
  const ids = result.nudges.flatMap((n) => (n.kind === "BUY_X_GET_Y" ? n.getProductIds : n.kind === "FIXED_BUNDLE" ? n.missing.map((m) => m.productId) : []));
  return bagPromoView(result, await productNames([...new Set(ids)]));
}
