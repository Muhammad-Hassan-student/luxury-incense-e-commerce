// Inventory, purchasing, stocktake and CSV checks against the local database.
// Creates its own category/product/variants/supplier/user and removes them afterwards; real stock is never touched.
// Run: npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/inventory-check.ts
import "./no-real-email";
import "dotenv/config";
import { isValidElement } from "react";
import { db } from "@/server/db";
import { adjustStock, weightedAverageCost } from "@/server/inventory";
import {
  PurchasingError,
  addPoLines,
  cancelPurchaseOrder,
  createDraftFromSuggestions,
  createPurchaseOrder,
  markOrdered,
  nextPoNumber,
  onOrderByVariant,
  receivePurchaseOrder,
  reorderSuggestions,
  suggestReorder,
  supplierSpend,
} from "@/server/purchasing";
import { StockTakeError, completeStockTake, createStockTake, saveCounts, stockTakeDrift } from "@/server/stocktake";
import { ImportRejected, applyImport, parseCsv, planImport } from "@/server/inventory-csv";
import { LOW_STOCK_DIGEST_KEY, claimDigestDay, lowStockItems } from "@/server/stock-report";
import { LowStockEmail } from "@/emails/low-stock";

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

const tag = `INVCHK${Date.now().toString(36).toUpperCase()}`;
const variant = (id: string) => db.productVariant.findUniqueOrThrow({ where: { id } });

