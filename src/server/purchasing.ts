import "server-only";
import type { Prisma, PurchaseOrderStatus } from "@/generated/prisma/client";
import { db } from "./db";
import { receiveStock } from "./inventory";
import { getSettings } from "./settings";

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof db;

/** Business-rule failure with a message safe to show to staff. */
export class PurchasingError extends Error {}

export const OPEN_PO_STATUSES: PurchaseOrderStatus[] = ["ORDERED", "PARTIAL"];

// ─────────────────────────────── Lookups ───────────────────────────────

/** Units still to arrive per variant: Σ max(quantity − received, 0) over ORDERED/PARTIAL purchase orders. */
export async function onOrderByVariant(client: Client = db, variantIds?: string[]) {
  if (variantIds && !variantIds.length) return new Map<string, number>();
  const rows = await client.$queryRaw<{ variantId: string; qty: number }[]>`
    SELECT i."variantId", SUM(GREATEST(i.quantity - i.received, 0))::int AS qty
    FROM "PurchaseOrderItem" i JOIN "PurchaseOrder" po ON po.id = i."poId"
    WHERE po.status IN ('ORDERED', 'PARTIAL')
    GROUP BY i."variantId"`;
  const wanted = variantIds ? new Set(variantIds) : null;
  return new Map(rows.filter((r) => !wanted || wanted.has(r.variantId)).map((r) => [r.variantId, r.qty]));
}

/** Most recent unit cost paid per variant (from non-cancelled POs), falling back to the variant's cost price. */
export async function lastUnitCosts(variantIds: string[], client: Client = db) {
  const out = new Map<string, number>();
  if (!variantIds.length) return out;
  const items = await client.purchaseOrderItem.findMany({
    where: { variantId: { in: variantIds }, po: { status: { not: "CANCELLED" } } },
    orderBy: { po: { createdAt: "desc" } },
    select: { variantId: true, unitCost: true },
  });
  for (const i of items) if (!out.has(i.variantId)) out.set(i.variantId, i.unitCost);
  const missing = variantIds.filter((id) => !out.has(id));
  if (missing.length) {
    const vs = await client.productVariant.findMany({ where: { id: { in: missing } }, select: { id: true, costPrice: true } });
    for (const v of vs) if (v.costPrice !== null) out.set(v.id, v.costPrice);
  }
  return out;
}

/** Spend per supplier = Σ received × unit cost (what has actually arrived), optionally for one supplier. */
export async function supplierSpend(supplierId?: string, client: Client = db) {
  const rows = await client.$queryRaw<{ supplierId: string; spend: bigint }[]>`
    SELECT po."supplierId", SUM(i.received::bigint * i."unitCost") AS spend
    FROM "PurchaseOrderItem" i JOIN "PurchaseOrder" po ON po.id = i."poId"
    WHERE po.status <> 'CANCELLED' AND (${supplierId ?? null}::text IS NULL OR po."supplierId" = ${supplierId ?? null})
    GROUP BY po."supplierId"`;
  return new Map(rows.map((r) => [r.supplierId, Number(r.spend)]));
}

// ─────────────────────────────── Reorder maths ───────────────────────────────

/**
 * How many units to order for one variant, or 0 when no order is needed.
 * Triggered when available ≤ reorder point. Target is reorderQty, or (reorderPoint × 2 − available), at least 1.
 * Whatever is already on order counts towards the target.
 */
export function suggestReorder(v: { available: number; reorderPoint: number; reorderQty: number | null; onOrder: number }) {
  if (v.available > v.reorderPoint) return 0;
  const target = v.reorderQty && v.reorderQty > 0 ? v.reorderQty : Math.max(1, v.reorderPoint * 2 - v.available);
  return Math.max(0, target - Math.max(0, v.onOrder));
}

export type ReorderLine = {
  variantId: string;
  sku: string;
  product: string;
  label: string;
  available: number;
  reorderPoint: number;
  onOrder: number;
  suggested: number;
  unitCost: number | null;
};

export type ReorderGroup = { supplier: { id: string; name: string; isActive: boolean } | null; lines: ReorderLine[]; total: number };

