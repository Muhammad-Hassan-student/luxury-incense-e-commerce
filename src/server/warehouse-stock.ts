import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { planAllocation, type AllocationCandidate, type AllocationChunk, type AllocationMove } from "@/lib/warehouse-allocation";

/*
 * Per-warehouse stock engine used by src/server/inventory.ts (which keeps its public API).
 *
 * Invariant: ProductVariant.stock / .reserved = Σ WarehouseStock over all warehouses. Every operation:
 *   1. locks the variant row(s) (FOR UPDATE, sorted by id → no deadlocks; per-variant mutex),
 *   2. reconciles: any difference between the variant totals and the warehouse rows (stock written directly to
 *      ProductVariant by older code, seeds, imports or tests) is booked into the default warehouse,
 *   3. moves units between warehouse rows,
 *   4. re-derives the variant totals from the warehouse rows (exact, because the lock is held).
 * Order allocations (OrderAllocation) remember which warehouse holds/sold each order's units so releases,
 * sales and returns land in the right place; orders without allocations fall back to the default warehouse.
 */

type Tx = Prisma.TransactionClient;
type Client = Pick<Tx, "$queryRaw" | "$executeRaw">;

export type MoveReason = "RESERVE" | "RELEASE" | "SALE" | "RESTOCK" | "ADJUST" | "RETURN" | "PO_RECEIVE" | "STOCKTAKE" | "TRANSFER_OUT" | "TRANSFER_IN";

export const DEFAULT_WAREHOUSE_ID = "wh_main";

