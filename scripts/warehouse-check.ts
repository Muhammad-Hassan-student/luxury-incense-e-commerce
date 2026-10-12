// Multi-warehouse checks against the local database. Creates its own warehouses, products, orders, PO and stocktake and
// removes them afterwards; real variants' totals are verified unchanged.
// Run: npm run test:warehouses
import "./no-real-email";
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { db } from "@/server/db";
import { OutOfStockError, adjustStock, commitSale, release, reserve, reserveOrder } from "@/server/inventory";
import { planAllocation, pincodeAffinity, rankWarehouses } from "@/lib/warehouse-allocation";
import { DEFAULT_WAREHOUSE_ID, defaultWarehouseId, lockStock, warehouseBreakdown } from "@/server/warehouse-stock";
import {
  WarehouseError,
  availableAcrossActive,
  cancelTransfer,
  createTransfer,
  createWarehouse,
  dispatchTransfer,
  primaryWarehouseForOrder,
  receiveTransfer,
  setWarehouseReorderPoint,
  updateWarehouse,
  warehouseStockRows,
} from "@/server/warehouses";
import { createPurchaseOrder, markOrdered, receivePurchaseOrder } from "@/server/purchasing";
import { completeStockTake, createStockTake, saveCounts } from "@/server/stocktake";

const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};
async function rejects(p: Promise<unknown>, type: new (...a: never[]) => Error, msg: string) {
  try {
    await p;
    ok(false, `${msg} (did not throw)`);
  } catch (e) {
    ok(e instanceof type, `${msg}${e instanceof type ? "" : ` (threw ${(e as Error).message})`}`);
  }
}

const tag = `WHCHK${Date.now().toString(36).toUpperCase()}`;
const ws = async (warehouseId: string, variantId: string) =>
  (await db.warehouseStock.findUnique({ where: { warehouseId_variantId: { warehouseId, variantId } } })) ?? { stock: 0, reserved: 0 };
const variant = (id: string) => db.productVariant.findUniqueOrThrow({ where: { id } });
const sumWs = async (variantId: string) => {
  const rows = await db.warehouseStock.findMany({ where: { variantId } });
  return { stock: rows.reduce((n, r) => n + r.stock, 0), reserved: rows.reduce((n, r) => n + r.reserved, 0) };
};