/** Variants at/below their reorder point, net of what's on order, grouped by preferred supplier (null = no supplier). */
export async function reorderSuggestions(client: Client = db, opts: { threshold?: number } = {}): Promise<ReorderGroup[]> {
  const threshold = opts.threshold ?? (await getSettings()).lowStockThreshold;
  const variants = await client.productVariant.findMany({
    where: { product: { isGiftCard: false, isActive: true } },
    orderBy: [{ product: { name: "asc" } }, { position: "asc" }],
    select: {
      id: true,
      sku: true,
      label: true,
      stock: true,
      reserved: true,
      reorderPoint: true,
      reorderQty: true,
      product: { select: { name: true } },
      supplier: { select: { id: true, name: true, isActive: true } },
    },
  });
  const low = variants.filter((v) => v.stock - v.reserved <= (v.reorderPoint ?? threshold));
  const onOrder = await onOrderByVariant(client, low.map((v) => v.id));
  const costs = await lastUnitCosts(low.map((v) => v.id), client);

  const groups = new Map<string, ReorderGroup>();
  for (const v of low) {
    const available = v.stock - v.reserved;
    const reorderPoint = v.reorderPoint ?? threshold;
    const ordered = onOrder.get(v.id) ?? 0;
    const suggested = suggestReorder({ available, reorderPoint, reorderQty: v.reorderQty, onOrder: ordered });
    if (suggested <= 0) continue;
    const key = v.supplier?.id ?? "";
    const g = groups.get(key) ?? { supplier: v.supplier, lines: [], total: 0 };
    const unitCost = costs.get(v.id) ?? null;
    g.lines.push({ variantId: v.id, sku: v.sku, product: v.product.name, label: v.label, available, reorderPoint, onOrder: ordered, suggested, unitCost });
    g.total += suggested * (unitCost ?? 0);
    groups.set(key, g);
  }
  // Suppliers alphabetically, "no supplier" last.
  return [...groups.values()].sort((a, b) => (a.supplier ? (b.supplier ? a.supplier.name.localeCompare(b.supplier.name) : -1) : 1));
}

// ─────────────────────────────── PO numbering ───────────────────────────────

/** Next number for the year: "PO-" + 2-digit year + sequence (3+ digits), e.g. PO-26001. */
export async function nextPoNumber(client: Client = db, now = new Date()) {
  const prefix = `PO-${String(now.getFullYear() % 100).padStart(2, "0")}`;
  const start = prefix.length + 1;
  // Cast the bound offset: an untyped text parameter would select the regex form of SUBSTRING.
  const rows = await client.$queryRaw<{ seq: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING(number FROM ${start}::int) AS INTEGER))::int AS seq
    FROM "PurchaseOrder" WHERE number LIKE ${prefix + "%"} AND SUBSTRING(number FROM ${start}::int) ~ '^[0-9]+$'`;
  const seq = (rows[0]?.seq ?? 0) + 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

function isUnique(e: unknown) {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === "P2002";
}

// ─────────────────────────────── Drafts ───────────────────────────────

export type DraftLine = { variantId: string; quantity: number; unitCost?: number | null };

/** Fills in missing unit costs from the variant's cost price (or 0). */
async function withCosts(tx: Tx, lines: DraftLine[]) {
  const ids = [...new Set(lines.map((l) => l.variantId))];
  const variants = await tx.productVariant.findMany({ where: { id: { in: ids } }, select: { id: true, costPrice: true } });
  if (variants.length !== ids.length) throw new PurchasingError("One of the variants no longer exists.");
  const cost = new Map(variants.map((v) => [v.id, v.costPrice]));
  // Merge duplicates so (poId, variantId) stays unique.
  const merged = new Map<string, { variantId: string; quantity: number; unitCost: number }>();
  for (const l of lines) {
    const prev = merged.get(l.variantId);
    const unitCost = l.unitCost ?? prev?.unitCost ?? cost.get(l.variantId) ?? 0;
    merged.set(l.variantId, { variantId: l.variantId, quantity: (prev?.quantity ?? 0) + l.quantity, unitCost });
  }
  return [...merged.values()];
}

export async function createPurchaseOrder(input: {
  supplierId: string;
  actorId: string;
  lines?: DraftLine[];
  notes?: string | null;
  expectedAt?: Date | null;
}) {
  const supplier = await db.supplier.findUnique({ where: { id: input.supplierId }, select: { isActive: true } });
  if (!supplier) throw new PurchasingError("Supplier not found.");
  if (!supplier.isActive) throw new PurchasingError("That supplier is inactive.");
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        // Serialise numbering across concurrent drafts; released automatically at commit/rollback.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('PurchaseOrder.number'))`;
        const number = await nextPoNumber(tx);
        const items = await withCosts(tx, input.lines ?? []);
        return tx.purchaseOrder.create({
          data: {
            number,
            supplierId: input.supplierId,
            createdById: input.actorId,
            notes: input.notes || null,
            expectedAt: input.expectedAt ?? null,
            items: { create: items },
          },
          select: { id: true, number: true },
        });
      });
    } catch (e) {
      // Two drafts raced for the same number: try the next one.
      if (isUnique(e) && attempt < 5) {
        await new Promise((r) => setTimeout(r, 20 + Math.random() * 80));
        continue;
      }
      throw e;
    }
  }
  throw new PurchasingError("Couldn't allocate a PO number. Please try again.");
}

