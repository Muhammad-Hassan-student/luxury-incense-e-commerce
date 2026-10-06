import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

/** Orders that count as revenue: paid-and-onward, plus confirmed cash-on-delivery (PENDING without a hold). */
export const revenueWhere: Prisma.OrderWhereInput = {
  OR: [{ status: { in: ["PAID", "PACKED", "SHIPPED", "DELIVERED"] } }, { status: "PENDING", reservedUntil: null }],
};

/** Orders staff need to act on: to pack (paid or confirmed COD) and to ship (packed). */
export const toPackWhere: Prisma.OrderWhereInput = {
  OR: [{ status: "PAID" }, { status: "PENDING", reservedUntil: null }],
};

/** Variants whose free stock is at or below the threshold. Column arithmetic, so raw SQL. */
export async function lowStockVariants(threshold: number, limit = 50) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "ProductVariant" WHERE stock - reserved <= ${threshold}
    ORDER BY stock - reserved ASC LIMIT ${limit}`;
  if (!rows.length) return [];
  const variants = await db.productVariant.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    select: { id: true, sku: true, label: true, stock: true, reserved: true, product: { select: { id: true, name: true, isActive: true } } },
  });
  return variants.sort((a, b) => a.stock - a.reserved - (b.stock - b.reserved));
}

export function parsePage(v: string | string[] | undefined) {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function param(v: string | string[] | undefined) {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}
