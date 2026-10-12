// Accounting checks: GST numbering, tax splits, credit notes, GSTR-1 buckets, exports and payout reconciliation.
// Uses its own orders/products and documents dated in far-future financial years (2098-99, 2099-00) so the real
// invoice series is never touched; everything is removed afterwards.
// Run: npm run test:accounting
import "./no-real-email";
import "dotenv/config";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { accountingSettingsSchema } from "@/server/accounting/settings";
import { computeInvoice, issueInvoice, issueOrderCreditNote, issueReturnCreditNote, nextSeq } from "@/server/accounting/documents";
import { buildGstr1, documentsInRange, einvoiceFor, prepare, salesRegisterCsv, tallyCsv, tallyXml, xml, zohoCsv } from "@/server/accounting/exports";
import { importSettlement, mockSettlement, parseSettlementCsv, recordCodRemittance } from "@/server/accounting/reconciliation";
import { B2CL_THRESHOLD, apportion, financialYear, formatDocNumber, gstinCheckChar, gstr1Bucket, isValidGstin, splitTax, stateCodeFor, validDocNumber } from "@/lib/gst";

const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};

const tag = `ACCHK${Date.now().toString(36).toUpperCase()}`;
const gstin = (first14: string) => first14 + gstinCheckChar(first14);
const SELLER = gstin("29AAACM1234A1Z");
const BUYER = gstin("27AABCT9876B1Z");
const S = accountingSettingsSchema.parse({
  enabled: true,
  legalName: "Maison Oud Test Pvt Ltd",
  gstin: SELLER,
  address: "1 Test Road",
  city: "Bengaluru",
  pincode: "560001",
  invoicePrefix: "MO",
  creditNotePrefix: "CN",
  startsOn: "2000-01-01",
  defaultHsn: "33074100",
});
const FY = "2098-99";
const CRLF = String.fromCharCode(13, 10);
const at = (iso: string) => new Date(iso);