/** Draft PO for one supplier from the current reorder suggestions. */
export async function createDraftFromSuggestions(supplierId: string, actorId: string) {
  const groups = await reorderSuggestions();
  const group = groups.find((g) => g.supplier?.id === supplierId);
  if (!group?.lines.length) throw new PurchasingError("Nothing to reorder from this supplier right now.");
  const po = await createPurchaseOrder({
    supplierId,
    actorId,
    lines: group.lines.map((l) => ({ variantId: l.variantId, quantity: l.suggested, unitCost: l.unitCost })),
    notes: "Created from reorder suggestions.",
  });
  return { ...po, lines: group.lines.length };
}

/** Locks the PO row for the rest of the transaction and returns its status. */
async function lockPo(tx: Tx, poId: string) {
  const rows = await tx.$queryRaw<{ id: string; number: string; status: PurchaseOrderStatus }[]>`
    SELECT id, number, status FROM "PurchaseOrder" WHERE id = ${poId} FOR UPDATE`;
  const po = rows[0];
  if (!po) throw new PurchasingError("Purchase order not found.");
  return po;
}

async function requireDraft(tx: Tx, poId: string) {
  const po = await lockPo(tx, poId);
  if (po.status !== "DRAFT") throw new PurchasingError(`${po.number} is ${po.status.toLowerCase()}; its lines are locked.`);
  return po;
}

export async function addPoLines(poId: string, lines: DraftLine[]) {
  if (!lines.length) throw new PurchasingError("Add at least one line.");
  return db.$transaction(async (tx) => {
    const po = await requireDraft(tx, poId);
    const items = await withCosts(tx, lines);
    for (const l of items) {
      const existing = await tx.purchaseOrderItem.findUnique({ where: { poId_variantId: { poId, variantId: l.variantId } } });
      if (existing) {
        const explicit = lines.find((x) => x.variantId === l.variantId)?.unitCost;
        await tx.purchaseOrderItem.update({
          where: { id: existing.id },
          data: { quantity: existing.quantity + l.quantity, unitCost: explicit ?? existing.unitCost },
        });
      } else {
        await tx.purchaseOrderItem.create({ data: { poId, ...l } });
      }
    }
    return po;
  });
}

export async function updatePoLine(itemId: string, data: { quantity: number; unitCost: number }) {
  return db.$transaction(async (tx) => {
    const item = await tx.purchaseOrderItem.findUnique({ where: { id: itemId }, select: { poId: true } });
    if (!item) throw new PurchasingError("Line not found.");
    const po = await requireDraft(tx, item.poId);
    await tx.purchaseOrderItem.update({ where: { id: itemId }, data });
    return po;
  });
}

export async function removePoLine(itemId: string) {
  return db.$transaction(async (tx) => {
    const item = await tx.purchaseOrderItem.findUnique({ where: { id: itemId }, select: { poId: true, variantId: true } });
    if (!item) throw new PurchasingError("Line not found.");
    const po = await requireDraft(tx, item.poId);
    await tx.purchaseOrderItem.delete({ where: { id: itemId } });
    return { ...po, variantId: item.variantId };
  });
}