/** The default warehouse id (created on the fly if a database somehow has none). */
export async function defaultWarehouseId(tx: Client): Promise<string> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Warehouse" WHERE "isDefault" ORDER BY "createdAt" LIMIT 1`;
  if (rows[0]) return rows[0].id;
  const made = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "Warehouse" (id, code, name, priority, "isDefault", active, "updatedAt")
    VALUES (${DEFAULT_WAREHOUSE_ID}, 'MAIN', 'Main warehouse', 10, true, true, CURRENT_TIMESTAMP)
    ON CONFLICT (code) DO UPDATE SET "isDefault" = true RETURNING id`;
  return made[0].id;
}

type Totals = { stock: number; reserved: number };

/** Locks variant rows in id order; returns their totals (missing ids are absent). */
async function lockVariants(tx: Tx, ids: string[]) {
  const out = new Map<string, Totals>();
  for (const id of [...new Set(ids)].sort()) {
    const rows = await tx.$queryRaw<Totals[]>`SELECT stock, reserved FROM "ProductVariant" WHERE id = ${id} FOR UPDATE`;
    if (rows[0]) out.set(id, rows[0]);
  }
  return out;
}

type WsRow = { warehouseId: string; stock: number; reserved: number; active: boolean; isDefault: boolean; priority: number; pincode: string; code: string };

async function wsRows(tx: Client, variantId: string) {
  return tx.$queryRaw<WsRow[]>`
    SELECT ws."warehouseId", ws.stock, ws.reserved, w.active, w."isDefault", w.priority, w.pincode, w.code
    FROM "WarehouseStock" ws JOIN "Warehouse" w ON w.id = ws."warehouseId"
    WHERE ws."variantId" = ${variantId}`;
}

/** Adds deltas to one warehouse row (created when missing). Callers hold the variant lock and pass exact amounts. */
async function bump(tx: Tx, warehouseId: string, variantId: string, dStock: number, dReserved: number) {
  if (!dStock && !dReserved) return;
  await tx.$executeRaw`
    INSERT INTO "WarehouseStock" ("warehouseId", "variantId", stock, reserved, "updatedAt")
    VALUES (${warehouseId}, ${variantId}, GREATEST(0, ${dStock}::int), GREATEST(0, ${dReserved}::int), CURRENT_TIMESTAMP)
    ON CONFLICT ("warehouseId", "variantId") DO UPDATE
    SET stock = GREATEST(0, "WarehouseStock".stock + ${dStock}::int),
        reserved = GREATEST(0, "WarehouseStock".reserved + ${dReserved}::int),
        "updatedAt" = CURRENT_TIMESTAMP`;
}

/** Variant totals := Σ warehouse rows. Safe because the caller holds the variant row lock. */
async function syncVariant(tx: Tx, variantId: string) {
  await tx.$executeRaw`
    UPDATE "ProductVariant" v SET stock = s.stock, reserved = s.reserved
    FROM (SELECT COALESCE(SUM(stock), 0)::int AS stock, COALESCE(SUM(reserved), 0)::int AS reserved
          FROM "WarehouseStock" WHERE "variantId" = ${variantId}) s
    WHERE v.id = ${variantId}`;
}

/** Order in which to take units away when no warehouse is named: default first, then least preferred. */
const drainOrder = (rows: WsRow[]) => [...rows].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.priority - a.priority || a.code.localeCompare(b.code));

/** Books any drift between the variant totals and the warehouse rows into the default warehouse. */
async function reconcile(tx: Tx, variantId: string, totals: Totals) {
  const rows = await wsRows(tx, variantId);
  const dStock = totals.stock - rows.reduce((n, r) => n + r.stock, 0);
  const dReserved = totals.reserved - rows.reduce((n, r) => n + r.reserved, 0);
  if (!dStock && !dReserved) return;
  const def = await defaultWarehouseId(tx);
  for (const [field, delta] of [["stock", dStock], ["reserved", dReserved]] as const) {
    if (delta > 0) await (field === "stock" ? bump(tx, def, variantId, delta, 0) : bump(tx, def, variantId, 0, delta));
    else if (delta < 0) {
      let left = -delta;
      for (const r of drainOrder(rows)) {
        if (left <= 0) break;
        const n = Math.min(left, r[field]);
        if (n > 0) await (field === "stock" ? bump(tx, r.warehouseId, variantId, -n, 0) : bump(tx, r.warehouseId, variantId, 0, -n));
        left -= n;
      }
    }
  }
}

/** Lock + reconcile, the first step of every stock operation. Returns the variants' totals. */
export async function lockStock(tx: Tx, variantIds: string[]) {
  const totals = await lockVariants(tx, variantIds);
  for (const [id, t] of totals) await reconcile(tx, id, t);
  return totals;
}

async function log(tx: Tx, data: { variantId: string; delta: number; reason: MoveReason; orderId?: string | null; actorId?: string | null; warehouseId: string }) {
  await tx.inventoryLog.create({ data: { variantId: data.variantId, delta: data.delta, reason: data.reason, orderId: data.orderId ?? null, actorId: data.actorId ?? null, warehouseId: data.warehouseId } });
}

async function orderInfo(tx: Tx, orderId: string) {
  const rows = await tx.$queryRaw<{ id: string; pincode: string | null }[]>`
    SELECT id, "shippingAddress"->>'postalCode' AS pincode FROM "Order" WHERE id = ${orderId}`;
  return rows[0] ?? null;
}

type Alloc = { id: string; warehouseId: string; quantity: number };

async function allocations(tx: Tx, orderId: string, variantId: string, state: string) {
  return tx.$queryRaw<Alloc[]>`
    SELECT id, "warehouseId", quantity FROM "OrderAllocation"
    WHERE "orderId" = ${orderId} AND "variantId" = ${variantId} AND state = ${state} ORDER BY "createdAt", id`;
}

/** Moves `qty` units of an order's allocations from one state to another (splitting a row when partial). */
async function shiftAllocation(tx: Tx, a: Alloc, qty: number, to: string, orderId: string, variantId: string) {
  if (qty >= a.quantity) {
    await tx.orderAllocation.update({ where: { id: a.id }, data: { state: to } });
  } else {
    await tx.orderAllocation.update({ where: { id: a.id }, data: { quantity: a.quantity - qty } });
    await tx.orderAllocation.create({ data: { orderId, variantId, warehouseId: a.warehouseId, quantity: qty, state: to } });
  }
}

async function recordAllocation(tx: Tx, hasOrder: boolean, orderId: string, variantId: string, warehouseId: string, qty: number, state: string) {
  if (!hasOrder || qty <= 0) return;
  await tx.orderAllocation.create({ data: { orderId, variantId, warehouseId, quantity: qty, state } });
}

// ─────────────────────────────── Reservations ───────────────────────────────

async function candidates(tx: Tx, variantIds: string[]): Promise<AllocationCandidate[]> {
  const ws = await tx.$queryRaw<{ id: string; code: string; pincode: string; priority: number; isDefault: boolean }[]>`
    SELECT id, code, pincode, priority, "isDefault" FROM "Warehouse" WHERE active`;
  const cands = ws.map((w) => ({ ...w, available: {} as Record<string, number> }));
  for (const vid of variantIds) {
    for (const r of await wsRows(tx, vid)) {
      const c = cands.find((x) => x.id === r.warehouseId);
      if (c) c.available[vid] = Math.max(0, r.stock - r.reserved);
    }
  }
  return cands;
}

async function applyReservation(tx: Tx, chunks: AllocationChunk[], orderId: string, hasOrder: boolean) {
  for (const c of chunks) {
    await bump(tx, c.warehouseId, c.variantId, 0, c.qty);
    await recordAllocation(tx, hasOrder, orderId, c.variantId, c.warehouseId, c.qty, "RESERVED");
    await log(tx, { variantId: c.variantId, delta: 0, reason: "RESERVE", orderId, warehouseId: c.warehouseId });
  }
  for (const vid of new Set(chunks.map((c) => c.variantId))) await syncVariant(tx, vid);
}

/**
 * Holds stock for a whole order at once with the allocation rules (single warehouse preferred, nearest by pincode,
 * priority, then split). Returns the plan, or the first variant that can't be covered.
 */
export async function reserveForOrder(tx: Tx, orderId: string, moves: AllocationMove[], destPincode?: string | null) {
  const ids = moves.map((m) => m.variantId);
  const locked = await lockStock(tx, ids);
  const missing = ids.find((id) => !locked.has(id));
  if (missing) return { ok: false as const, variantId: missing };
  const info = await orderInfo(tx, orderId);
  const plan = planAllocation(moves, await candidates(tx, [...locked.keys()]), destPincode ?? info?.pincode ?? null);
  if (!plan) {
    const cands = await candidates(tx, ids);
    const short = moves.find((m) => cands.reduce((n, c) => n + (c.available[m.variantId] ?? 0), 0) < m.qty);
    return { ok: false as const, variantId: short?.variantId ?? ids[0] };
  }
  await applyReservation(tx, plan.chunks, orderId, Boolean(info));
  return { ok: true as const, plan };
}

/** Single-variant hold (older call sites): prefers warehouses this order already uses, then the usual ranking. */
export async function reserveUnits(tx: Tx, variantId: string, qty: number, orderId: string) {
  const locked = await lockStock(tx, [variantId]);
  if (!locked.has(variantId)) return false;
  const info = await orderInfo(tx, orderId);
  const used = info
    ? (await tx.$queryRaw<{ warehouseId: string }[]>`SELECT DISTINCT "warehouseId" FROM "OrderAllocation" WHERE "orderId" = ${orderId} AND state IN ('RESERVED', 'COMMITTED')`).map((r) => r.warehouseId)
    : [];
  const plan = planAllocation([{ variantId, qty }], await candidates(tx, [variantId]), info?.pincode ?? null, used);
  if (!plan) return false;
  await applyReservation(tx, plan.chunks, orderId, Boolean(info));
  return true;
}

/** Gives held units back: from the order's RESERVED allocations first, then (older holds) default-first. */
export async function releaseUnits(tx: Tx, variantId: string, qty: number, orderId: string) {
  await lockStock(tx, [variantId]);
  let left = qty;
  const touched = new Map<string, number>();
  for (const a of await allocations(tx, orderId, variantId, "RESERVED")) {
    if (left <= 0) break;
    const n = Math.min(left, a.quantity);
    await shiftAllocation(tx, a, n, "RELEASED", orderId, variantId);
    touched.set(a.warehouseId, (touched.get(a.warehouseId) ?? 0) + n);
    left -= n;
  }
  if (left > 0) {
    for (const r of drainOrder(await wsRows(tx, variantId))) {
      if (left <= 0) break;
      const n = Math.min(left, r.reserved - (touched.get(r.warehouseId) ?? 0));
      if (n > 0) {
        touched.set(r.warehouseId, (touched.get(r.warehouseId) ?? 0) + n);
        left -= n;
      }
    }
  }
  if (!touched.size) touched.set(await defaultWarehouseId(tx), 0);
  for (const [wid, n] of touched) {
    await bump(tx, wid, variantId, 0, -n);
    await log(tx, { variantId, delta: 0, reason: "RELEASE", orderId, warehouseId: wid });
  }
  await syncVariant(tx, variantId);
}

/** Turns held units into a sale (stock and reserved both drop) in the warehouses holding them. */
export async function commitUnits(tx: Tx, variantId: string, qty: number, orderId: string) {
  await lockStock(tx, [variantId]);
  let left = qty;
  const sold = new Map<string, { units: number; held: number }>();
  const add = (wid: string, units: number, held: number) => {
    const p = sold.get(wid) ?? { units: 0, held: 0 };
    sold.set(wid, { units: p.units + units, held: p.held + held });
  };
  for (const a of await allocations(tx, orderId, variantId, "RESERVED")) {
    if (left <= 0) break;
    const n = Math.min(left, a.quantity);
    await shiftAllocation(tx, a, n, "COMMITTED", orderId, variantId);
    add(a.warehouseId, n, n);
    left -= n;
  }
  if (left > 0) {
    // Held before warehouses existed (or by a caller without an order row): take from the default first.
    const info = await orderInfo(tx, orderId);
    const rows = drainOrder(await wsRows(tx, variantId));
    for (const pass of ["reserved", "stock"] as const) {
      for (const r of rows) {
        if (left <= 0) break;
        const p = sold.get(r.warehouseId) ?? { units: 0, held: 0 };
        const room = pass === "reserved" ? r.reserved - p.held : r.stock - p.units - (r.reserved - p.held);
        const n = Math.min(left, Math.max(0, room));
        if (n > 0) {
          add(r.warehouseId, n, pass === "reserved" ? n : 0);
          await recordAllocation(tx, Boolean(info), orderId, variantId, r.warehouseId, n, "COMMITTED");
          left -= n;
        }
      }
    }
    if (left > 0) {
      const def = await defaultWarehouseId(tx);
      add(def, left, 0);
      await recordAllocation(tx, Boolean(info), orderId, variantId, def, left, "COMMITTED");
    }
  }
  for (const [wid, s] of sold) {
    await bump(tx, wid, variantId, -s.units, -s.held);
    await log(tx, { variantId, delta: -s.units, reason: "SALE", orderId, warehouseId: wid });
  }
  await syncVariant(tx, variantId);
}

/**
 * Adds (or removes) on-hand units. Destination: the named warehouse; for RETURNs, the warehouses the order was sold
 * from; otherwise the default. Removals without a warehouse drain default-first. Floors at zero like before.
 * Returns the units actually applied per warehouse.
 */
export async function changeUnits(
  tx: Tx,
  variantId: string,
  delta: number,
  reason: MoveReason,
  opts: { actorId?: string | null; orderId?: string | null; warehouseId?: string | null } = {},
) {
  await lockStock(tx, [variantId]);
  const applied = new Map<string, number>();
  const rows = await wsRows(tx, variantId);
  const onHand = (wid: string) => rows.find((r) => r.warehouseId === wid)?.stock ?? 0;
  if (delta > 0) {
    let left = delta;
    if (!opts.warehouseId && reason === "RETURN" && opts.orderId) {
      for (const a of await allocations(tx, opts.orderId, variantId, "COMMITTED")) {
        if (left <= 0) break;
        const n = Math.min(left, a.quantity);
        await shiftAllocation(tx, a, n, "RETURNED", opts.orderId, variantId);
        applied.set(a.warehouseId, (applied.get(a.warehouseId) ?? 0) + n);
        left -= n;
      }
    }
    if (left > 0) {
      const wid = opts.warehouseId ?? (await defaultWarehouseId(tx));
      applied.set(wid, (applied.get(wid) ?? 0) + left);
    }
  } else if (delta < 0) {
    let left = -delta;
    const order = opts.warehouseId ? rows.filter((r) => r.warehouseId === opts.warehouseId) : drainOrder(rows);
    for (const r of order) {
      if (left <= 0) break;
      const n = Math.min(left, onHand(r.warehouseId));
      if (n > 0) applied.set(r.warehouseId, -n);
      left -= n;
    }
    if (!applied.size) applied.set(opts.warehouseId ?? (await defaultWarehouseId(tx)), 0);
  }
  for (const [wid, n] of applied) {
    await bump(tx, wid, variantId, n, 0);
    await log(tx, { variantId, delta: n, reason, orderId: opts.orderId, actorId: opts.actorId, warehouseId: wid });
  }
  await syncVariant(tx, variantId);
  return applied;
}

/** On hand in one warehouse right now (call after lockStock). */
export async function onHandIn(tx: Client, warehouseId: string, variantId: string) {
  const rows = await tx.$queryRaw<{ stock: number; reserved: number }[]>`
    SELECT stock, reserved FROM "WarehouseStock" WHERE "warehouseId" = ${warehouseId} AND "variantId" = ${variantId}`;
  return rows[0] ?? { stock: 0, reserved: 0 };
}

/** Moves free units out of a warehouse (transfer dispatch). False when not enough free stock there. */
export async function takeOut(tx: Tx, warehouseId: string, variantId: string, qty: number, meta: { actorId?: string | null; reason: MoveReason }) {
  await lockStock(tx, [variantId]);
  const here = await onHandIn(tx, warehouseId, variantId);
  if (here.stock - here.reserved < qty) return false;
  await bump(tx, warehouseId, variantId, -qty, 0);
  await log(tx, { variantId, delta: -qty, reason: meta.reason, actorId: meta.actorId, warehouseId });
  await syncVariant(tx, variantId);
  return true;
}

/** Effective per-warehouse figures for display, with unreconciled drift shown in the default warehouse (no locks). */
export async function warehouseBreakdown(tx: Client, variantIds?: string[]) {
  const def = await defaultWarehouseId(tx);
  const rows = await tx.$queryRaw<{ variantId: string; warehouseId: string; stock: number; reserved: number; reorderPoint: number | null }[]>`
    SELECT "variantId", "warehouseId", stock, reserved, "reorderPoint" FROM "WarehouseStock"`;
  const totals = await tx.$queryRaw<{ id: string; stock: number; reserved: number }[]>`SELECT id, stock, reserved FROM "ProductVariant"`;
  const wanted = variantIds ? new Set(variantIds) : null;
  const out = new Map<string, Map<string, { stock: number; reserved: number; reorderPoint: number | null }>>();
  for (const r of rows) {
    if (wanted && !wanted.has(r.variantId)) continue;
    const m = out.get(r.variantId) ?? new Map();
    m.set(r.warehouseId, { stock: r.stock, reserved: r.reserved, reorderPoint: r.reorderPoint });
    out.set(r.variantId, m);
  }
  for (const t of totals) {
    if (wanted && !wanted.has(t.id)) continue;
    const m = out.get(t.id) ?? new Map();
    let s = 0;
    let r = 0;
    for (const v of m.values()) {
      s += v.stock;
      r += v.reserved;
    }
    if (s !== t.stock || r !== t.reserved) {
      const d = m.get(def) ?? { stock: 0, reserved: 0, reorderPoint: null };
      m.set(def, { ...d, stock: Math.max(0, d.stock + t.stock - s), reserved: Math.max(0, d.reserved + t.reserved - r) });
    }
    out.set(t.id, m);
  }
  return out;
}


/** Books drift from direct ProductVariant writes into the default warehouse for every affected variant (daily cron). */
export async function reconcileAllStock(client: { $transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T> } & Client) {
  const drifted = await client.$queryRaw<{ id: string }[]>`
    SELECT v.id FROM "ProductVariant" v LEFT JOIN "WarehouseStock" ws ON ws."variantId" = v.id
    GROUP BY v.id, v.stock, v.reserved
    HAVING v.stock <> COALESCE(SUM(ws.stock), 0) OR v.reserved <> COALESCE(SUM(ws.reserved), 0)`;
  for (const v of drifted) await client.$transaction((tx) => lockStock(tx, [v.id]));
  return drifted.length;
}
