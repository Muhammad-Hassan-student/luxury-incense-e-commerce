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
