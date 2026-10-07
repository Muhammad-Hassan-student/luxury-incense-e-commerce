// Trade (wholesale) checks against the local database: pricing, case packs, minimums, credit, stock,
// invoices, quotes, suspension, mark-paid and loyalty. Creates and cleans up its own data; stock is restored.
// Run: npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/trade-check.ts
//
// Emails go to the console: the Resend key is blanked before any module reads the environment.
process.env.RESEND_API_KEY = "";

// A module (not a global script), so helpers don't clash with other check scripts.
export {};

const DOMAIN = "trade-check.invalid";
const addr = { fullName: "Trade Check", phone: "+919811111111", line1: "12 Khan Market", city: "New Delhi", state: "DL", postalCode: "110003", country: "IN" };
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};

async function main() {
  await import("dotenv/config");
  const { db } = await import("@/server/db");
  const trade = await import("@/server/trade");
  const quotes = await import("@/server/trade-quotes");
  const rules = await import("@/components/trade/trade-rules");
  const inv = await import("@/server/invoices");
  const { cancelOrder } = await import("@/server/orders");
  const { getSettings } = await import("@/server/settings");
  const { TradeError } = trade;

  /** Runs fn and reports whether it threw a TradeError whose message matches. */
  async function rejects(fn: () => Promise<unknown>, match: RegExp, msg: string) {
    try {
      await fn();
      ok(false, `${msg} (did not throw)`);
    } catch (e) {
      ok(e instanceof TradeError && match.test(e.message), `${msg}: ${(e as Error).message}`);
    }
  }

  const tag = Date.now().toString(36);
  const A_SKU = "GUGGAL-DHOOP-24-CONES";
  const B_SKU = "HIMALAYAN-CEDAR-20-STICKS";
  const [A0, B0] = await Promise.all([A_SKU, B_SKU].map((sku) => db.productVariant.findUniqueOrThrow({ where: { sku } })));
  const snapshot = [A0, B0].map((v) => ({ id: v.id, stock: v.stock, reserved: v.reserved, caseSize: v.caseSize, tradeMinQty: v.tradeMinQty, tradeEnabled: v.tradeEnabled }));
  if (A0.stock - A0.reserved < 40 || B0.stock - B0.reserved < 10) throw new Error("Test variants need free stock (A ≥ 40, B ≥ 10)");

  let userId: string | null = null;
  let tierId: string | null = null;
  try {
    // Case packs: A sells in cases of 6, minimum 12; B singly.
    await db.productVariant.update({ where: { id: A0.id }, data: { caseSize: 6, tradeMinQty: 12, tradeEnabled: true } });
    await db.productVariant.update({ where: { id: B0.id }, data: { caseSize: 1, tradeMinQty: 1, tradeEnabled: true } });

    const user = await db.user.create({ data: { email: `buyer-${tag}@${DOMAIN}`, name: "Trade Check" } });
    userId = user.id;
    const tier = await db.priceTier.create({ data: { name: `Check tier ${tag}`, discountPercent: 15, minOrderValue: 100_000 } });
    tierId = tier.id;
    await db.tradePrice.create({ data: { tierId: tier.id, variantId: B0.id, price: 30_001 } });

    // ── Pricing ──
    ok(rules.tradeUnitPrice(36_000, 15) === 30_600, "tier discount: ₹360 less 15% = ₹306");
    ok(rules.tradeUnitPrice(39_999, 15) === 33_999 && rules.tradeUnitPrice(1, 50) === 1 && rules.tradeUnitPrice(333, 10) === 300, "rounding to the paisa (33999.15 → 33999, 0.5 → 1, 299.7 → 300)");
    ok(rules.tradeUnitPrice(39_000, 15, 30_001) === 30_001, "per-variant override wins over the tier discount");
    const cat = await trade.tradeCatalogue(tier);
    const rowA = cat.find((r) => r.variantId === A0.id);
    const rowB = cat.find((r) => r.variantId === B0.id);
    ok(rowA?.trade === 30_600 && rowA.retail === 36_000 && !rowA.override && rowA.caseSize === 6 && rowA.minQty === 12, `catalogue A: trade ${rowA?.trade}, case ${rowA?.caseSize}, min ${rowA?.minQty}`);
    ok(rowB?.trade === 30_001 && rowB.override, `catalogue B uses the override (${rowB?.trade})`);
    ok(!cat.some((r) => r.sku.startsWith("GIFT-CARD") || r.productSlug === trade.COFFRET_SLUG), "catalogue excludes gift cards and the build-your-coffret product");
    await db.productVariant.update({ where: { id: B0.id }, data: { tradeEnabled: false } });
    ok(!(await trade.tradeCatalogue(tier)).some((r) => r.variantId === B0.id), "trade-disabled variants are hidden");
    await db.productVariant.update({ where: { id: B0.id }, data: { tradeEnabled: true } });

    // ── Case size & minimum quantity ──
    ok(rules.quantityProblem(6, 6, 12) === "Minimum 12", "6 of a 6-case with min 12 → minimum");
    ok(rules.quantityProblem(13, 6, 12) === "Order in cases of 6", "13 of a 6-case → case multiple");
    ok(rules.quantityProblem(12, 6, 12) === null && rules.quantityProblem(18, 6, 12) === null && rules.quantityProblem(0, 6, 12) === null, "12 and 18 valid, 0 = not ordering");
    ok(rules.quantityProblem(2.5, 1, 1) !== null && rules.quantityProblem(-1, 1, 1) !== null, "fractions and negatives rejected");
    ok(rules.roundUpQty(13, 6, 12) === 18 && rules.roundUpQty(1, 6, 12) === 12, "round up to a valid quantity");

    const account = await db.tradeAccount.create({
      data: {
        userId: user.id,
        status: "APPROVED",
        businessName: `Check Boutique ${tag}`,
        businessType: "RETAILER",
        contactName: "Trade Check",
        phone: addr.phone,
        taxId: "07AAAAA0000A1Z5",
        address: addr,
        tierId: tier.id,
        terms: "NET_30",
        creditLimit: 600_000,
      },
    });
    const acc = { tierId: tier.id, tier };
    await rejects(() => trade.priceTradeLines(acc, [{ variantId: A0.id, quantity: 13 }]), /cases of 6/, "server rejects a non-case quantity");
    await rejects(() => trade.priceTradeLines(acc, [{ variantId: A0.id, quantity: 6 }]), /Minimum 12/, "server rejects below the trade minimum");
    await rejects(() => trade.priceTradeLines(acc, [{ variantId: A0.id, quantity: 6 }, { variantId: A0.id, quantity: 6 }]).then(() => { throw new TradeError("merged OK"); }), /merged OK/, "duplicate lines merge per variant before validation (6 + 6 = 12)");
    const gift = await db.productVariant.findFirstOrThrow({ where: { product: { isGiftCard: true } } });
    await rejects(() => trade.priceTradeLines(acc, [{ variantId: gift.id, quantity: 1 }]), /no longer available/, "gift cards can't be ordered on trade");

    const base = { accountId: account.id, address: addr, shippingRateId: "ship-in" };

    // ── Minimum order value ──
    await rejects(() => trade.placeTradeOrder({ ...base, lines: [{ variantId: B0.id, quantity: 1 }] }), /minimum order is/, "order under the tier minimum is refused");
    await db.tradeAccount.update({ where: { id: account.id }, data: { minOrderValue: 20_000 } });
    ok(rules.minimumOrderFor({ minOrderValue: 20_000 }, tier) === 20_000 && rules.minimumOrderFor({ minOrderValue: 0 }, tier) === 100_000, "account minimum overrides the tier's; 0 falls back to the tier");
    await db.tradeAccount.update({ where: { id: account.id }, data: { minOrderValue: 0 } });

    // ── Stock reserve & commit, totals vs invoice ──
    const before = await db.productVariant.findUniqueOrThrow({ where: { id: A0.id } });
    const o1 = await trade.placeTradeOrder({ ...base, lines: [{ variantId: A0.id, quantity: 12 }], poNumber: "PO-CHECK-1" });
    const after = await db.productVariant.findUniqueOrThrow({ where: { id: A0.id } });
    ok(after.stock === before.stock - 12 && after.reserved === before.reserved, `stock committed (${before.stock} → ${after.stock}, reserved ${after.reserved})`);
    const logs = await db.inventoryLog.findMany({ where: { orderId: o1.id }, orderBy: { createdAt: "asc" } });
    ok(logs.some((l) => l.reason === "RESERVE") && logs.some((l) => l.reason === "SALE" && l.delta === -12), "inventory log shows RESERVE then SALE");
    const order1 = await db.order.findUniqueOrThrow({ where: { id: o1.id }, include: { payments: true, items: true } });
    const settings = await getSettings();
    const expectedTax = settings.taxInclusive ? Math.round(367_200 - 367_200 / (1 + settings.taxRatePercent / 100)) : Math.round(367_200 * (settings.taxRatePercent / 100));
    ok(order1.subtotal === 367_200 && order1.items[0].unitPrice === 30_600 && order1.shipping === 0 && order1.tax === expectedTax, `order totals: subtotal ${order1.subtotal}, shipping ${order1.shipping} (free over threshold), tax ${order1.tax}`);
    ok(order1.total === 367_200 + (settings.taxInclusive ? 0 : expectedTax), `order total ${order1.total}`);
    ok(order1.payments.length === 1 && order1.payments[0].provider === "INVOICE" && order1.payments[0].status === "CREATED" && order1.payments[0].amount === order1.total, "one INVOICE payment, not captured");
    ok(order1.status === "PENDING" && order1.reservedUntil === null && order1.tradeAccountId === account.id && order1.poNumber === "PO-CHECK-1", "confirmed via confirmOrder (PENDING, no hold), PO stored");
    const dueDays = Math.round((order1.dueDate!.getTime() - order1.placedAt.getTime()) / 86_400_000);
    ok(dueDays === 30, `NET_30 due date = placed + ${dueDays} days`);
    ok(order1.discount === 0 && order1.pointsRedeemed === 0 && order1.giftCardAmount === 0 && !order1.couponCode, "no coupons, points or gift cards on trade orders");

    const invoice = await inv.getCustomerInvoice(user.id, order1.number);
    ok(Boolean(invoice), "invoice available for the confirmed trade order");
    if (invoice) {
      const lineSum = invoice.lines.reduce((s, l) => s + l.amount, 0);
      ok(invoice.total === order1.total && invoice.subtotal === order1.subtotal && invoice.tax.amount === order1.tax && invoice.shippingAndWrap === order1.shipping, "invoice totals equal the order totals");
      ok(lineSum === invoice.subtotal, `invoice lines sum to the subtotal (${lineSum})`);
      const recon = invoice.tax.inclusive ? invoice.tax.taxableValue + invoice.tax.amount === lineSum : invoice.tax.taxableValue === lineSum && lineSum + invoice.tax.amount + invoice.shippingAndWrap === invoice.total;
      ok(recon, `tax reconciles (taxable ${invoice.tax.taxableValue} + GST ${invoice.tax.amount}, ${invoice.tax.inclusive ? "inclusive" : "exclusive"})`);
      ok(!invoice.paid && invoice.amountPaid === order1.total && /Trade invoice/.test(invoice.paymentMethod), `invoice unpaid, method "${invoice.paymentMethod}"`);
    }

    // ── Loyalty ──
    const u1 = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    ok(u1.loyaltyPoints === 0 && (await db.loyaltyEntry.count({ where: { userId: user.id } })) === 0, "trade orders award no loyalty points");

    // ── Credit limit ──
    const st1 = await trade.tradeStatement({ id: account.id, creditLimit: 600_000, terms: "NET_30" });
    ok(st1.outstanding === order1.total && st1.creditAvailable === 600_000 - order1.total && st1.overdue === 0, `statement: outstanding ${st1.outstanding}, available ${st1.creditAvailable}`);
    const stockBeforeRefusal = (await db.productVariant.findUniqueOrThrow({ where: { id: A0.id } })).stock;
    await rejects(() => trade.placeTradeOrder({ ...base, lines: [{ variantId: A0.id, quantity: 12 }] }), /over your available credit/, "second order over the credit limit is refused");
    const afterRefusal = await db.productVariant.findUniqueOrThrow({ where: { id: A0.id } });
    ok(afterRefusal.stock === stockBeforeRefusal && afterRefusal.reserved === before.reserved, "refused order leaves stock untouched");
    ok((await db.order.count({ where: { tradeAccountId: account.id } })) === 1, "refused order wasn't created");

    // ── Mark invoice paid ──
    const paid = await trade.markInvoicePaid(o1.id);
    const p1 = await db.order.findUniqueOrThrow({ where: { id: o1.id }, include: { payments: true, events: true } });
    ok(paid.status === "PAID" && p1.status === "PAID" && p1.paidAt !== null && p1.payments[0].status === "CAPTURED", "mark paid: PAID, paidAt set, payment CAPTURED");
    ok(p1.events.some((e) => e.status === "PAID" && /Trade invoice paid/.test(e.message)), "mark paid adds a timeline event");
    await rejects(() => trade.markInvoicePaid(o1.id), /already marked paid/, "can't mark the same invoice paid twice");
    const consumer = await db.order.findFirst({ where: { tradeAccountId: null }, select: { id: true } });
    if (consumer) await rejects(() => trade.markInvoicePaid(consumer.id), /isn’t a trade order/, "mark paid refuses non-trade orders");
    const paidInvoice = await inv.getCustomerInvoice(user.id, order1.number);
    ok(Boolean(paidInvoice?.paid), "invoice shows as paid");
    ok(rules.invoiceState(p1) === "paid" && rules.invoiceState({ status: "PENDING", paidAt: null, dueDate: new Date(Date.now() - 1000) }) === "overdue", "invoice state: paid / overdue");

    const o2 = await trade.placeTradeOrder({ ...base, lines: [{ variantId: A0.id, quantity: 12 }] });
    ok(Boolean(o2.number), `after paying an invoice the next order is allowed (${o2.number})`);
    await trade.markInvoicePaid(o2.id);

    // ── Quote → accept → order at quoted prices ──
    const rfq = await quotes.requestQuote(account.id, {
      message: "Spring restock plus private-label tins",
      items: [
        { variantId: B0.id, description: "", quantity: 7, targetPrice: 25_000 },
        { variantId: null, description: "Private-label tins with our logo", quantity: 10, targetPrice: null },
      ],
    });
    ok(/^Q-\d{5,}$/.test(rfq.number) && rfq.status === "REQUESTED", `quote requested (${rfq.number})`);
    const items = await db.quoteItem.findMany({ where: { quoteId: rfq.id }, orderBy: { id: "asc" } });
    const [lineB, lineCustom] = items;
    const valid = new Date(Date.now() + 7 * 86_400_000);
    await quotes.replyToQuote(rfq.id, {
      validUntil: valid,
      replyMessage: "Happy to help",
      staffNotes: null,
      lines: [
        { id: lineB.id, variantId: B0.id, quantity: 7, quotedPrice: 27_000 },
        { id: lineCustom.id, variantId: null, quantity: 10, quotedPrice: 30_000 },
      ],
    });
    await rejects(() => quotes.acceptQuote({ accountId: account.id, number: rfq.number, address: addr, shippingRateId: "ship-in" }), /not linked to a catalogue item/, "quote with an unmapped free-text line can't be accepted");
    await quotes.replyToQuote(rfq.id, {
      validUntil: valid,
      replyMessage: "Mapped to our catalogue",
      staffNotes: "internal",
      lines: [
        { id: lineB.id, variantId: B0.id, quantity: 7, quotedPrice: 27_000 },
        { id: lineCustom.id, variantId: A0.id, quantity: 10, quotedPrice: 30_000 },
      ],
    });
    const qo = await quotes.acceptQuote({ accountId: account.id, number: rfq.number, address: addr, shippingRateId: "ship-in", poNumber: "PO-Q" });
    const qOrder = await db.order.findUniqueOrThrow({ where: { id: qo.id }, include: { items: { orderBy: { unitPrice: "asc" } } } });
    const qAfter = await db.quote.findUniqueOrThrow({ where: { id: rfq.id } });
    ok(qOrder.items.length === 2 && qOrder.items[0].unitPrice === 27_000 && qOrder.items[0].quantity === 7 && qOrder.items[1].unitPrice === 30_000 && qOrder.items[1].quantity === 10, "order lines at the quoted prices and quantities (case/min waived for quotes)");
    ok(qOrder.subtotal === 7 * 27_000 + 10 * 30_000 && qOrder.tradeAccountId === account.id, `quote order subtotal ${qOrder.subtotal}`);
    ok(qAfter.status === "ACCEPTED" && qAfter.orderId === qo.id, "quote marked ACCEPTED and linked to the order");
    await rejects(() => quotes.acceptQuote({ accountId: account.id, number: rfq.number, address: addr, shippingRateId: "ship-in" }), /isn’t open/, "an accepted quote can't be accepted twice");
    await trade.markInvoicePaid(qo.id);

    // ── Quote expiry ──
    const rfq2 = await quotes.requestQuote(account.id, { message: null, items: [{ variantId: B0.id, description: "", quantity: 3, targetPrice: null }] });
    const item2 = await db.quoteItem.findFirstOrThrow({ where: { quoteId: rfq2.id } });
    await quotes.replyToQuote(rfq2.id, { validUntil: new Date(Date.now() + 60_000), replyMessage: null, staffNotes: null, lines: [{ id: item2.id, variantId: B0.id, quantity: 3, quotedPrice: 30_000 }] });
    const expired = await quotes.expireQuotes({ id: rfq2.id }, new Date(Date.now() + 120_000));
    ok(expired === 1 && (await db.quote.findUniqueOrThrow({ where: { id: rfq2.id } })).status === "EXPIRED", "quote past validUntil expires when viewed");
    await rejects(() => quotes.acceptQuote({ accountId: account.id, number: rfq2.number, address: addr, shippingRateId: "ship-in" }), /isn’t open/, "an expired quote can't be accepted");
    const declined = await quotes.requestQuote(account.id, { message: null, items: [{ variantId: B0.id, description: "", quantity: 1, targetPrice: null }] });
    ok((await quotes.declineQuote(account.id, declined.number)) === "CANCELLED", "buyer can withdraw an unpriced request");

    // ── Suspended account blocked ──
    await db.tradeAccount.update({ where: { id: account.id }, data: { status: "SUSPENDED" } });
    await rejects(() => trade.placeTradeOrder({ ...base, lines: [{ variantId: A0.id, quantity: 12 }] }), /suspended/, "suspended account can't order");
    await rejects(() => quotes.requestQuote(account.id, { message: null, items: [{ variantId: B0.id, description: "", quantity: 1, targetPrice: null }] }), /suspended/, "suspended account can't request quotes");
    await db.tradeAccount.update({ where: { id: account.id }, data: { status: "PENDING" } });
    await rejects(() => trade.placeTradeOrder({ ...base, lines: [{ variantId: A0.id, quantity: 12 }] }), /under review/, "pending application can't order");
    await db.tradeAccount.update({ where: { id: account.id }, data: { status: "APPROVED" } });

    // ── Prepaid proforma ──
    await db.tradeAccount.update({ where: { id: account.id }, data: { terms: "PREPAID", creditLimit: 0 } });
    const pre = await trade.placeTradeOrder({ ...base, lines: [{ variantId: A0.id, quantity: 12 }] });
    const preOrder = await db.order.findUniqueOrThrow({ where: { id: pre.id }, include: { payments: true } });
    const preDays = Math.round((preOrder.dueDate!.getTime() - preOrder.placedAt.getTime()) / 86_400_000);
    ok(pre.proforma && preDays === 3 && /PROFORMA/.test(preOrder.notes ?? "") && (preOrder.payments[0].raw as { shipAfterPayment?: boolean }).shipAfterPayment === true, "prepaid: proforma due in 3 days, flagged ship-after-payment");
    ok(preOrder.payments[0].provider === "INVOICE" && preOrder.status === "PENDING", "prepaid: confirmed with an INVOICE payment");

    // Cancelling an unpaid trade order returns its stock and frees the balance.
    const stockBeforeCancel = (await db.productVariant.findUniqueOrThrow({ where: { id: A0.id } })).stock;
    await cancelOrder(pre.id, "trade-check cancel");
    ok((await db.productVariant.findUniqueOrThrow({ where: { id: A0.id } })).stock === stockBeforeCancel + 12, "cancelling a trade order restocks");
    ok((await trade.outstandingFor(db, account.id)) === 0, "cancelled orders don't count as outstanding");

    // Price list CSV escapes formula-looking cells.
    ok(inv.csvCell("=HYPERLINK(1)") === "'=HYPERLINK(1)" && inv.csvCell("+1") === "'+1", "CSV cells are formula-injection safe");
    const { csv, count } = await trade.priceListCsv(tier);
    ok(csv.startsWith("﻿SKU,Product,Variant,Case size,Min qty,Retail (INR),Trade price (INR),Available\r\n") && count === cat.length, `price list CSV (${count} rows)`);
    ok(csv.includes(`${A_SKU},`) && csv.includes(",306.00,") && csv.includes(",300.01,"), "price list has tier and override prices");

    ok(
      (await db.loyaltyEntry.count({ where: { userId: user.id } })) === 0 && (await db.user.findUniqueOrThrow({ where: { id: user.id } })).loyaltyPoints === 0,
      "still no loyalty after paid trade orders",
    );
  } finally {
    // Clean up everything this script created and restore the variants exactly.
    if (userId) {
      const accounts = await db.tradeAccount.findMany({ where: { userId }, select: { id: true } });
      const orders = await db.order.findMany({ where: { OR: [{ userId }, { tradeAccountId: { in: accounts.map((a) => a.id) } }] }, select: { id: true } });
      const ids = orders.map((o) => o.id);
      await db.quote.deleteMany({ where: { tradeAccountId: { in: accounts.map((a) => a.id) } } });
      await db.inventoryLog.deleteMany({ where: { orderId: { in: ids } } });
      await db.loyaltyEntry.deleteMany({ where: { userId } });
      await db.order.deleteMany({ where: { id: { in: ids } } });
      await db.tradeAccount.deleteMany({ where: { userId } });
      await db.user.delete({ where: { id: userId } });
    }
    if (tierId) await db.priceTier.deleteMany({ where: { id: tierId } });
    for (const s of snapshot) {
      await db.productVariant.update({ where: { id: s.id }, data: { stock: s.stock, reserved: s.reserved, caseSize: s.caseSize, tradeMinQty: s.tradeMinQty, tradeEnabled: s.tradeEnabled } });
    }
    const leftovers = await db.user.count({ where: { email: { endsWith: `@${DOMAIN}` } } });
    const restored = await db.productVariant.findMany({ where: { id: { in: snapshot.map((s) => s.id) } } });
    ok(leftovers === 0, "no test users left");
    ok(
      restored.every((v) => {
        const s = snapshot.find((x) => x.id === v.id)!;
        return v.stock === s.stock && v.reserved === s.reserved && v.caseSize === s.caseSize && v.tradeMinQty === s.tradeMinQty && v.tradeEnabled === s.tradeEnabled;
      }),
      "stock and trade settings restored",
    );
    console.log("cleaned up");
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
