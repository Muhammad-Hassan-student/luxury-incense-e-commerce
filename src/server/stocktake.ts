import "server-only";
import type { Prisma, StockTakeStatus } from "@/generated/prisma/client";
import { db } from "./db";
import { applyStocktakeDelta } from "./inventory";
import { lockStock, onHandIn } from "./warehouse-stock";

type Tx = Prisma.TransactionClient;

export class StockTakeError extends Error {}

export type StockTakeScope = { kind: "all" } | { kind: "category"; categoryId: string } | { kind: "supplier"; supplierId: string };

/**
 * Opens a stocktake and snapshots `expected` = current stock for every variant in scope. With `warehouseId` it counts
 * one warehouse (expected = that warehouse's on-hand); without, the store-wide totals as before.
 */
export async function createStockTake(input: { name: string; note?: string | null; scope: StockTakeScope; actorId: string; warehouseId?: string | null }) {
  const where: Prisma.ProductVariantWhereInput = { product: { isGiftCard: false } };
  if (input.scope.kind === "category") where.product = { isGiftCard: false, categoryId: input.scope.categoryId };
  if (input.scope.kind === "supplier") where.supplierId = input.scope.supplierId;

  return db.$transaction(async (tx) => {
    const variants = await tx.productVariant.findMany({ where, select: { id: true, stock: true } });
    if (!variants.length) throw new StockTakeError("No variants match that scope.");
    if (input.warehouseId) {
      await lockStock(tx, variants.map((v) => v.id));
      for (const v of variants) v.stock = (await onHandIn(tx, input.warehouseId, v.id)).stock;
    }
    const take = await tx.stockTake.create({
      data: { name: input.name, note: input.note || null, createdById: input.actorId, warehouseId: input.warehouseId ?? null },
      select: { id: true, name: true },
    });
    await tx.stockTakeLine.createMany({ data: variants.map((v) => ({ stockTakeId: take.id, variantId: v.id, expected: v.stock })) });
    return { ...take, lines: variants.length };
  });
}

async function lockTake(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string; name: string; status: StockTakeStatus }[]>`
    SELECT id, name, status FROM "StockTake" WHERE id = ${id} FOR UPDATE`;
  const t = rows[0];
  if (!t) throw new StockTakeError("Stocktake not found.");
  return t;
}

async function requireOpen(tx: Tx, id: string) {
  const t = await lockTake(tx, id);
  if (t.status !== "OPEN") throw new StockTakeError(`This stocktake is ${t.status.toLowerCase()} and read-only.`);
  return t;
}

/** Saves counts (null clears a count). Lines must belong to the stocktake. */
export async function saveCounts(stockTakeId: string, counts: { lineId: string; counted: number | null }[]) {
  return db.$transaction(async (tx) => {
    const t = await requireOpen(tx, stockTakeId);
    for (const c of counts) {
      const res = await tx.stockTakeLine.updateMany({ where: { id: c.lineId, stockTakeId }, data: { counted: c.counted } });
      if (!res.count) throw new StockTakeError("A line doesn't belong to this stocktake.");
    }
    return { name: t.name, saved: counts.length };
  });
}

export type Drift = { variantId: string; sku: string; expected: number; current: number };

/** Counted lines whose stock has moved since the snapshot (sales, receipts…). */
export async function stockTakeDrift(stockTakeId: string, client: Tx | typeof db = db): Promise<Drift[]> {
  const lines = await client.stockTakeLine.findMany({
    where: { stockTakeId, counted: { not: null } },
    select: { variantId: true, expected: true, variant: { select: { sku: true, stock: true } } },
  });
  const take = await client.stockTake.findUnique({ where: { id: stockTakeId }, select: { warehouseId: true } });
  const current = async (l: (typeof lines)[number]) => (take?.warehouseId ? (await onHandIn(client, take.warehouseId, l.variantId)).stock : l.variant.stock);
  const out: Drift[] = [];
  for (const l of lines) {
    const now = await current(l);
    if (now !== l.expected) out.push({ variantId: l.variantId, sku: l.variant.sku, expected: l.expected, current: now });
  }
  return out;
}

/**
 * Applies counted − expected (variance against the snapshot) to *current* stock as STOCKTAKE movements, for counted lines only.
 * If stock moved since the snapshot the caller must pass `acknowledgeDrift`, otherwise StockTakeError is thrown with the details.
 */
export async function completeStockTake(stockTakeId: string, opts: { actorId: string; acknowledgeDrift?: boolean }) {
  return db.$transaction(async (tx) => {
    const t = await requireOpen(tx, stockTakeId);
    const lines = await tx.stockTakeLine.findMany({
      where: { stockTakeId, counted: { not: null } },
      select: { variantId: true, expected: true, counted: true, variant: { select: { sku: true, costPrice: true } } },
    });
    if (!lines.length) throw new StockTakeError("Count at least one line before completing.");
    const warehouseId = (await tx.stockTake.findUnique({ where: { id: stockTakeId }, select: { warehouseId: true } }))?.warehouseId ?? null;
    if (warehouseId) await lockStock(tx, lines.map((l) => l.variantId));
    const drift = await stockTakeDrift(stockTakeId, tx);
    if (drift.length && !opts.acknowledgeDrift) {
      throw new StockTakeError(`Stock moved on ${drift.length} counted line${drift.length === 1 ? "" : "s"} since the snapshot. Confirm to apply the variance to current stock.`);
    }
    const applied: { sku: string; variance: number; before: number; after: number }[] = [];
    let units = 0;
    let value = 0;
    for (const l of lines) {
      const variance = (l.counted ?? 0) - l.expected;
      if (variance === 0) continue;
      const r = await applyStocktakeDelta(tx, l.variantId, variance, opts.actorId, warehouseId);
      applied.push({ sku: l.variant.sku, variance, before: r.before, after: r.after });
      units += variance;
      value += variance * (l.variant.costPrice ?? 0);
    }
    await tx.stockTake.update({ where: { id: stockTakeId }, data: { status: "COMPLETED", completedAt: new Date() } });
    return { name: t.name, counted: lines.length, adjusted: applied.length, units, value, applied, drifted: drift.length };
  });
}

export async function cancelStockTake(stockTakeId: string) {
  return db.$transaction(async (tx) => {
    const t = await requireOpen(tx, stockTakeId);
    await tx.stockTake.update({ where: { id: stockTakeId }, data: { status: "CANCELLED" } });
    return t;
  });
}