export async function updatePoDetails(poId: string, data: { notes: string | null; expectedAt: Date | null }) {
  return db.$transaction(async (tx) => {
    const po = await lockPo(tx, poId);
    if (po.status === "CANCELLED" || po.status === "RECEIVED") throw new PurchasingError(`${po.number} is closed.`);
    await tx.purchaseOrder.update({ where: { id: poId }, data });
    return po;
  });
}

// ─────────────────────────────── Status flow ───────────────────────────────

export async function markOrdered(poId: string) {
  return db.$transaction(async (tx) => {
    const po = await requireDraft(tx, poId);
    const lines = await tx.purchaseOrderItem.count({ where: { poId, quantity: { gt: 0 } } });
    if (!lines) throw new PurchasingError("Add at least one line before ordering.");
    await tx.purchaseOrder.update({ where: { id: poId }, data: { status: "ORDERED", orderedAt: new Date() } });
    return po;
  });
}

export async function cancelPurchaseOrder(poId: string) {
  return db.$transaction(async (tx) => {
    const po = await lockPo(tx, poId);
    if (po.status !== "DRAFT" && po.status !== "ORDERED") {
      throw new PurchasingError(po.status === "PARTIAL" ? "Stock has already been received against this PO; it can't be cancelled." : `${po.number} is already ${po.status.toLowerCase()}.`);
    }
    await tx.purchaseOrder.update({ where: { id: poId }, data: { status: "CANCELLED" } });
    return po;
  });
}

export type Receipt = { itemId: string; quantity: number };

/**
 * Receive goods against an ORDERED/PARTIAL PO in one transaction: per line, adds stock (PO_RECEIVE movement),
 * re-averages cost price and bumps `received`; then moves the PO to PARTIAL or RECEIVED.
 * Receiving more than ordered requires `overReceive`.
 */
export async function receivePurchaseOrder(poId: string, receipts: Receipt[], opts: { actorId: string; overReceive?: boolean }) {
  const wanted = receipts.filter((r) => r.quantity > 0);
  if (!wanted.length) throw new PurchasingError("Enter a received quantity for at least one line.");
  if (wanted.some((r) => !Number.isInteger(r.quantity))) throw new PurchasingError("Received quantities must be whole units.");
  if (new Set(wanted.map((r) => r.itemId)).size !== wanted.length) throw new PurchasingError("Each line can only appear once.");

  return db.$transaction(async (tx) => {
    const po = await lockPo(tx, poId);
    if (po.status !== "ORDERED" && po.status !== "PARTIAL") {
      throw new PurchasingError(po.status === "DRAFT" ? "Mark the PO as ordered before receiving." : `${po.number} is ${po.status.toLowerCase()}.`);
    }
    const items = await tx.purchaseOrderItem.findMany({ where: { poId }, include: { variant: { select: { sku: true } } } });
    const byId = new Map(items.map((i) => [i.id, i]));
    const lines: { sku: string; quantity: number; unitCost: number; costBefore: number | null; costAfter: number }[] = [];
    for (const r of wanted) {
      const item = byId.get(r.itemId);
      if (!item) throw new PurchasingError("A line doesn't belong to this PO.");
      const outstanding = item.quantity - item.received;
      if (r.quantity > outstanding && !opts.overReceive) {
        throw new PurchasingError(`${item.variant.sku}: only ${Math.max(0, outstanding)} outstanding. Tick “over-receive” to accept more.`);
      }
      const moved = await receiveStock(tx, item.variantId, r.quantity, item.unitCost, opts.actorId);
      await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { received: { increment: r.quantity } } });
      item.received += r.quantity;
      lines.push({ sku: item.variant.sku, quantity: r.quantity, unitCost: item.unitCost, costBefore: moved.costBefore, costAfter: moved.costAfter });
    }
    const complete = items.every((i) => i.received >= i.quantity);
    const status: PurchaseOrderStatus = complete ? "RECEIVED" : "PARTIAL";
    await tx.purchaseOrder.update({ where: { id: poId }, data: { status, receivedAt: complete ? new Date() : null } });
    return { number: po.number, status, lines, units: lines.reduce((n, l) => n + l.quantity, 0) };
  });
}
