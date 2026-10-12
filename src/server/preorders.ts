import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { preorderOf, preorderPending } from "@/lib/preorder";
import { db } from "./db";
import { adjustStock } from "./inventory";

// Pre-orders: per-variant flag with expected ship date and optional cap. Pre-ordered units are counted in
// PreorderVariant.sold and never touch ProductVariant.stock/reserved until staff release them (see src/lib/preorder.ts).

type Tx = Prisma.TransactionClient;

export class PreorderFullError extends Error {
  constructor(public variantId: string) {
    super("PREORDER_FULL");
  }
}

/** When nothing caps a pre-order, the bag still limits a line to this many. */
export const PREORDER_UNCAPPED = 99;

export type PreorderInfo = { variantId: string; shipDate: Date; cap: number | null; sold: number; remaining: number };

const info = (p: { variantId: string; shipDate: Date; cap: number | null; sold: number }): PreorderInfo => ({
  variantId: p.variantId,
  shipDate: p.shipDate,
  cap: p.cap,
  sold: p.sold,
  remaining: p.cap == null ? PREORDER_UNCAPPED : Math.max(0, p.cap - p.sold),
});

/** Active pre-orders for these variants (or all of them). */
export async function activePreorders(variantIds?: string[], client: Tx | typeof db = db): Promise<Map<string, PreorderInfo>> {
  if (variantIds && !variantIds.length) return new Map();
  const rows = await client.preorderVariant.findMany({ where: { active: true, ...(variantIds ? { variantId: { in: variantIds } } : {}) } });
  return new Map(rows.map((r) => [r.variantId, info(r)]));
}

/** Takes `qty` units of the pre-order allocation, atomically against the cap. */
export async function allocatePreorder(tx: Tx, variantId: string, qty: number) {
  const n = await tx.$executeRaw`
    UPDATE "PreorderVariant" SET sold = sold + ${qty}, "updatedAt" = now()
    WHERE "variantId" = ${variantId} AND active = true AND (cap IS NULL OR sold + ${qty} <= cap)`;
  if (n !== 1) throw new PreorderFullError(variantId);
}

/** Gives back the allocation of unreleased pre-order lines (order cancelled / refunded before release). */
export async function releasePreorderAllocation(tx: Tx, items: { variantId: string | null; quantity: number; meta: Prisma.JsonValue | null }[]) {
  for (const i of items) {
    if (!i.variantId || !preorderPending(i.meta)) continue;
    await tx.$executeRaw`UPDATE "PreorderVariant" SET sold = GREATEST(0, sold - ${i.quantity}), "updatedAt" = now() WHERE "variantId" = ${i.variantId}`;
  }
}

/** Re-takes the allocation (payment landed after the hold expired). Ignores the cap: the customer already paid. */
export async function reclaimPreorderAllocation(tx: Tx, items: { variantId: string | null; quantity: number; meta: Prisma.JsonValue | null }[]) {
  for (const i of items) {
    if (!i.variantId || !preorderPending(i.meta)) continue;
    await tx.$executeRaw`UPDATE "PreorderVariant" SET sold = sold + ${i.quantity}, "updatedAt" = now() WHERE "variantId" = ${i.variantId}`;
  }
}

/** Orders holding unreleased pre-order units of a variant, oldest first (only confirmed, unshipped ones). */
export async function pendingPreorderLines(variantId: string) {
  const items = await db.orderItem.findMany({
    where: { variantId, order: { status: { in: ["PAID", "PACKED", "PENDING"] }, reservedUntil: null } },
    include: { order: { select: { id: true, number: true, status: true, codStatus: true, placedAt: true } } },
    orderBy: { order: { placedAt: "asc" } },
  });
  return items.filter((i) => preorderPending(i.meta));
}

/**
 * Stock has arrived: takes released units from on-hand stock, oldest order first, and lifts the fulfilment hold on
 * those lines. Stops at the first line that doesn't fit the free stock (FIFO is kept). Returns what it released.
 */
export async function releasePreorders(variantId: string, actorId: string | null, opts: { endPreorder?: boolean } = {}) {
  const lines = await pendingPreorderLines(variantId);
  const released: { orderNumber: string; quantity: number }[] = [];
  let blocked: string | null = null;
  for (const line of lines) {
    const ok = await db.$transaction(async (tx) => {
      // Lock the variant, check free stock, then take the units through the inventory module (warehouse-aware).
      const [v] = await tx.$queryRaw<{ stock: number; reserved: number }[]>`SELECT stock, reserved FROM "ProductVariant" WHERE id = ${variantId} FOR UPDATE`;
      if (!v || v.stock - v.reserved < line.quantity) return false;
      await adjustStock(tx, variantId, -line.quantity, "ADJUST", actorId ?? undefined, line.orderId);
      const meta = (line.meta && typeof line.meta === "object" && !Array.isArray(line.meta) ? line.meta : {}) as Record<string, unknown>;
      const pre = preorderOf(meta)!;
      await tx.orderItem.update({ where: { id: line.id }, data: { meta: { ...meta, preorder: { ...pre, releasedAt: new Date().toISOString() } } as Prisma.InputJsonValue } });
      await tx.$executeRaw`UPDATE "PreorderVariant" SET sold = GREATEST(0, sold - ${line.quantity}), "updatedAt" = now() WHERE "variantId" = ${variantId}`;
      await tx.orderEvent.create({ data: { orderId: line.orderId, status: line.order.status, message: `Pre-order released: ${line.quantity} × ${line.name} now in stock` } });
      return true;
    });
    if (!ok) {
      blocked = line.order.number;
      break;
    }
    released.push({ orderNumber: line.order.number, quantity: line.quantity });
  }
  if (opts.endPreorder && !blocked) await db.preorderVariant.updateMany({ where: { variantId }, data: { active: false } });
  return { released, blocked, remaining: lines.length - released.length };
}

/** Admin listing: every pre-order variant with product names and what's waiting. */
export async function preorderOverview() {
  const rows = await db.preorderVariant.findMany({ orderBy: [{ active: "desc" }, { shipDate: "asc" }] });
  const variants = await db.productVariant.findMany({
    where: { id: { in: rows.map((r) => r.variantId) } },
    select: { id: true, sku: true, label: true, stock: true, reserved: true, product: { select: { name: true } } },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  return rows.map((r) => ({ ...r, variant: byId.get(r.variantId) ?? null }));
}
