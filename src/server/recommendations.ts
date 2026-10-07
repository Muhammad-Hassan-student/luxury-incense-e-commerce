import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { db } from "./db";
import { productCardSelect, type ProductCardData } from "./catalog";

// "Frequently bought together": products that share kept orders (confirmed/paid onward; not refunded, cancelled or exchange replacements)
// with the product over the last year. Thin data is topped up with best-sellers from the same category or scent family.
// The ranking (ids only) is cached for an hour; stock and visibility are re-checked on every render.

export const PAIR_WINDOW_DAYS = 365;
/** A pairing needs this many shared orders before it beats the best-seller fallback. */
export const MIN_SHARED_ORDERS = 2;
export const RECOMMENDATIONS_TAG = "recommendations";

export type Ranked = { id: string; score: number; reason: "pair" | "bestseller" };

/** Ranked candidate product ids (uncached; includes items that may be out of stock — filter with `pickAvailable`). */
export async function rankRecommendations(productId: string, now = new Date(), take = 24): Promise<Ranked[]> {
  const since = new Date(now.getTime() - PAIR_WINDOW_DAYS * 86_400_000).toISOString();
  const pairs = await db.$queryRaw<{ id: string; shared: number }[]>`
    WITH base AS (
      SELECT DISTINCT oi."orderId" FROM "OrderItem" oi
      JOIN "ProductVariant" v ON v.id = oi."variantId"
      JOIN "Order" o ON o.id = oi."orderId"
      WHERE v."productId" = ${productId}
        AND (o.status IN ('PAID', 'PACKED', 'SHIPPED', 'DELIVERED') OR (o.status = 'PENDING' AND o."reservedUntil" IS NULL))
        AND NOT EXISTS (SELECT 1 FROM "ReturnRequest" rr WHERE rr."exchangeOrderId" = o.id)
        AND o."placedAt" >= (${since}::timestamptz AT TIME ZONE 'UTC'))
    SELECT v."productId" AS id, COUNT(DISTINCT oi."orderId")::int AS shared
    FROM "OrderItem" oi
    JOIN base b ON b."orderId" = oi."orderId"
    JOIN "ProductVariant" v ON v.id = oi."variantId"
    WHERE v."productId" <> ${productId}
    GROUP BY 1 HAVING COUNT(DISTINCT oi."orderId") >= ${MIN_SHARED_ORDERS}
    ORDER BY shared DESC, id ASC LIMIT ${take}`;

  // Fallback: same category or same scent family, by units sold in the window, then the best-seller flag and reviews.
  const fallback = await db.$queryRaw<{ id: string; units: number }[]>`
    WITH me AS (SELECT "categoryId", family FROM "Product" WHERE id = ${productId})
    SELECT p.id, COALESCE(s.units, 0)::int AS units
    FROM "Product" p
    CROSS JOIN me
    LEFT JOIN (
      SELECT v."productId" AS id, SUM(oi.quantity) AS units FROM "OrderItem" oi
      JOIN "ProductVariant" v ON v.id = oi."variantId"
      JOIN "Order" o ON o.id = oi."orderId"
      WHERE (o.status IN ('PAID', 'PACKED', 'SHIPPED', 'DELIVERED') OR (o.status = 'PENDING' AND o."reservedUntil" IS NULL))
        AND NOT EXISTS (SELECT 1 FROM "ReturnRequest" rr WHERE rr."exchangeOrderId" = o.id)
        AND o."placedAt" >= (${since}::timestamptz AT TIME ZONE 'UTC')
      GROUP BY 1
    ) s ON s.id = p.id
    WHERE p.id <> ${productId} AND p."isActive" AND NOT p."isGiftCard"
      AND (p."categoryId" = me."categoryId" OR p.family = me.family)
    ORDER BY (p."categoryId" = me."categoryId") DESC, units DESC, p."isBestseller" DESC, p."ratingCount" DESC, p.id ASC
    LIMIT ${take}`;

  const out: Ranked[] = pairs.map((p) => ({ id: p.id, score: p.shared, reason: "pair" }));
  const seen = new Set(out.map((r) => r.id));
  for (const f of fallback) if (!seen.has(f.id)) out.push({ id: f.id, score: 0, reason: "bestseller" });
  return out.slice(0, take);
}

/** Keeps active, non-gift-card products with at least one variant in stock, in ranked order. */
export async function pickAvailable(ranked: Ranked[], limit: number, exclude: string[] = []): Promise<ProductCardData[]> {
  const ids = ranked.map((r) => r.id).filter((id) => !exclude.includes(id));
  if (!ids.length) return [];
  const rows = await db.product.findMany({ where: { id: { in: ids }, isActive: true, isGiftCard: false }, select: productCardSelect });
  const byId = new Map(rows.filter((p) => p.variants.some((v) => v.stock - v.reserved > 0)).map((p) => [p.id, p]));
  return ids.flatMap((id) => byId.get(id) ?? []).slice(0, limit);
}

const rankedCached = unstable_cache(async (productId: string) => rankRecommendations(productId), ["recommendations-v1"], {
  revalidate: 3600,
  tags: [RECOMMENDATIONS_TAG],
});

/** "Pairs beautifully with" for a product page. */
export const pairsWith = cache(async (productId: string, limit = 4) => pickAvailable(await rankedCached(productId), limit, [productId]));

/** "You may also like" for the bag: pairings of what's in it, never what's already there. */
export async function alsoLikeForCart(productIds: string[], limit = 2): Promise<ProductCardData[]> {
  const unique = [...new Set(productIds)].slice(0, 4);
  if (!unique.length) return [];
  const lists = await Promise.all(unique.map((id) => rankedCached(id)));
  // Interleave so each bag item contributes, best pairing first.
  const merged = new Map<string, Ranked>();
  for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++) {
    for (const l of lists) {
      const r = l[i];
      if (r && !merged.has(r.id)) merged.set(r.id, r);
    }
  }
  const ranked = [...merged.values()].sort((a, b) => (a.reason === b.reason ? 0 : a.reason === "pair" ? -1 : 1));
  return pickAvailable(ranked, limit, unique);
}
