import "server-only";
import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

export class OutOfStockError extends Error {
  constructor(public variantId: string) {
    super("OUT_OF_STOCK");
  }
}

/** Atomically hold stock for a pending order. Throws OutOfStockError if not enough is free. */
export async function reserve(tx: Tx, variantId: string, qty: number, orderId: string) {
  const n = await tx.$executeRaw`
    UPDATE "ProductVariant" SET reserved = reserved + ${qty}
    WHERE id = ${variantId} AND stock - reserved >= ${qty}`;
  if (n !== 1) throw new OutOfStockError(variantId);
  await tx.inventoryLog.create({ data: { variantId, delta: 0, reason: "RESERVE", orderId } });
}

/** Give held stock back (payment failed / reservation expired / order cancelled before payment). */
export async function release(tx: Tx, variantId: string, qty: number, orderId: string) {
  await tx.$executeRaw`
    UPDATE "ProductVariant" SET reserved = GREATEST(0, reserved - ${qty}) WHERE id = ${variantId}`;
  await tx.inventoryLog.create({ data: { variantId, delta: 0, reason: "RELEASE", orderId } });
}

/** Turn a hold into a sale: stock and reserved both drop. */
export async function commitSale(tx: Tx, variantId: string, qty: number, orderId: string) {
  await tx.$executeRaw`
    UPDATE "ProductVariant"
    SET stock = GREATEST(0, stock - ${qty}), reserved = GREATEST(0, reserved - ${qty})
    WHERE id = ${variantId}`;
  await tx.inventoryLog.create({ data: { variantId, delta: -qty, reason: "SALE", orderId } });
}

export async function adjustStock(
  tx: Tx,
  variantId: string,
  delta: number,
  reason: "RESTOCK" | "ADJUST" | "RETURN",
  actorId?: string,
  orderId?: string,
) {
  await tx.$executeRaw`UPDATE "ProductVariant" SET stock = GREATEST(0, stock + ${delta}) WHERE id = ${variantId}`;
  await tx.inventoryLog.create({ data: { variantId, delta, reason, actorId, orderId } });
}

/** Expand an order's lines into the concrete variants whose stock moves (coffrets move their pieces too). */
export function stockMoves(items: { variantId: string | null; quantity: number; bundle?: string[] | null }[]) {
  const moves = new Map<string, number>();
  for (const i of items) {
    if (i.variantId) moves.set(i.variantId, (moves.get(i.variantId) ?? 0) + i.quantity);
    for (const c of i.bundle ?? []) moves.set(c, (moves.get(c) ?? 0) + i.quantity);
  }
  return [...moves.entries()].map(([variantId, qty]) => ({ variantId, qty }));
}

/** Movement reasons added by purchasing and stocktakes (alongside RESERVE/RELEASE/SALE/RESTOCK/ADJUST/RETURN). */
export type StockControlReason = "PO_RECEIVE" | "STOCKTAKE";

export const MOVEMENT_REASONS = ["RESERVE", "RELEASE", "SALE", "RESTOCK", "ADJUST", "RETURN", "PO_RECEIVE", "STOCKTAKE"] as const;

/**
 * Weighted average unit cost after receiving `qty` units at `unitCost` on top of `oldStock` units at `oldCost`.
 * A variant with no known cost (or no stock) simply takes the new cost.
 */
export function weightedAverageCost(oldStock: number, oldCost: number | null, qty: number, unitCost: number) {
  const base = Math.max(0, oldStock);
  if (oldCost === null || base === 0) return unitCost;
  if (base + qty <= 0) return oldCost;
  return Math.round((base * oldCost + qty * unitCost) / (base + qty));
}

/**
 * Receive purchased stock: locks the variant row, re-averages its cost price, adds the units and logs a PO_RECEIVE movement.
 * Must run inside a transaction. Returns the before/after figures for auditing.
 */
export async function receiveStock(tx: Tx, variantId: string, qty: number, unitCost: number, actorId?: string) {
  if (!Number.isInteger(qty) || qty <= 0) throw new Error("receiveStock: quantity must be a positive integer");
  const rows = await tx.$queryRaw<{ stock: number; costPrice: number | null }[]>`
    SELECT stock, "costPrice" FROM "ProductVariant" WHERE id = ${variantId} FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new Error(`receiveStock: variant ${variantId} not found`);
  const costPrice = weightedAverageCost(row.stock, row.costPrice, qty, unitCost);
  await tx.$executeRaw`UPDATE "ProductVariant" SET stock = stock + ${qty}, "costPrice" = ${costPrice} WHERE id = ${variantId}`;
  await tx.inventoryLog.create({ data: { variantId, delta: qty, reason: "PO_RECEIVE", actorId } });
  return { stockBefore: row.stock, stockAfter: row.stock + qty, costBefore: row.costPrice, costAfter: costPrice };
}

/** Apply a stocktake correction against current stock (floored at 0) and log it. Returns the delta actually applied. */
export async function applyStocktakeDelta(tx: Tx, variantId: string, delta: number, actorId?: string) {
  const rows = await tx.$queryRaw<{ stock: number }[]>`SELECT stock FROM "ProductVariant" WHERE id = ${variantId} FOR UPDATE`;
  const before = rows[0]?.stock;
  if (before === undefined) throw new Error(`applyStocktakeDelta: variant ${variantId} not found`);
  await tx.$executeRaw`UPDATE "ProductVariant" SET stock = GREATEST(0, stock + ${delta}) WHERE id = ${variantId}`;
  const applied = Math.max(0, before + delta) - before;
  await tx.inventoryLog.create({ data: { variantId, delta: applied, reason: "STOCKTAKE", actorId } });
  return { before, after: before + applied, applied };
}
