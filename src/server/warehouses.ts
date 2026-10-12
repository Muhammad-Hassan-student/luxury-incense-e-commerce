import "server-only";
import type { Prisma, TransferStatus } from "@/generated/prisma/client";
import { db } from "./db";
import { getSettings } from "./settings";
import { changeUnits, defaultWarehouseId, takeOut, warehouseBreakdown } from "./warehouse-stock";

/*
 * Warehouses (stock locations), inter-warehouse transfers and the per-warehouse views.
 * Units move through src/server/warehouse-stock.ts so the store-wide totals on ProductVariant always stay in step.
 */

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof db;

/** Business-rule failure with a message safe to show to staff. */
export class WarehouseError extends Error {}

// ─────────────────────────────── Warehouses ───────────────────────────────

export type WarehouseInput = {
  code: string;
  name: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  priority: number;
  pickupLocation: string;
  active: boolean;
};

/** Units held per warehouse (on hand / reserved / distinct variants with stock). */
async function unitTotals(client: Client = db) {
  const rows = await client.$queryRaw<{ warehouseId: string; stock: number; reserved: number; skus: number }[]>`
    SELECT "warehouseId", COALESCE(SUM(stock), 0)::int AS stock, COALESCE(SUM(reserved), 0)::int AS reserved,
           COUNT(*) FILTER (WHERE stock > 0)::int AS skus
    FROM "WarehouseStock" GROUP BY "warehouseId"`;
  return new Map(rows.map((r) => [r.warehouseId, r]));
}

export async function listWarehouses(opts: { activeOnly?: boolean } = {}) {
  await defaultWarehouseId(db);
  const [list, totals] = await Promise.all([
    db.warehouse.findMany({ where: opts.activeOnly ? { active: true } : undefined, orderBy: [{ isDefault: "desc" }, { priority: "asc" }, { code: "asc" }] }),
    unitTotals(),
  ]);
  return list.map((w) => ({ ...w, units: totals.get(w.id)?.stock ?? 0, reserved: totals.get(w.id)?.reserved ?? 0, skus: totals.get(w.id)?.skus ?? 0 }));
}

export async function createWarehouse(input: WarehouseInput) {
  const code = input.code.trim().toUpperCase();
  if (await db.warehouse.findUnique({ where: { code } })) throw new WarehouseError(`Code ${code} is already used.`);
  return db.warehouse.create({ data: { ...input, code, active: true } });
}

export async function updateWarehouse(id: string, input: WarehouseInput) {
  return db.$transaction(async (tx) => {
    const w = await tx.warehouse.findUnique({ where: { id } });
    if (!w) throw new WarehouseError("Warehouse not found.");
    const code = input.code.trim().toUpperCase();
    if (code !== w.code && (await tx.warehouse.findUnique({ where: { code } }))) throw new WarehouseError(`Code ${code} is already used.`);
    if (w.active && !input.active) {
      if (w.isDefault) throw new WarehouseError("The default warehouse can’t be deactivated — make another one the default first.");
      const t = (await unitTotals(tx)).get(id);
      if (t && (t.stock > 0 || t.reserved > 0)) {
        throw new WarehouseError(`${w.code} still holds ${t.stock} unit${t.stock === 1 ? "" : "s"}${t.reserved ? ` (${t.reserved} held for orders)` : ""}. Transfer it out before deactivating.`);
      }
      const inTransit = await tx.stockTransfer.count({ where: { status: { in: ["DRAFT", "IN_TRANSIT"] }, OR: [{ fromId: id }, { toId: id }] } });
      if (inTransit) throw new WarehouseError(`${w.code} has ${inTransit} open transfer${inTransit === 1 ? "" : "s"}. Receive or cancel them first.`);
    }
    return tx.warehouse.update({ where: { id }, data: { ...input, code } });
  });
}

