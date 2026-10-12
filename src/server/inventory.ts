import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { changeUnits, commitUnits, lockStock, onHandIn, releaseUnits, reserveForOrder, reserveUnits } from "./warehouse-stock";

type Tx = Prisma.TransactionClient;

// Multi-warehouse: every function below keeps its old signature and store-wide behaviour (ProductVariant.stock /
// .reserved are still the totals) while booking the units in a warehouse — see src/server/warehouse-stock.ts.

export class OutOfStockError extends Error {
  constructor(public variantId: string) {
    super("OUT_OF_STOCK");
  }
}

/** Atomically hold stock for a pending order. Throws OutOfStockError if not enough is free. */
export async function reserve(tx: Tx, variantId: string, qty: number, orderId: string) {
  if (!(await reserveUnits(tx, variantId, qty, orderId))) throw new OutOfStockError(variantId);
}

/**
 * Hold a whole order's stock at once, choosing warehouses with the allocation rules (one warehouse when possible,
 * nearest to the delivery pincode, then priority; otherwise split). Throws OutOfStockError if anything is short.
 */
export async function reserveOrder(tx: Tx, orderId: string, moves: { variantId: string; qty: number }[], destPincode?: string | null) {
  if (!moves.length) return;
  const r = await reserveForOrder(tx, orderId, moves, destPincode);
  if (!r.ok) throw new OutOfStockError(r.variantId);
}

/** Give held stock back (payment failed / reservation expired / order cancelled before payment). */
export async function release(tx: Tx, variantId: string, qty: number, orderId: string) {
  await releaseUnits(tx, variantId, qty, orderId);
}

/** Turn a hold into a sale: stock and reserved both drop. */
export async function commitSale(tx: Tx, variantId: string, qty: number, orderId: string) {
  await commitUnits(tx, variantId, qty, orderId);
}

/** Returns go back to the warehouse they were sold from; restocks/adjustments to `warehouseId` or the default. */
export async function adjustStock(
  tx: Tx,
  variantId: string,
  delta: number,
  reason: "RESTOCK" | "ADJUST" | "RETURN",
  actorId?: string,
  orderId?: string,
  warehouseId?: string | null,
) {
  await changeUnits(tx, variantId, delta, reason, { actorId, orderId, warehouseId });
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

export const MOVEMENT_REASONS = ["RESERVE", "RELEASE", "SALE", "RESTOCK", "ADJUST", "RETURN", "PO_RECEIVE", "STOCKTAKE", "TRANSFER_OUT", "TRANSFER_IN"] as const;

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
export async function receiveStock(tx: Tx, variantId: string, qty: number, unitCost: number, actorId?: string, warehouseId?: string | null) {
  if (!Number.isInteger(qty) || qty <= 0) throw new Error("receiveStock: quantity must be a positive integer");
  await lockStock(tx, [variantId]);
  const rows = await tx.$queryRaw<{ stock: number; costPrice: number | null }[]>`
    SELECT stock, "costPrice" FROM "ProductVariant" WHERE id = ${variantId}`;
  const row = rows[0];
  if (!row) throw new Error(`receiveStock: variant ${variantId} not found`);
  // Cost is averaged over the whole store's stock (one cost price per variant).
  const costPrice = weightedAverageCost(row.stock, row.costPrice, qty, unitCost);
  await tx.$executeRaw`UPDATE "ProductVariant" SET "costPrice" = ${costPrice} WHERE id = ${variantId}`;
  await changeUnits(tx, variantId, qty, "PO_RECEIVE", { actorId, warehouseId });
  return { stockBefore: row.stock, stockAfter: row.stock + qty, costBefore: row.costPrice, costAfter: costPrice };
}

/**
 * Apply a stocktake correction (floored at 0) and log it. With `warehouseId` it counts that warehouse only; without,
 * it corrects the store-wide total as before. Returns the delta actually applied.
 */
export async function applyStocktakeDelta(tx: Tx, variantId: string, delta: number, actorId?: string, warehouseId?: string | null) {
  const locked = await lockStock(tx, [variantId]);
  const total = locked.get(variantId);
  if (!total) throw new Error(`applyStocktakeDelta: variant ${variantId} not found`);
  const before = warehouseId ? (await onHandIn(tx, warehouseId, variantId)).stock : total.stock;
  const moved = await changeUnits(tx, variantId, delta, "STOCKTAKE", { actorId, warehouseId });
  const applied = [...moved.values()].reduce((n, x) => n + x, 0);
  return { before, after: before + applied, applied };
}