async function main() {
  // Real data snapshot (totals must not change).
  const realBefore = await db.productVariant.findMany({ select: { id: true, stock: true, reserved: true } });
  const realBreakdown = await warehouseBreakdown(db, realBefore.map((v) => v.id));

  // ── 1. Default-warehouse migration ──
  const migration = readdirSync("prisma/migrations").find((d) => d.endsWith("_accounting_warehouses"));
  const sql = migration ? readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8") : "";
  ok(/INSERT INTO "Warehouse"[\s\S]*'MAIN'[\s\S]*INSERT INTO "WarehouseStock"[\s\S]*v\."stock", v\."reserved"/.test(sql), "migration creates the default warehouse and copies every variant's stock + reserved into it");
  const def = await defaultWarehouseId(db);
  const defRow = await db.warehouse.findUniqueOrThrow({ where: { id: def } });
  ok(defRow.isDefault && defRow.active && (await db.warehouse.count({ where: { isDefault: true } })) === 1, `exactly one default warehouse (${defRow.code}${def === DEFAULT_WAREHOUSE_ID ? ", from the migration" : ""})`);
  const preserved = realBefore.every((v) => {
    const m = realBreakdown.get(v.id);
    const s = [...(m?.values() ?? [])].reduce((a, r) => ({ stock: a.stock + r.stock, reserved: a.reserved + r.reserved }), { stock: 0, reserved: 0 });
    return s.stock === v.stock && s.reserved === v.reserved;
  });
  ok(preserved, `per-warehouse figures sum to the store totals for all ${realBefore.length} real variants`);

  // ── 2. Pure allocation rules ──
  ok(pincodeAffinity("110001", "110045") === 4 && pincodeAffinity("560001", "110001") === 0 && pincodeAffinity("", "110001") === 0, "pincode affinity = shared prefix length");
  const c = (id: string, pincode: string, priority: number, available: Record<string, number>, isDefault = false) => ({ id, code: id, pincode, priority, isDefault, available });
  const N = c("N", "110001", 50, { a: 5, b: 0 });
  const S = c("S", "560001", 10, { a: 5, b: 5 });
  const M = c("M", "400001", 90, { a: 1, b: 1 }, true);
  ok(rankWarehouses([S, N, M], "110020")[0].id === "N" && rankWarehouses([N, S, M], "999999")[0].id === "S", "ranking: nearest pincode first, then priority");
  let plan = planAllocation([{ variantId: "a", qty: 2 }], [N, S, M], "110020");
  ok(plan?.warehouses.join() === "N" && !plan.split, "nearest warehouse ships when it has everything");
  plan = planAllocation([{ variantId: "a", qty: 2 }, { variantId: "b", qty: 1 }], [N, S, M], "110020");
  ok(plan?.warehouses.join() === "S" && !plan.split, "single-warehouse fulfilment beats the nearest partial one");
  plan = planAllocation([{ variantId: "a", qty: 2 }], [c("P1", "", 20, { a: 5 }), c("P2", "", 10, { a: 5 })], null);
  ok(plan?.warehouses.join() === "P2", "no pincode: lower priority number wins");
  plan = planAllocation([{ variantId: "a", qty: 9 }, { variantId: "b", qty: 1 }], [N, S, M], "110020");
  const qty = (p: typeof plan, w: string, v: string) => p?.chunks.find((x) => x.warehouseId === w && x.variantId === v)?.qty ?? 0;
  ok(Boolean(plan?.split) && qty(plan, "S", "a") + qty(plan, "N", "a") + qty(plan, "M", "a") === 9 && qty(plan, "S", "b") === 1, "falls back to a split when no warehouse has it all");
  ok(planAllocation([{ variantId: "a", qty: 12 }], [N, S, M], null) === null, "more than all warehouses hold → out of stock");

  // ── Fixtures ──
  const user = await db.user.create({ data: { email: `${tag.toLowerCase()}@test.local`, name: "Warehouse check", role: "MANAGER" } });
  const category = await db.category.create({ data: { slug: tag.toLowerCase(), name: tag, tagline: "t", description: "t", ambient: "SMOKE" } });
  const product = await db.product.create({ data: { slug: tag.toLowerCase(), name: `${tag} Oud`, subtitle: "t", story: "t", categoryId: category.id, family: "WOODY", model: "INCENSE" } });
  const supplier = await db.supplier.create({ data: { name: `${tag} Supplier` } });
  // Written straight to ProductVariant, like seeds / older code: the engine books it into the default warehouse.
  const A = await db.productVariant.create({ data: { productId: product.id, sku: `${tag}-A`, label: "A", price: 100000, stock: 10, costPrice: 40000, supplierId: supplier.id } });
  const B = await db.productVariant.create({ data: { productId: product.id, sku: `${tag}-B`, label: "B", price: 50000, stock: 6, position: 1, supplierId: supplier.id } });
  const N1 = await createWarehouse({ code: `${tag.slice(-6)}N`, name: "Delhi test", address: "", city: "Delhi", state: "DL", pincode: "110001", priority: 50, pickupLocation: "Delhi WH", active: true });
  const S1 = await createWarehouse({ code: `${tag.slice(-6)}S`, name: "Bengaluru test", address: "", city: "Bengaluru", state: "KA", pincode: "560001", priority: 60, pickupLocation: "", active: true });
  const orders: string[] = [];
  const transfers: string[] = [];
  let poId: string | null = null;
  let takeId: string | null = null;
  const mkOrder = async (pincode: string) => {
    const o = await db.order.create({ data: { number: `${tag}-${orders.length}`, email: "wh@test.local", currency: "INR", subtotal: 0, shipping: 0, tax: 0, total: 0, shippingAddress: { fullName: "T", postalCode: pincode, state: "X", country: "IN" } } });
    orders.push(o.id);
    return o.id;
  };

  try {
    await db.$transaction((tx) => lockStock(tx, [A.id, B.id]));
    ok((await ws(def, A.id)).stock === 10 && (await ws(def, B.id)).stock === 6, "stock written directly to the variant lands in the default warehouse");

    // ── 3. Transfers: both sides logged ──
    await rejects(createTransfer({ fromId: def, toId: def, lines: [{ variantId: A.id, quantity: 1 }], actorId: user.id }), WarehouseError, "a transfer needs two different warehouses");
    const t1 = await createTransfer({ fromId: def, toId: N1.id, lines: [{ variantId: A.id, quantity: 8 }, { variantId: B.id, quantity: 2 }], note: "test", actorId: user.id });
    transfers.push(t1.id);
    ok(/^TR-\d{5,}$/.test(t1.number), `transfer number (${t1.number})`);
    await dispatchTransfer(t1.id, user.id);
    let a = await variant(A.id);
    ok((await ws(def, A.id)).stock === 2 && a.stock === 2, `dispatch: source −8 and the store total excludes in-transit units (total ${a.stock})`);
    await receiveTransfer(t1.id, user.id);
    a = await variant(A.id);
    ok((await ws(N1.id, A.id)).stock === 8 && (await ws(N1.id, B.id)).stock === 2 && a.stock === 10, "receive: destination +8 / +2, total back to 10");
    const tlogs = await db.inventoryLog.findMany({ where: { variantId: A.id, reason: { in: ["TRANSFER_OUT", "TRANSFER_IN"] } } });
    ok(tlogs.some((l) => l.reason === "TRANSFER_OUT" && l.warehouseId === def && l.delta === -8) && tlogs.some((l) => l.reason === "TRANSFER_IN" && l.warehouseId === N1.id && l.delta === 8), "InventoryLog entries on both sides with their warehouse");
    await rejects(receiveTransfer(t1.id, user.id), WarehouseError, "a received transfer can't be received twice");

    const t2 = await createTransfer({ fromId: def, toId: S1.id, lines: [{ variantId: A.id, quantity: 3 }], actorId: user.id });
    transfers.push(t2.id);
    await rejects(dispatchTransfer(t2.id, user.id), WarehouseError, "can't dispatch more than the source's free stock");
    ok((await ws(def, A.id)).stock === 2, "failed dispatch changed nothing");
    const t3 = await createTransfer({ fromId: def, toId: S1.id, lines: [{ variantId: A.id, quantity: 2 }, { variantId: B.id, quantity: 4 }], actorId: user.id });
    transfers.push(t3.id);
    await dispatchTransfer(t3.id, user.id);
    await cancelTransfer(t3.id, user.id);
    ok((await ws(def, A.id)).stock === 2 && (await ws(def, B.id)).stock === 4, "cancelling an in-transit transfer returns the units to the source");
    const t4 = await createTransfer({ fromId: def, toId: S1.id, lines: [{ variantId: A.id, quantity: 2 }, { variantId: B.id, quantity: 4 }], actorId: user.id });
    transfers.push(t4.id);
    await dispatchTransfer(t4.id, user.id);
    await receiveTransfer(t4.id, user.id);
    // Now: N1 A8 B2 · S1 A2 B4 · default empty.
    ok((await ws(def, A.id)).stock === 0 && (await ws(S1.id, B.id)).stock === 4, "layout for allocation tests: N1 A8 B2 · S1 A2 B4 · default 0");

    // ── 4. Order allocation in the database ──
    const o1 = await mkOrder("560034"); // Bengaluru: S1 has A2 B4
    await db.$transaction((tx) => reserveOrder(tx, o1, [{ variantId: A.id, qty: 2 }, { variantId: B.id, qty: 3 }], "560034"));
    let s1a = await ws(S1.id, A.id);
    ok(s1a.reserved === 2 && (await ws(S1.id, B.id)).reserved === 3 && (await ws(N1.id, A.id)).reserved === 0, "nearest warehouse that has everything holds the whole order");
    ok((await primaryWarehouseForOrder(o1)).warehouse?.id === S1.id, "shipment picks the allocated warehouse (its pickup location)");

    const o2 = await mkOrder("560034"); // wants A3 B1: S1 has only A0 free now → N1 (far) ships it whole
    await db.$transaction((tx) => reserveOrder(tx, o2, [{ variantId: A.id, qty: 3 }, { variantId: B.id, qty: 1 }], "560034"));
    ok((await ws(N1.id, A.id)).reserved === 3 && (await ws(N1.id, B.id)).reserved === 1, "single-warehouse fulfilment preferred over a split from the nearest");

    const o3 = await mkOrder("110001"); // wants A6: N1 has 5 free, S1 0 → … only 5 → out of stock; A5 OK
    await rejects(db.$transaction((tx) => reserveOrder(tx, o3, [{ variantId: A.id, qty: 6 }], "110001")), OutOfStockError, "short across all warehouses → OutOfStockError (nothing held)");
    ok((await ws(N1.id, A.id)).reserved === 3, "failed allocation rolled back");
    const o4 = await mkOrder("110001");
    await db.$transaction((tx) => reserveOrder(tx, o4, [{ variantId: B.id, qty: 2 }], "110001")); // N1 B1 free + S1 B1 free → split
    const allocs = await db.orderAllocation.findMany({ where: { orderId: o4, state: "RESERVED" } });
    ok(allocs.length === 2 && allocs.reduce((n, x) => n + x.quantity, 0) === 2 && (await primaryWarehouseForOrder(o4)).split, "split allocation when no single warehouse can send it");

    a = await variant(A.id);
    let b = await variant(B.id);
    const sa = await sumWs(A.id);
    ok(a.reserved === sa.reserved && a.reserved === 5 && b.reserved === 6, `per-warehouse holds roll up to the variant (A ${a.reserved}, B ${b.reserved})`);
    const avail = await availableAcrossActive([A.id, B.id]);
    ok(avail.get(A.id) === a.stock - a.reserved && avail.get(B.id) === b.stock - b.reserved, `storefront availability = Σ active warehouses (A ${avail.get(A.id)}, B ${avail.get(B.id)})`);

    // ── 5. Release / sale / return land in the right warehouse ──
    await db.$transaction((tx) => release(tx, A.id, 3, o2));
    ok((await ws(N1.id, A.id)).reserved === 0, "release frees the hold in the warehouse that had it");
    await db.$transaction((tx) => commitSale(tx, A.id, 2, o1));
    s1a = await ws(S1.id, A.id);
    ok(s1a.stock === 0 && s1a.reserved === 0 && (await ws(N1.id, A.id)).stock === 8, "sale takes stock from the allocated warehouse only");
    await db.$transaction((tx) => adjustStock(tx, A.id, 1, "RETURN", user.id, o1));
    ok((await ws(S1.id, A.id)).stock === 1, "a return goes back to the warehouse it was sold from");
    await db.$transaction((tx) => adjustStock(tx, A.id, 2, "RESTOCK", user.id));
    ok((await ws(def, A.id)).stock === 2, "restock without a location goes to the default warehouse");

    // ── 6. Concurrency: last free unit across warehouses ──
    await db.$transaction((tx) => adjustStock(tx, B.id, -100, "ADJUST", user.id)); // B now 0 on hand everywhere (holds remain)
    b = await variant(B.id);
    ok(b.stock === 0, "negative adjustment drains warehouses default-first, floored at 0");
    await db.$transaction((tx) => adjustStock(tx, B.id, 1, "ADJUST", user.id, undefined, N1.id));
    await db.$transaction((tx) => release(tx, B.id, 1, o2));
    await db.$transaction((tx) => release(tx, B.id, 3, o1));
    await db.$transaction((tx) => release(tx, B.id, 2, o4));
    const o5 = await mkOrder("110001");
    const o6 = await mkOrder("560001");
    const race = await Promise.allSettled([o5, o6].map((o) => db.$transaction((tx) => reserve(tx, B.id, 1, o))));
    ok(race.filter((r) => r.status === "fulfilled").length === 1 && race.some((r) => r.status === "rejected" && r.reason instanceof OutOfStockError), "two concurrent holds on the last unit: exactly one wins");

    // ── 7. Purchase order received into a chosen warehouse ──
    const po = await createPurchaseOrder({ supplierId: supplier.id, actorId: user.id, lines: [{ variantId: B.id, quantity: 5, unitCost: 20000 }], warehouseId: S1.id });
    poId = po.id;
    await markOrdered(po.id);
    const item = await db.purchaseOrderItem.findFirstOrThrow({ where: { poId: po.id } });
    await receivePurchaseOrder(po.id, [{ itemId: item.id, quantity: 5 }], { actorId: user.id });
    ok((await ws(S1.id, B.id)).stock === 5, "PO receipt lands in the PO's warehouse");
    const recLog = await db.inventoryLog.findFirst({ where: { variantId: B.id, reason: "PO_RECEIVE" } });
    ok(recLog?.warehouseId === S1.id, "PO_RECEIVE logged with the warehouse");

    // ── 8. Stocktake per warehouse ──
    const take = await createStockTake({ name: `${tag} count`, scope: { kind: "category", categoryId: category.id }, actorId: user.id, warehouseId: N1.id });
    takeId = take.id;
    const lines = await db.stockTakeLine.findMany({ where: { stockTakeId: take.id } });
    const lineA = lines.find((l) => l.variantId === A.id)!;
    ok(lineA.expected === 8, `warehouse stocktake snapshots that warehouse's on-hand (${lineA.expected})`);
    await saveCounts(take.id, [{ lineId: lineA.id, counted: 7 }]);
    const s1Before = await ws(S1.id, A.id);
    await completeStockTake(take.id, { actorId: user.id });
    ok((await ws(N1.id, A.id)).stock === 7 && (await ws(S1.id, A.id)).stock === s1Before.stock, "variance applied to the counted warehouse only");
    const stLog = await db.inventoryLog.findFirst({ where: { variantId: A.id, reason: "STOCKTAKE" } });
    ok(stLog?.warehouseId === N1.id && stLog.delta === -1, "STOCKTAKE movement logged with the warehouse");

    // ── 9. Low stock per warehouse & deactivation rules ──
    await setWarehouseReorderPoint(S1.id, A.id, 5);
    const lowS = await warehouseStockRows(S1.id, { lowOnly: true });
    ok(lowS.some((r) => r.variantId === A.id && r.reorderPoint === 5), "per-warehouse low-stock level flags the variant there");
    const base = { code: S1.code, name: S1.name, address: "", city: "", state: "", pincode: S1.pincode, priority: 60, pickupLocation: "" };
    await rejects(updateWarehouse(S1.id, { ...base, active: false }), WarehouseError, "a warehouse holding stock can't be deactivated");
    await rejects(updateWarehouse(def, { code: defRow.code, name: defRow.name, address: defRow.address, city: defRow.city, state: defRow.state, pincode: defRow.pincode, priority: defRow.priority, pickupLocation: defRow.pickupLocation, active: false }), WarehouseError, "the default warehouse can't be deactivated");

    // Invariant after everything.
    for (const v of [A, B]) {
      const t = await variant(v.id);
      const s = await sumWs(v.id);
      ok(t.stock === s.stock && t.reserved === s.reserved, `${v.sku}: variant totals = Σ warehouses (${t.stock}/${t.reserved})`);
    }
  } finally {
    await db.order.deleteMany({ where: { id: { in: orders } } });
    await db.stockTransfer.deleteMany({ where: { id: { in: transfers } } });
    if (takeId) await db.stockTake.deleteMany({ where: { id: takeId } });
    if (poId) await db.purchaseOrder.deleteMany({ where: { id: poId } });
    await db.inventoryLog.deleteMany({ where: { variantId: { in: [A.id, B.id] } } });
    await db.productVariant.deleteMany({ where: { productId: product.id } });
    await db.product.delete({ where: { id: product.id } });
    await db.category.delete({ where: { id: category.id } });
    await db.supplier.delete({ where: { id: supplier.id } });
    await db.warehouse.deleteMany({ where: { id: { in: [N1.id, S1.id] } } });
    await db.user.delete({ where: { id: user.id } });
    console.log("cleaned up");
  }

  const realAfter = await db.productVariant.findMany({ where: { id: { in: realBefore.map((v) => v.id) } }, select: { id: true, stock: true, reserved: true } });
  ok(realAfter.every((v) => realBefore.some((x) => x.id === v.id && x.stock === v.stock && x.reserved === v.reserved)), "real variants' stock untouched");
  ok((await db.warehouse.count({ where: { code: { startsWith: tag.slice(-6) } } })) === 0, "test warehouses removed");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