/** Makes one active warehouse the default (exactly one at a time). */
export async function setDefaultWarehouse(id: string) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('Warehouse.default'))`;
    const w = await tx.warehouse.findUnique({ where: { id } });
    if (!w) throw new WarehouseError("Warehouse not found.");
    if (!w.active) throw new WarehouseError("Only an active warehouse can be the default.");
    await tx.warehouse.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
    return tx.warehouse.update({ where: { id }, data: { isDefault: true } });
  });
}

/** Low-stock level for one warehouse row: its own, else the variant's reorder point, else the store default. */
export const warehouseReorderPoint = (row: { reorderPoint: number | null } | undefined, variantReorderPoint: number | null, threshold: number) =>
  row?.reorderPoint ?? variantReorderPoint ?? threshold;

export async function setWarehouseReorderPoint(warehouseId: string, variantId: string, reorderPoint: number | null) {
  await db.$executeRaw`
    INSERT INTO "WarehouseStock" ("warehouseId", "variantId", "reorderPoint", "updatedAt") VALUES (${warehouseId}, ${variantId}, ${reorderPoint}, CURRENT_TIMESTAMP)
    ON CONFLICT ("warehouseId", "variantId") DO UPDATE SET "reorderPoint" = ${reorderPoint}, "updatedAt" = CURRENT_TIMESTAMP`;
}

/** Per-variant stock in one warehouse (with low-stock flags), for the warehouse page. */
export async function warehouseStockRows(warehouseId: string, opts: { q?: string; lowOnly?: boolean } = {}) {
  const { lowStockThreshold } = await getSettings();
  const contains = opts.q ? { contains: opts.q, mode: "insensitive" as const } : undefined;
  const variants = await db.productVariant.findMany({
    where: { product: { isGiftCard: false }, ...(contains ? { OR: [{ sku: contains }, { label: contains }, { product: { name: contains } }] } : {}) },
    orderBy: [{ product: { name: "asc" } }, { position: "asc" }],
    select: { id: true, sku: true, label: true, reorderPoint: true, product: { select: { name: true, isActive: true } } },
  });
  const split = await warehouseBreakdown(db, variants.map((v) => v.id));
  const rows = variants.map((v) => {
    const here = split.get(v.id)?.get(warehouseId);
    const stock = here?.stock ?? 0;
    const reserved = here?.reserved ?? 0;
    const reorderPoint = warehouseReorderPoint(here, v.reorderPoint, lowStockThreshold);
    const available = stock - reserved;
    return { variantId: v.id, sku: v.sku, label: v.label, product: v.product.name, active: v.product.isActive, stock, reserved, available, reorderPoint, ownReorderPoint: here?.reorderPoint ?? null, low: available <= reorderPoint };
  });
  return opts.lowOnly ? rows.filter((r) => r.low && r.active) : rows;
}

/** Low-stock counts per warehouse (active products only), for the warehouses list. */
export async function lowStockCounts() {
  const list = await db.warehouse.findMany({ where: { active: true }, select: { id: true } });
  const out = new Map<string, number>();
  for (const w of list) out.set(w.id, (await warehouseStockRows(w.id, { lowOnly: true })).length);
  return out;
}

/** Storefront availability per variant = Σ (on hand − reserved) over ACTIVE warehouses. */
export async function availableAcrossActive(variantIds: string[], client: Client = db) {
  if (!variantIds.length) return new Map<string, number>();
  const rows = await client.$queryRaw<{ variantId: string; available: number }[]>`
    SELECT ws."variantId", COALESCE(SUM(ws.stock - ws.reserved), 0)::int AS available
    FROM "WarehouseStock" ws JOIN "Warehouse" w ON w.id = ws."warehouseId"
    WHERE w.active AND ws."variantId" = ANY(${variantIds})
    GROUP BY ws."variantId"`;
  return new Map(rows.map((r) => [r.variantId, r.available]));
}

/** Per-warehouse columns for the stock page: variantId → warehouseId → figures. */
export const stockByWarehouse = (variantIds: string[]) => warehouseBreakdown(db, variantIds);

// ─────────────────────────────── Orders ───────────────────────────────

/** Where an order ships from: the warehouse holding most of its units (default when it has no allocation). */
export async function primaryWarehouseForOrder(orderId: string, client: Client = db) {
  const rows = await client.$queryRaw<{ warehouseId: string; units: number }[]>`
    SELECT "warehouseId", SUM(quantity)::int AS units FROM "OrderAllocation"
    WHERE "orderId" = ${orderId} AND state IN ('RESERVED', 'COMMITTED')
    GROUP BY "warehouseId" ORDER BY units DESC`;
  const id = rows[0]?.warehouseId ?? (await defaultWarehouseId(client));
  const warehouse = await client.warehouse.findUnique({ where: { id } });
  return { warehouse, split: rows.length > 1, warehouses: rows.map((r) => r.warehouseId) };
}

/** Per-order allocation summary for the order page. */
export async function orderAllocationSummary(orderId: string) {
  const rows = await db.orderAllocation.findMany({
    where: { orderId, state: { in: ["RESERVED", "COMMITTED"] } },
    include: { warehouse: { select: { code: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows;
}

/** Open orders whose units sit in more than one warehouse (consolidate with a transfer, or ship separately). */
export async function splitOrders(limit = 50) {
  const rows = await db.$queryRaw<{ orderId: string; number: string; status: string; warehouses: string[] }[]>`
    SELECT o.id AS "orderId", o.number, o.status::text AS status, ARRAY_AGG(DISTINCT w.code) AS warehouses
    FROM "OrderAllocation" a JOIN "Order" o ON o.id = a."orderId" JOIN "Warehouse" w ON w.id = a."warehouseId"
    WHERE a.state IN ('RESERVED', 'COMMITTED') AND o.status IN ('PENDING', 'PAID', 'PACKED')
    GROUP BY o.id, o.number, o.status HAVING COUNT(DISTINCT a."warehouseId") > 1
    ORDER BY o.number DESC LIMIT ${limit}`;
  return rows;
}

// ─────────────────────────────── Transfers ───────────────────────────────

export type TransferLineInput = { variantId: string; quantity: number };

/** "TR-" + 2-digit year + sequence (3+ digits), e.g. TR-26001. */
async function nextTransferNumber(tx: Tx, now = new Date()) {
  const prefix = `TR-${String(now.getFullYear() % 100).padStart(2, "0")}`;
  const start = prefix.length + 1;
  const rows = await tx.$queryRaw<{ seq: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING(number FROM ${start}::int) AS INTEGER))::int AS seq
    FROM "StockTransfer" WHERE number LIKE ${prefix + "%"} AND SUBSTRING(number FROM ${start}::int) ~ '^[0-9]+$'`;
  return `${prefix}${String((rows[0]?.seq ?? 0) + 1).padStart(3, "0")}`;
}