async function main() {
  const realDocs = await db.taxDocument.count({ where: { fy: { notIn: [FY, "2099-00"] } } });
  const realSetting = JSON.stringify((await db.setting.findUnique({ where: { key: "accounting" } }))?.value ?? null);
  await db.taxDocument.deleteMany({ where: { fy: { in: [FY, "2099-00"] } } }); // leftovers from an aborted run

  // ── 1. Pure GST helpers ──
  ok(isValidGstin(SELLER) && !isValidGstin(SELLER.slice(0, 14) + (SELLER[14] === "A" ? "B" : "A")) && !isValidGstin("29AAACM1234A1Z"), "GSTIN check digit validated");
  ok(stateCodeFor("KA") === "29" && stateCodeFor("Karnataka") === "29" && stateCodeFor("new delhi") === "07" && stateCodeFor("Narnia") === null, "state names/abbreviations → GST state codes");
  ok(financialYear(at("2027-03-31T23:30:00+05:30")) === "2026-27" && financialYear(at("2027-04-01T00:10:00+05:30")) === "2027-28" && financialYear(at("2027-03-31T19:00:00Z")) === "2027-28", "financial year flips at 1 April IST");
  const sample = formatDocNumber("MO", "2026-27", 123);
  ok(sample === "MO/2026-27/00123" && sample.length === 16 && validDocNumber(sample), `number format ${sample} (16 chars, IRP-valid)`);
  ok(JSON.stringify(apportion(100, [1, 1, 1])) === "[34,33,33]" && apportion(7, [0, 0]).reduce((a, b) => a + b, 0) === 7, "apportion keeps every paisa");
  ok(JSON.stringify(splitTax(3601, false)) === JSON.stringify({ cgst: 1801, sgst: 1800, igst: 0 }) && splitTax(3601, true).igst === 3601, "CGST/SGST halves vs IGST");
  const pure = computeInvoice(
    { items: [{ id: "i1", name: "Oud", label: "", sku: "X", unitPrice: 118000, quantity: 2, meta: null, hsn: "33074100" }], discount: 23600, pointsRedeemed: 0, shipping: 9900, tax: 32400, total: 222300 },
    { interState: false, taxInclusive: true },
  );
  ok(pure.taxableValue === 180000 && pure.cgst === 16200 && pure.sgst === 16200 && pure.otherCharges === 9900 && pure.taxableValue + pure.cgst + pure.sgst + pure.otherCharges === 222300, "inclusive pricing with discount + shipping reconciles to the order total");
  const excl = computeInvoice({ items: [{ id: "i1", name: "Oud", label: "", sku: "X", unitPrice: 100000, quantity: 1, meta: null, hsn: "" }], discount: 0, pointsRedeemed: 0, shipping: 0, tax: 18000, total: 118000 }, { interState: true, taxInclusive: true });
  ok(excl.taxableValue === 100000 && excl.igst === 18000, "exclusive pricing detected from the order's own figures");

  // ── Fixtures ──
  const category = await db.category.create({ data: { slug: tag.toLowerCase(), name: tag, tagline: "t", description: "t", ambient: "SMOKE", hsnCode: "33074100" } });
  const product = await db.product.create({ data: { slug: tag.toLowerCase(), name: `${tag} Oud`, subtitle: "t", story: "t", categoryId: category.id, family: "WOODY", model: "INCENSE" } });
  const V = await db.productVariant.create({ data: { productId: product.id, sku: `${tag}-V`, label: "50 ml", price: 118000, stock: 0 } });
  const buyerUser = await db.user.create({ data: { email: `${tag.toLowerCase()}-b2b@test.local`, name: "Trade buyer" } });
  const trade = await db.tradeAccount.create({
    data: { userId: buyerUser.id, status: "APPROVED", businessName: "Attar & <Co>", businessType: "RETAILER", contactName: "T", phone: "+919800000000", taxId: BUYER, address: { line1: "2 Market Rd", city: "Mumbai", state: "MH", postalCode: "400001", country: "IN" } },
  });
  const orderIds: string[] = [];
  let n = 0;
  const mk = async (o: { state: string; pin?: string; name?: string; qty?: number; unitPrice?: number; discount?: number; shipping?: number; trade?: boolean; provider?: "STRIPE" | "RAZORPAY" | "COD"; raw?: Prisma.InputJsonObject }) => {
    const qty = o.qty ?? 2;
    const unit = o.unitPrice ?? 118000;
    const goods = unit * qty - (o.discount ?? 0);
    const tax = Math.round(goods - goods / 1.18);
    const total = goods + (o.shipping ?? 0);
    const created = await db.order.create({
      data: {
        number: `${tag}-${++n}`,
        email: `${tag.toLowerCase()}@test.local`,
        status: "PAID",
        currency: "INR",
        subtotal: unit * qty,
        discount: o.discount ?? 0,
        shipping: o.shipping ?? 0,
        tax,
        total,
        tradeAccountId: o.trade ? trade.id : null,
        shippingAddress: { fullName: o.name ?? "Test Buyer", phone: "+919999999999", line1: "1 MG Road", city: "City", state: o.state, postalCode: o.pin ?? "560001", country: "IN" },
        items: { create: [{ variantId: V.id, name: `${tag} Oud`, label: "50 ml", sku: V.sku, unitPrice: unit, quantity: qty }] },
        payments: { create: { provider: o.provider ?? "STRIPE", status: "CAPTURED", amount: total, currency: "INR", providerRef: `${o.provider === "RAZORPAY" ? "order" : "pi"}_${tag}_${n}`, raw: o.raw ?? {} } },
        events: { create: { status: "PAID", message: "Payment received" } },
      },
      include: { items: true, payments: true },
    });
    orderIds.push(created.id);
    return created;
  };

  try {
    // ── 2. Gap-free numbering, concurrent issuers ──
    const batch = await Promise.all([1, 2, 3, 4, 5].map(() => mk({ state: "KA" })));
    const docs = await Promise.all(batch.map((o) => issueInvoice(o.id, { settings: S, at: at("2098-06-15T12:00:00+05:30") })));
    const seqs = docs.map((d) => d!.seq).sort((a, b) => a - b);
    ok(JSON.stringify(seqs) === "[1,2,3,4,5]", `five concurrent invoices numbered 1–5 with no gaps (${docs.map((d) => d!.number).join(", ")})`);
    ok(docs.every((d) => d!.fy === FY && d!.number.startsWith(`MO/${FY}/`)), "numbers carry the financial year");
    const again = await issueInvoice(batch[0].id, { settings: S, at: at("2098-06-20T12:00:00+05:30") });
    ok(again?.id === docs[0]!.id, "issuing twice returns the same invoice (idempotent)");
    await db.$transaction(async (tx) => {
      await nextSeq(tx, "INVOICE", FY);
      throw new Error("rollback");
    }).catch(() => {});
    const o6 = await mk({ state: "KA", discount: 23600, shipping: 9900 });
    const d6 = (await issueInvoice(o6.id, { settings: S, at: at("2099-03-31T22:00:00+05:30") }))!;
    ok(d6.seq === 6 && d6.fy === FY, `a rolled-back issue doesn't burn a number (next is ${d6.number})`);
    const o7 = await mk({ state: "KA" });
    const d7 = (await issueInvoice(o7.id, { settings: S, at: at("2099-04-01T00:30:00+05:30") }))!;
    ok(d7.fy === "2099-00" && d7.seq === 1, `new financial year restarts at 1 (${d7.number})`);

    // ── 3. CGST/SGST vs IGST ──
    const intra = docs[0]!;
    ok(!intra.interState && intra.placeOfSupply === "29" && intra.cgst === 18000 && intra.sgst === 18000 && intra.igst === 0 && intra.taxableValue === 200000, "Karnataka delivery from Karnataka: CGST 9% + SGST 9%");
    ok(d6.taxableValue === 180000 && d6.otherCharges === 9900 && d6.total === 222300, "discount and shipping reflected (shipping as other charges)");
    const oDl = await mk({ state: "Delhi", pin: "110001" });
    const dDl = (await issueInvoice(oDl.id, { settings: S, at: at("2098-07-01T12:00:00+05:30") }))!;
    ok(dDl.interState && dDl.placeOfSupply === "07" && dDl.igst === 36000 && dDl.cgst + dDl.sgst === 0, "Delhi delivery: IGST 18%");
    const oB2b = await mk({ state: "MH", pin: "400001", trade: true });
    const dB2b = (await issueInvoice(oB2b.id, { settings: S, at: at("2098-07-02T12:00:00+05:30") }))!;
    ok(dB2b.b2b && dB2b.buyerGstin === BUYER && dB2b.buyerName === "Attar & <Co>" && dB2b.igst === 36000, "trade buyer with a valid GSTIN → B2B invoice with GSTIN");
    const oLarge = await mk({ state: "DL", pin: "110002", qty: 1, unitPrice: 11800000, name: '=HYPERLINK("http://evil.test","x")' });
    const dLarge = (await issueInvoice(oLarge.id, { settings: S, at: at("2098-07-03T12:00:00+05:30") }))!;
    ok(dLarge.total > B2CL_THRESHOLD && gstr1Bucket(dLarge) === "B2CL" && gstr1Bucket(intra) === "B2CS" && gstr1Bucket(dB2b) === "B2B", "GSTR-1 buckets: B2B / B2C large / B2C small");
    ok((intra.lines as { hsn: string }[])[0].hsn === "33074100", "HSN taken from the category");

    // ── 4. Credit notes: return refund, then full refund ──
    const oRet = batch[1];
    const ret = await db.returnRequest.create({
      data: { number: `${tag}-RMA`, orderId: oRet.id, reason: "Changed mind", status: "REFUNDED", resolution: "REFUND", refundAmount: 106200, restockingFee: 11800, providerAmount: 106200, resolvedAt: at("2098-08-01T12:00:00+05:30"), items: { create: { orderItemId: oRet.items[0].id, quantity: 1 } } },
    });
    const cnRet = (await issueReturnCreditNote(ret.id, { settings: S }))!;
    ok(cnRet.kind === "CREDIT_NOTE" && cnRet.number === `CN/${FY}/00001` && cnRet.total === 106200 && cnRet.cgst + cnRet.sgst === 16200 && cnRet.invoiceId === docs[1]!.id, `return refund → credit note ${cnRet.number} for ₹1,062 (after the restocking fee)`);
    await db.order.update({ where: { id: oRet.id }, data: { status: "REFUNDED", events: { create: { status: "REFUNDED", message: "Refunded" } } } });
    await db.payment.updateMany({ where: { orderId: oRet.id }, data: { status: "REFUNDED" } });
    const cnRest = (await issueOrderCreditNote(oRet.id, { settings: S, at: at("2098-08-05T12:00:00+05:30") }))!;
    ok(cnRest.seq === 2 && cnRest.total === 236000 - 106200 && cnRest.taxableValue + cnRest.cgst + cnRest.sgst === 129800, `full refund afterwards credits only the remainder (${cnRest.number}: ₹1,298)`);
    ok((await issueOrderCreditNote(oRet.id, { settings: S }))?.id === cnRest.id, "credit note issuance is idempotent");
    await db.order.update({ where: { id: oB2b.id }, data: { status: "CANCELLED", events: { create: { status: "CANCELLED", message: "Cancelled by store" } } } });
    const cnB2b = (await issueOrderCreditNote(oB2b.id, { settings: S, at: at("2098-08-06T12:00:00+05:30") }))!;
    ok(cnB2b.total === dB2b.total && cnB2b.b2b && cnB2b.igst === dB2b.igst, "cancelled B2B invoice → full credit note");

    // ── 5. GSTR-1 ──
    const range = await documentsInRange("2098-04-01", "2099-03-31");
    const ctx = await prepare(range);
    const g = buildGstr1(range, { gstin: SELLER, invoiceTotals: ctx.totals, invoiceNumbers: ctx.numbers, invoiceDates: ctx.dates }, at("2098-07-01T12:00:00+05:30"));
    ok(g.summary.b2b.count === 1 && g.summary.b2cl.count === 1 && g.summary.b2cs.count === 7, `GSTR-1 invoices: B2B ${g.summary.b2b.count}, B2CL ${g.summary.b2cl.count}, B2CS ${g.summary.b2cs.count}`);
    ok(g.summary.cdnr.count === 1 && g.summary.b2csNotes.count === 2 && g.json.cdnr[0]?.ctin === BUYER, "credit notes: registered → CDNR, small unregistered → netted in B2CS");
    const b2csKa = g.json.b2cs.find((r) => r.pos === "29" && r.sply_ty === "INTRA");
    const kaInvoices = range.filter((d) => d.kind === "INVOICE" && d.placeOfSupply === "29");
    const kaNotes = range.filter((d) => d.kind === "CREDIT_NOTE" && d.placeOfSupply === "29");
    const expectKa = kaInvoices.reduce((s, d) => s + d.taxableValue, 0) - kaNotes.reduce((s, d) => s + d.taxableValue, 0);
    ok(b2csKa !== undefined && Math.round(b2csKa.txval * 100) === expectKa, `B2CS row for Karnataka nets credit notes (₹${b2csKa?.txval})`);
    const hsn = g.json.hsn.hsn_b2c.find((h) => h.hsn_sc === "33074100");
    ok(Boolean(hsn) && g.json.hsn.hsn_b2b.length === 1 && (hsn?.qty ?? 0) > 0, "HSN summary split into B2B and B2C");
    ok(g.json.doc_issue.doc_det.length === 2 && g.json.fp === "072098", "document series and return period present");

    // ── 6. Exports ──
    const register = salesRegisterCsv(range, ctx);
    const rows = register.trimEnd().split("\r\n");
    ok(rows.length === range.length + 1 && rows[0].startsWith("﻿Type,Number,Date"), `sales register: header + ${range.length} rows`);
    ok(register.includes(`"'=HYPERLINK(""http://evil.test"",""x"")"`) && !register.includes(',=HYPERLINK'), "formula injection neutralised in the sales register");
    ok(register.includes("Credit note") && register.includes("-1062.00"), "credit notes negative in the register");
    const tcsv = tallyCsv(range, S);
    ok(!/(^|,)=/m.test(tcsv) && tcsv.split(CRLF).length > range.length, "Tally CSV: one row per ledger entry, no cell starts with =");
    const txml = tallyXml(range, S, ctx.numbers);
    const vouchers = txml.split("<VOUCHER ").slice(1);
    const balanced = vouchers.every((v) => Math.abs([...v.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].reduce((s, m) => s + Number(m[1]), 0)) < 0.005);
    ok(vouchers.length === range.length && balanced, `Tally XML: ${vouchers.length} vouchers, each balanced (Dr = Cr)`);
    ok(txml.includes("Attar &amp; &lt;Co&gt;") && !txml.includes("<Co>") && txml.includes('VCHTYPE="Credit Note"') && xml("a\u0001b") === "ab", "Tally XML escaped; credit notes as Credit Note vouchers");
    const zoho = zohoCsv(range, "INVOICE", ctx.numbers);
    const zrows = zoho.trimEnd().split("\r\n");
    ok(zrows[0].startsWith("﻿Invoice Date,Invoice Number,Invoice Status,Customer Name,GST Treatment") && zrows.length === range.filter((d) => d.kind === "INVOICE").length + 1, "Zoho Books invoice CSV: expected columns, one row per line item");
    ok(zoho.includes("business_gst") && zoho.includes("IGST18") && zoho.includes("GST18") && zoho.includes("'=HYPERLINK"), "Zoho: GST treatment, tax groups and injection guard");
    const zcn = zohoCsv(range, "CREDIT_NOTE", ctx.numbers);
    ok(zcn.includes("Credit Note Number") && zcn.includes(docs[1]!.number), "Zoho credit notes reference their invoice");

    // ── 7. E-invoice JSON ──
    const b2bDoc = range.find((d) => d.id === dB2b.id)!;
    const e = einvoiceFor(b2bDoc, S, ctx.numbers, ctx.dates);
    const j = e.json as { Version: string; DocDtls: { Typ: string; No: string; Dt: string }; BuyerDtls: { Gstin: string; Pos: string; Pin: number }; ItemList: { TotItemVal: number; HsnCd: string }[]; ValDtls: { TotInvVal: number; OthChrg: number; IgstVal: number } } | null;
    ok(e.problems.length === 0 && j?.Version === "1.1" && j.DocDtls.Typ === "INV" && j.DocDtls.No === dB2b.number && j.BuyerDtls.Gstin === BUYER && j.BuyerDtls.Pos === "27" && j.BuyerDtls.Pin === 400001, "e-invoice v1.1 JSON for the B2B invoice");
    ok(j !== null && Math.abs(j.ItemList.reduce((s, i) => s + i.TotItemVal, 0) + j.ValDtls.OthChrg - j.ValDtls.TotInvVal) < 0.01 && j.ValDtls.TotInvVal === dB2b.total / 100 && j.ItemList[0].HsnCd === "33074100", "e-invoice values add up (items + other charges = invoice value)");
    const cnE = einvoiceFor(range.find((d) => d.id === cnB2b.id)!, S, ctx.numbers, ctx.dates);
    ok((cnE.json as { DocDtls: { Typ: string } } | null)?.DocDtls.Typ === "CRN", "credit note e-invoice is type CRN with the preceding invoice");
    ok(einvoiceFor(range.find((d) => d.id === intra.id)!, S, ctx.numbers, ctx.dates).json === null, "B2C documents are not e-invoiced");
    const noHsn = einvoiceFor({ ...b2bDoc, lines: (b2bDoc.lines as object[]).map((l) => ({ ...l, hsn: "" })) }, S, ctx.numbers, ctx.dates);
    ok(noHsn.json === null && noHsn.problems.some((p) => p.includes("HSN")), "missing HSN is reported instead of producing invalid JSON");

    // ── 8. Payout reconciliation ──
    const [p1, p2, p3] = [batch[2], batch[3], batch[4]].map((o) => o.payments[0]);
    const refunded = oRet.payments[0];
    const fee = (x: number) => Math.round(x * 0.02);
    const tax = (x: number) => Math.round(fee(x) * 0.18);
    const lines = [
      { type: "PAYMENT" as const, externalRef: `txn_${tag}_1`, paymentRef: p1.providerRef, amount: p1.amount, fee: fee(p1.amount), tax: tax(p1.amount) },
      { type: "PAYMENT" as const, externalRef: `txn_${tag}_2`, paymentRef: p2.providerRef, amount: p2.amount - 500, fee: fee(p2.amount), tax: tax(p2.amount) },
      { type: "PAYMENT" as const, externalRef: `txn_${tag}_3`, paymentRef: `pi_unknown_${tag}`, amount: 5000, fee: 100, tax: 18 },
      { type: "PAYMENT" as const, externalRef: `txn_${tag}_4`, paymentRef: refunded.providerRef, amount: refunded.amount, fee: 0, tax: 0 },
      { type: "REFUND" as const, externalRef: `txn_${tag}_5`, paymentRef: refunded.providerRef, amount: -refunded.amount, fee: 0, tax: 0 },
      { type: "FEE" as const, externalRef: `txn_${tag}_6`, paymentRef: null, amount: -2000, fee: 0, tax: 0 },
    ];
    const net = lines.reduce((s, l) => s + l.amount - l.fee - l.tax, 0);
    const st = await importSettlement({ provider: "STRIPE", externalId: `po_${tag}`, settledAt: new Date(), deposited: net, lines, source: "api" });
    const sl = await db.settlementLine.findMany({ where: { settlementId: st.id } });
    const status = (ref: string) => sl.find((l) => l.externalRef === ref)?.status;
    ok(status(`txn_${tag}_1`) === "MATCHED" && sl.find((l) => l.externalRef === `txn_${tag}_1`)?.orderId === batch[2].id, "payment matched to its order by PaymentIntent");
    ok(status(`txn_${tag}_2`) === "MISMATCH" && status(`txn_${tag}_3`) === "UNMATCHED", "short-settled payment flagged MISMATCH; unknown one UNMATCHED");
    ok(status(`txn_${tag}_5`) === "MATCHED" && status(`txn_${tag}_6`) === "MATCHED", "refund matched to the refunded order; fee line accepted");
    ok(st.matched === 4 && st.mismatched === 1 && st.unmatched === 1 && st.status === "REVIEW" && st.fees === fee(p1.amount) + fee(p2.amount) + 100 && st.feeTax === tax(p1.amount) + tax(p2.amount) + 18 && st.refunds === refunded.amount && st.net === net, "settlement totals: fees, GST on fees, refunds, net; flagged for review");
    const again2 = await importSettlement({ provider: "STRIPE", externalId: `po_${tag}`, settledAt: new Date(), deposited: net + 1000, lines, source: "api" });
    ok(again2.replaced && (await db.settlementLine.count({ where: { settlementId: st.id } })) === lines.length && (again2.note ?? "").includes("differs"), "re-import replaces lines; deposit vs lines mismatch noted");
    const dup = await importSettlement({ provider: "STRIPE", externalId: `po2_${tag}`, settledAt: new Date(), deposited: p1.amount, lines: [{ ...lines[0], externalRef: `txn_${tag}_dup`, fee: 0, tax: 0 }], source: "api" });
    ok(dup.mismatched === 1 && dup.status === "REVIEW", "the same payment in a second payout is flagged");
    const clean = await importSettlement({ provider: "STRIPE", externalId: `po3_${tag}`, settledAt: new Date(), deposited: p3.amount - fee(p3.amount) - tax(p3.amount), lines: [{ type: "PAYMENT", externalRef: `txn_${tag}_7`, paymentRef: p3.providerRef, amount: p3.amount, fee: fee(p3.amount), tax: tax(p3.amount) }], source: "api" });
    ok(clean.status === "MATCHED" && clean.expected === clean.deposited, "fully matched payout whose deposit equals expected → MATCHED");

    // Razorpay recon CSV (amounts in rupees), matched by payment id.
    const oRz = await mk({ state: "KA", provider: "RAZORPAY", raw: { paymentId: `pay_${tag}` } });
    const csv = `entity_id,type,debit,credit,amount,fee,tax,settlement_id,order_receipt,settled_at\r\npay_${tag},payment,0,${oRz.total / 100},${oRz.total / 100},47.20,8.50,setl_${tag},${oRz.number},4102444800\r\n`;
    const parsed = parseSettlementCsv("RAZORPAY", csv);
    ok(parsed.length === 1 && parsed[0].externalId === `setl_${tag}` && parsed[0].lines[0].amount === oRz.total && parsed[0].lines[0].fee === 4720 && parsed[0].lines[0].tax === 850, "Razorpay settlement recon CSV parsed (rupees → paise, fee and GST split)");
    const rz = await importSettlement(parsed[0]);
    ok(rz.status === "MATCHED" && rz.matched === 1, "Razorpay line matched by payment id");
    const mock = await mockSettlement("RAZORPAY", new Date(Date.now() - 3600_000), new Date(Date.now() + 60_000));
    ok(Boolean(mock?.lines.some((l) => l.paymentRef === `pay_${tag}`)) && mock?.source === "mock", "without keys a labelled test settlement is built from store payments");

    // COD remittance.
    const oCod = await mk({ state: "KA", provider: "COD" });
    await db.order.update({ where: { id: oCod.id }, data: { status: "DELIVERED" } });
    await db.shipment.create({ data: { orderId: oCod.id, provider: "mock", reference: `${tag}-SHIP`, awb: `AWB${tag}`, weightGrams: 300, cod: true, codAmount: oCod.total, status: "DELIVERED" } });
    const cod = await recordCodRemittance({ reference: `UTR${tag}`, courier: "Test", date: new Date(), amount: oCod.total, refs: `AWB${tag}` }, buyerUser.id);
    ok(cod.status === "MATCHED" && cod.matched === 1, "COD remittance equal to the COD due → matched");
    const cod2 = await recordCodRemittance({ reference: `UTR2${tag}`, courier: "Test", date: new Date(), amount: oCod.total - 10000, refs: `AWB${tag}, ${(oCod.total - 10000) / 100}` }, buyerUser.id);
    ok(cod2.status === "REVIEW" && cod2.mismatched === 1, "short / repeated COD remittance flagged");
  } finally {
    await db.settlement.deleteMany({ where: { externalId: { contains: tag } } });
    await db.order.deleteMany({ where: { id: { in: orderIds } } });
    await db.taxDocument.deleteMany({ where: { fy: { in: [FY, "2099-00"] } } });
    await db.tradeAccount.delete({ where: { id: trade.id } });
    await db.user.delete({ where: { id: buyerUser.id } });
    await db.productVariant.deleteMany({ where: { productId: product.id } });
    await db.product.delete({ where: { id: product.id } });
    await db.category.delete({ where: { id: category.id } });
    console.log("cleaned up");
  }
  ok((await db.taxDocument.count({ where: { fy: { notIn: [FY, "2099-00"] } } })) === realDocs, "real GST documents untouched");
  ok(JSON.stringify((await db.setting.findUnique({ where: { key: "accounting" } }))?.value ?? null) === realSetting, "real accounting settings untouched");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