async function main() {
  const realStockBefore = await db.productVariant.findMany({ select: { id: true, stock: true, reserved: true, costPrice: true } });
  const digestBefore = await db.setting.findUnique({ where: { key: LOW_STOCK_DIGEST_KEY } });

  // ── Fixtures ──
  const user = await db.user.create({ data: { email: `${tag.toLowerCase()}@test.local`, name: "Inventory check", role: "MANAGER" } });
  const supplier = await db.supplier.create({ data: { name: `${tag} Supplier`, leadTimeDays: 7 } });
  const category = await db.category.create({ data: { slug: tag.toLowerCase(), name: tag, tagline: "t", description: "t", ambient: "SMOKE" } });
  const product = await db.product.create({
    data: { slug: tag.toLowerCase(), name: `${tag} Oud`, subtitle: "t", story: "t", categoryId: category.id, family: "WOODY", model: "INCENSE" },
  });
  const mk = (suffix: string, data: { stock: number; costPrice?: number | null; reorderPoint?: number | null; reorderQty?: number | null; position: number }) =>
    db.productVariant.create({ data: { productId: product.id, sku: `${tag}-${suffix}`, label: suffix, price: 50000, supplierId: supplier.id, ...data } });
  const A = await mk("A", { stock: 10, costPrice: 10000, reorderPoint: 3, position: 0 });
  const B = await mk("B", { stock: 20, costPrice: 5000, reorderPoint: 3, position: 1 });
  const C = await mk("C", { stock: 2, costPrice: null, reorderPoint: 5, reorderQty: null, position: 2 });

  try {
    // ── 1. Pure maths ──
    ok(weightedAverageCost(10, 10000, 4, 16000) === 11714, "weighted average: 10 @ ₹100 + 4 @ ₹160 → ₹117.14");
    ok(weightedAverageCost(0, 10000, 5, 16000) === 16000 && weightedAverageCost(5, null, 5, 16000) === 16000, "weighted average: no stock or no cost → new cost");
    ok(suggestReorder({ available: 2, reorderPoint: 5, reorderQty: null, onOrder: 0 }) === 8, "suggest: reorderPoint×2 − available (2 of 5 → 8)");
    ok(suggestReorder({ available: 2, reorderPoint: 5, reorderQty: 12, onOrder: 3 }) === 9, "suggest: reorderQty minus on-order (12 − 3 → 9)");
    ok(suggestReorder({ available: 6, reorderPoint: 5, reorderQty: 12, onOrder: 0 }) === 0, "suggest: above reorder point → nothing");
    ok(suggestReorder({ available: 0, reorderPoint: 5, reorderQty: null, onOrder: 10 }) === 0, "suggest: fully covered by open POs → nothing");
    ok(suggestReorder({ available: -1, reorderPoint: 0, reorderQty: null, onOrder: 0 }) === 1, "suggest: oversold with zero reorder point → at least 1");

    // ── 2. Purchase order: create, lock, receive partially then fully ──
    const po = await createPurchaseOrder({ supplierId: supplier.id, actorId: user.id, lines: [{ variantId: A.id, quantity: 10, unitCost: 16000 }, { variantId: B.id, quantity: 5 }] });
    ok(/^PO-\d{2}\d{3,}$/.test(po.number), `PO number format (${po.number})`);
    const yy = String(new Date().getFullYear() % 100).padStart(2, "0");
    ok(po.number.startsWith(`PO-${yy}`) && (await nextPoNumber()) !== po.number, "PO number uses the year and advances");
    const lines = await db.purchaseOrderItem.findMany({ where: { poId: po.id } });
    const lineA = lines.find((l) => l.variantId === A.id)!;
    const lineB = lines.find((l) => l.variantId === B.id)!;
    ok(lineB.unitCost === 5000, `unit cost defaults to the variant's cost price (${lineB.unitCost})`);

    const settled = await Promise.allSettled([1, 2, 3].map(() => createPurchaseOrder({ supplierId: supplier.id, actorId: user.id })));
    const parallel = settled.flatMap((x) => (x.status === "fulfilled" ? [x.value] : []));
    if (parallel.length !== 3) throw (settled.find((x) => x.status === "rejected") as PromiseRejectedResult).reason;
    const seqs = [po, ...parallel].map((p) => Number(p.number.slice(5))).sort((x, y) => x - y);
    ok(seqs.every((n, i) => i === 0 || n === seqs[i - 1] + 1), `PO numbers are sequential (${seqs.join(", ")})`);
    ok(new Set(parallel.map((p) => p.number)).size === 3, `concurrent drafts get distinct numbers (${parallel.map((p) => p.number).join(", ")})`);
    await cancelPurchaseOrder(parallel[0].id);
    ok((await db.purchaseOrder.findUniqueOrThrow({ where: { id: parallel[0].id } })).status === "CANCELLED", "draft can be cancelled");

    await rejects(receivePurchaseOrder(po.id, [{ itemId: lineA.id, quantity: 1 }], { actorId: user.id }), PurchasingError, "can't receive a draft");
    ok((await onOrderByVariant(db, [A.id])).get(A.id) === undefined, "drafts don't count as on order");
    await markOrdered(po.id);
    const ordered = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    ok(ordered.status === "ORDERED" && ordered.orderedAt !== null, "mark ordered sets status and orderedAt");
    await rejects(addPoLines(po.id, [{ variantId: C.id, quantity: 1 }]), PurchasingError, "lines are locked once ordered");
    ok((await onOrderByVariant(db, [A.id])).get(A.id) === 10, "ordered quantity shows as on order");

    let r = await receivePurchaseOrder(po.id, [{ itemId: lineA.id, quantity: 4 }], { actorId: user.id });
    let a = await variant(A.id);
    ok(r.status === "PARTIAL" && a.stock === 14, `partial receipt → PARTIAL, stock 10 → ${a.stock}`);
    ok(a.costPrice === 11714, `cost re-averaged after partial receipt (${a.costPrice})`);
    ok((await onOrderByVariant(db, [A.id])).get(A.id) === 6, "on order drops to the outstanding 6");

    // ── 3. Over-receive guard ──
    await rejects(receivePurchaseOrder(po.id, [{ itemId: lineA.id, quantity: 7 }], { actorId: user.id }), PurchasingError, "receiving more than outstanding is refused");
    await rejects(
      receivePurchaseOrder(po.id, [{ itemId: lineB.id, quantity: 5 }, { itemId: lineA.id, quantity: 7 }], { actorId: user.id }),
      PurchasingError,
      "a bad line rolls back the whole receipt",
    );
    ok((await variant(B.id)).stock === 20 && (await db.purchaseOrderItem.findUniqueOrThrow({ where: { id: lineB.id } })).received === 0, "nothing applied from the rejected receipt");

    r = await receivePurchaseOrder(po.id, [{ itemId: lineA.id, quantity: 6 }, { itemId: lineB.id, quantity: 5 }], { actorId: user.id });
    a = await variant(A.id);
    const done = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    ok(r.status === "RECEIVED" && done.receivedAt !== null && a.stock === 20, `full receipt → RECEIVED with receivedAt, stock ${a.stock}`);
    ok(a.costPrice === 13000, `weighted average after second receipt: 14 @ 117.14 + 6 @ 160 → ${a.costPrice}`);
    ok((await variant(B.id)).costPrice === 5000, "same-cost receipt keeps the cost price");
    const logs = await db.inventoryLog.findMany({ where: { variantId: { in: [A.id, B.id] }, reason: "PO_RECEIVE" } });
    ok(logs.length === 3 && logs.reduce((t, l) => t + l.delta, 0) === 15 && logs.every((l) => l.actorId === user.id), "each receipt line logged as PO_RECEIVE with the actor");
    await rejects(cancelPurchaseOrder(po.id), PurchasingError, "a received PO can't be cancelled");
    ok((await supplierSpend(supplier.id)).get(supplier.id) === 10 * 16000 + 5 * 5000, "supplier spend = received × unit cost");

    const po2 = await createPurchaseOrder({ supplierId: supplier.id, actorId: user.id, lines: [{ variantId: B.id, quantity: 1, unitCost: 5000 }] });
    await markOrdered(po2.id);
    const item2 = await db.purchaseOrderItem.findFirstOrThrow({ where: { poId: po2.id } });
    await rejects(receivePurchaseOrder(po2.id, [{ itemId: item2.id, quantity: 2 }], { actorId: user.id }), PurchasingError, "over-receive needs the explicit flag");
    r = await receivePurchaseOrder(po2.id, [{ itemId: item2.id, quantity: 2 }], { actorId: user.id, overReceive: true });
    ok(r.status === "RECEIVED" && (await db.purchaseOrderItem.findUniqueOrThrow({ where: { id: item2.id } })).received === 2, "over-receive with the flag records 2 of 1");

    // ── 4. Reorder suggestions ──
    let groups = await reorderSuggestions(db, { threshold: 10 });
    const mine = groups.find((g) => g.supplier?.id === supplier.id);
    let lineC = mine?.lines.find((l) => l.variantId === C.id);
    ok(lineC?.suggested === 8 && !mine?.lines.some((l) => l.variantId === A.id), `C (2 of 5) suggested 8, A (20 > 3) not suggested`);
    ok(lineC?.unitCost === null, "no last cost known for C");
    const po3 = await createPurchaseOrder({ supplierId: supplier.id, actorId: user.id, lines: [{ variantId: C.id, quantity: 3, unitCost: 7000 }] });
    await markOrdered(po3.id);
    groups = await reorderSuggestions(db, { threshold: 10 });
    lineC = groups.find((g) => g.supplier?.id === supplier.id)?.lines.find((l) => l.variantId === C.id);
    ok(lineC?.suggested === 5 && lineC.onOrder === 3 && lineC.unitCost === 7000, `open PO counts: suggested ${lineC?.suggested}, on order ${lineC?.onOrder}, last cost ${lineC?.unitCost}`);
    await db.productVariant.update({ where: { id: C.id }, data: { reorderQty: 12 } });
    const draft = await createDraftFromSuggestions(supplier.id, user.id);
    const draftLines = await db.purchaseOrderItem.findMany({ where: { poId: draft.id } });
    ok(draftLines.length === 1 && draftLines[0].variantId === C.id && draftLines[0].quantity === 9 && draftLines[0].unitCost === 7000, "draft from suggestions: reorderQty 12 − 3 on order = 9 @ last cost");
    const low = await lowStockItems();
    ok(low.some((i) => i.sku === C.sku && i.onOrder === 3), "low-stock digest lists C with its on-order quantity");
    // (react-dom/server isn't available under the react-server condition, so check the element tree instead of HTML.)
    const email = LowStockEmail({ items: low.filter((i) => i.sku === C.sku), day: "2026-01-01" });
    ok(isValidElement(email) && JSON.stringify(email.props).includes(C.sku), "low-stock email lists the variant");

    // ── 5. Stocktake with a concurrent movement ──
    const take = await createStockTake({ name: `${tag} count`, scope: { kind: "supplier", supplierId: supplier.id }, actorId: user.id });
    const tLines = await db.stockTakeLine.findMany({ where: { stockTakeId: take.id }, include: { variant: { select: { stock: true } } } });
    const tA = tLines.find((l) => l.variantId === A.id)!;
    const tB = tLines.find((l) => l.variantId === B.id)!;
    ok(take.lines === 3 && tA.expected === 20 && tB.expected === 27, `snapshot expected = current stock (A ${tA.expected}, B ${tB.expected})`);
    await saveCounts(take.id, [{ lineId: tA.id, counted: 18 }, { lineId: tB.id, counted: 27 }]);
    // A sale lands between the snapshot and completion.
    await db.$transaction((tx) => adjustStock(tx, A.id, -3, "ADJUST", user.id));
    ok((await stockTakeDrift(take.id)).length === 1, "drift detected on A");
    await rejects(completeStockTake(take.id, { actorId: user.id }), StockTakeError, "completion warns when stock moved since the snapshot");
    const res = await completeStockTake(take.id, { actorId: user.id, acknowledgeDrift: true });
    a = await variant(A.id);
    ok(a.stock === 15 && res.adjusted === 1 && res.units === -2, `variance −2 applied to current stock 17 → ${a.stock}`);
    ok(res.value === -2 * 13000, `variance at cost ${res.value}`);
    ok((await variant(B.id)).stock === 27 && (await variant(C.id)).stock === 2, "zero-variance and uncounted lines unchanged");
    ok((await db.inventoryLog.count({ where: { variantId: A.id, reason: "STOCKTAKE", delta: -2 } })) === 1, "STOCKTAKE movement logged");
    await rejects(saveCounts(take.id, [{ lineId: tA.id, counted: 1 }]), StockTakeError, "completed stocktake is read-only");
    await rejects(completeStockTake(take.id, { actorId: user.id, acknowledgeDrift: true }), StockTakeError, "can't complete twice");

    // ── 6. CSV import: dry-run vs apply ──
    ok(parseCsv('sku,note\r\n"X","a ""quoted"", comma"\n').at(-1)?.cells[1] === 'a "quoted", comma', "CSV parser handles quotes and commas");
    const bad = `sku,stock,costPrice,reorderPoint,barcode\n${A.sku},30,99.50,-,${tag}-BC\nNOPE-${tag},1,,,\n${B.sku},abc,,,\n${C.sku},,,,${tag}-BC\n`;
    const badPlan = await planImport(bad);
    ok(badPlan.errors.length === 3 && badPlan.errors.some((e) => e.message.startsWith("Unknown SKU")), `errors reported: ${badPlan.errors.map((e) => `L${e.line} ${e.message}`).join(" | ")}`);
    await rejects(applyImport(bad, user.id), ImportRejected, "apply refuses a file with errors");
    ok((await variant(A.id)).stock === 15, "nothing applied from the bad file");
    ok((await db.productVariant.count({ where: { sku: `NOPE-${tag}` } })) === 0, "unknown SKU was not created");

    const good = `product,sku,stock,costPrice,reorderPoint,reorderQty,barcode\n"${tag} Oud",${A.sku},30,99.50,-,,${tag}-BC\n"x",${B.sku},27,,,,\n`;
    const plan = await planImport(good);
    const pA = plan.rows.find((x) => x.sku === A.sku);
    ok(!plan.errors.length && plan.rows.length === 1 && plan.unchanged === 1, `dry-run: 1 change, 1 unchanged (${plan.errors.map((e) => e.message).join("; ")})`);
    ok(
      JSON.stringify(pA?.changes) ===
        JSON.stringify([
          { field: "stock", from: 15, to: 30 },
          { field: "costPrice", from: 13000, to: 9950 },
          { field: "reorderPoint", from: 3, to: null },
          { field: "barcode", from: null, to: `${tag}-BC` },
        ]),
      "dry-run diff shows before → after",
    );
    a = await variant(A.id);
    ok(a.stock === 15 && a.costPrice === 13000 && a.barcode === null, "dry-run writes nothing");
    const applied = await applyImport(good, user.id);
    a = await variant(A.id);
    ok(applied.updated === 1 && applied.stockMoves === 1 && a.stock === 30 && a.costPrice === 9950 && a.reorderPoint === null && a.barcode === `${tag}-BC`, "apply updates stock, cost, reorder point and barcode");
    ok((await db.inventoryLog.count({ where: { variantId: A.id, reason: "ADJUST", delta: 15, actorId: user.id } })) === 1, "imported stock change logged as ADJUST");
    await db.productVariant.update({ where: { id: B.id }, data: { reserved: 5 } });
    const below = await planImport(`sku,stock\n${B.sku},4\n`);
    ok(below.errors.length === 1 && /reserved/.test(below.errors[0].message), "import refuses stock below reserved");
    await db.productVariant.update({ where: { id: B.id }, data: { reserved: 0 } });
    const swap = await planImport(`sku,barcode\n${B.sku},${tag}-BC\n`);
    ok(swap.errors.length === 1 && /already belongs/.test(swap.errors[0].message), "barcode already used elsewhere is rejected");
    const moved = await applyImport(`sku,barcode\n${B.sku},${tag}-BC\n${A.sku},${tag}-BC2\n`, user.id);
    ok(moved.updated === 2 && (await variant(B.id)).barcode === `${tag}-BC` && (await variant(A.id)).barcode === `${tag}-BC2`, "barcode can move between variants in one file");

    // ── 7. Digest once per day ──
    const day = "1999-01-01";
    ok((await claimDigestDay(day)) === true && (await claimDigestDay(day)) === false, "digest day can be claimed only once");
  } catch (e) {
    console.error("FAIL  unexpected error:", e);
    process.exitCode = 1;
  } finally {
    // ── Clean up ── (runs even after a failure; a cleanup error is reported, not allowed to hide the real one)
    await db.purchaseOrder.deleteMany({ where: { supplierId: supplier.id } });
    await db.stockTake.deleteMany({ where: { createdById: user.id } });
    await db.product.delete({ where: { id: product.id } }); // variants + their inventory logs cascade
    await db.category.delete({ where: { id: category.id } });
    await db.supplier.delete({ where: { id: supplier.id } });
    await db.auditLog.deleteMany({ where: { actorId: user.id } });
    await db.user.delete({ where: { id: user.id } });
    if (digestBefore) await db.setting.update({ where: { key: LOW_STOCK_DIGEST_KEY }, data: { value: digestBefore.value ?? {} } });
    else await db.setting.deleteMany({ where: { key: LOW_STOCK_DIGEST_KEY } });

    const realStockAfter = await db.productVariant.findMany({ select: { id: true, stock: true, reserved: true, costPrice: true } });
    const key = (v: { id: string; stock: number; reserved: number; costPrice: number | null }) => `${v.id}:${v.stock}:${v.reserved}:${v.costPrice}`;
    ok(JSON.stringify(realStockAfter.map(key).sort()) === JSON.stringify(realStockBefore.map(key).sort()), "real catalogue stock unchanged; test data removed");
    console.log("cleaned up");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