function mergeLines(lines: TransferLineInput[]) {
  const m = new Map<string, number>();
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw new WarehouseError("Quantities must be whole units above zero.");
    m.set(l.variantId, (m.get(l.variantId) ?? 0) + l.quantity);
  }
  return [...m.entries()].map(([variantId, quantity]) => ({ variantId, quantity }));
}

export async function createTransfer(input: { fromId: string; toId: string; lines: TransferLineInput[]; note?: string | null; actorId: string }) {
  if (input.fromId === input.toId) throw new WarehouseError("Pick two different warehouses.");
  const lines = mergeLines(input.lines);
  if (!lines.length) throw new WarehouseError("Add at least one line.");
  return db.$transaction(async (tx) => {
    const ws = await tx.warehouse.findMany({ where: { id: { in: [input.fromId, input.toId] } } });
    if (ws.length !== 2) throw new WarehouseError("Warehouse not found.");
    if (ws.some((w) => !w.active)) throw new WarehouseError("Both warehouses must be active.");
    const variants = await tx.productVariant.count({ where: { id: { in: lines.map((l) => l.variantId) } } });
    if (variants !== lines.length) throw new WarehouseError("One of the variants no longer exists.");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('StockTransfer.number'))`;
    const number = await nextTransferNumber(tx);
    return tx.stockTransfer.create({
      data: { number, fromId: input.fromId, toId: input.toId, note: input.note || null, createdById: input.actorId, lines: { create: lines } },
      select: { id: true, number: true },
    });
  });
}

async function lockTransfer(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string; number: string; status: TransferStatus; fromId: string; toId: string }[]>`
    SELECT id, number, status, "fromId", "toId" FROM "StockTransfer" WHERE id = ${id} FOR UPDATE`;
  if (!rows[0]) throw new WarehouseError("Transfer not found.");
  return rows[0];
}

/** Replaces a draft's lines. */
export async function setTransferLines(id: string, lines: TransferLineInput[]) {
  const merged = mergeLines(lines);
  if (!merged.length) throw new WarehouseError("Add at least one line.");
  return db.$transaction(async (tx) => {
    const t = await lockTransfer(tx, id);
    if (t.status !== "DRAFT") throw new WarehouseError(`${t.number} is ${t.status.toLowerCase().replace("_", " ")}; its lines are locked.`);
    await tx.stockTransferLine.deleteMany({ where: { transferId: id } });
    await tx.stockTransferLine.createMany({ data: merged.map((l) => ({ ...l, transferId: id })) });
    return t;
  });
}

/** DRAFT → IN_TRANSIT: units leave the source (TRANSFER_OUT). Only free stock can move; all lines or none. */
export async function dispatchTransfer(id: string, actorId: string) {
  return db.$transaction(
    async (tx) => {
      const t = await lockTransfer(tx, id);
      if (t.status !== "DRAFT") throw new WarehouseError(`${t.number} has already been ${t.status === "CANCELLED" ? "cancelled" : "dispatched"}.`);
      const from = await tx.warehouse.findUniqueOrThrow({ where: { id: t.fromId } });
      const to = await tx.warehouse.findUniqueOrThrow({ where: { id: t.toId } });
      if (!from.active || !to.active) throw new WarehouseError("Both warehouses must be active.");
      const lines = await tx.stockTransferLine.findMany({ where: { transferId: id }, include: { variant: { select: { sku: true } } }, orderBy: { variantId: "asc" } });
      if (!lines.length) throw new WarehouseError("Add at least one line before dispatching.");
      for (const l of lines) {
        const ok = await takeOut(tx, t.fromId, l.variantId, l.quantity, { actorId, reason: "TRANSFER_OUT" });
        if (!ok) throw new WarehouseError(`${l.variant.sku}: not enough free stock in ${from.code} to send ${l.quantity}.`);
      }
      await tx.stockTransfer.update({ where: { id }, data: { status: "IN_TRANSIT", dispatchedAt: new Date() } });
      return { number: t.number, lines: lines.length, units: lines.reduce((n, l) => n + l.quantity, 0) };
    },
    { maxWait: 15_000, timeout: 60_000 },
  );
}

/** IN_TRANSIT → RECEIVED: units land at the destination (TRANSFER_IN). */
export async function receiveTransfer(id: string, actorId: string) {
  return db.$transaction(
    async (tx) => {
      const t = await lockTransfer(tx, id);
      if (t.status !== "IN_TRANSIT") throw new WarehouseError(t.status === "DRAFT" ? `Dispatch ${t.number} before receiving it.` : `${t.number} is ${t.status.toLowerCase()}.`);
      const lines = await tx.stockTransferLine.findMany({ where: { transferId: id }, orderBy: { variantId: "asc" } });
      for (const l of lines) await changeUnits(tx, l.variantId, l.quantity, "TRANSFER_IN", { actorId, warehouseId: t.toId });
      await tx.stockTransfer.update({ where: { id }, data: { status: "RECEIVED", receivedAt: new Date() } });
      return { number: t.number, lines: lines.length, units: lines.reduce((n, l) => n + l.quantity, 0) };
    },
    { maxWait: 15_000, timeout: 60_000 },
  );
}

/** Cancels a draft, or an in-transit transfer (its units go back to the source). */
export async function cancelTransfer(id: string, actorId: string) {
  return db.$transaction(
    async (tx) => {
      const t = await lockTransfer(tx, id);
      if (t.status === "RECEIVED" || t.status === "CANCELLED") throw new WarehouseError(`${t.number} is already ${t.status.toLowerCase()}.`);
      if (t.status === "IN_TRANSIT") {
        const lines = await tx.stockTransferLine.findMany({ where: { transferId: id }, orderBy: { variantId: "asc" } });
        for (const l of lines) await changeUnits(tx, l.variantId, l.quantity, "TRANSFER_IN", { actorId, warehouseId: t.fromId });
      }
      await tx.stockTransfer.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
      return { number: t.number, returned: t.status === "IN_TRANSIT" };
    },
    { maxWait: 15_000, timeout: 60_000 },
  );
}

/** Units currently in transit per variant (left a warehouse, not yet received). */
export async function inTransitUnits() {
  const rows = await db.$queryRaw<{ units: number }[]>`
    SELECT COALESCE(SUM(l.quantity), 0)::int AS units FROM "StockTransferLine" l JOIN "StockTransfer" t ON t.id = l."transferId" WHERE t.status = 'IN_TRANSIT'`;
  return rows[0]?.units ?? 0;
}
