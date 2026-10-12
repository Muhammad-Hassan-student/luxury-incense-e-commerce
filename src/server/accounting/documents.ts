import "server-only";
import type { OrderStatus, Prisma, TaxDocKind } from "@/generated/prisma/client";
import { brand } from "@/config/brand";
import { FOREIGN_POS, apportion, financialYear, formatDocNumber, isValidGstin, normalizeGstin, splitTax, stateCodeFor } from "@/lib/gst";
import { db } from "../db";
import { getSettings } from "../settings";
import { getAccountingSettings, setupProblems, type AccountingSettings } from "./settings";

/*
 * GST tax invoices and credit notes.
 *  - One invoice per confirmed order (sourceKey inv:<orderId>), dated when the order was confirmed.
 *  - A credit note when an invoiced order is cancelled/refunded in full (cn:order:<orderId>) and for each refunded
 *    return or store-credit return (cn:return:<returnId>). Exchanges need none (goods replaced like for like).
 *  - Numbers: <prefix>/<FY>/<00001>, gap-free per kind per financial year. MAX(seq)+1 is taken under a transaction-scoped
 *    advisory lock in the same transaction that inserts the document, so concurrent issuers queue and a rollback frees
 *    the number again.
 * Amounts always reconcile to what the customer was charged: the order's tax is apportioned across the physical lines;
 * shipping, wrap and fees are "other charges" (charged without GST in this store); gift cards are vouchers (no GST).
 */

type Tx = Prisma.TransactionClient;

export type DocLine = {
  orderItemId: string | null;
  name: string;
  sku: string;
  hsn: string;
  qty: number;
  unitPrice: number;
  /** Line value after its share of discounts/points, GST included */
  amount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
};

export type DocTotals = { lines: DocLine[]; taxableValue: number; cgst: number; sgst: number; igst: number; otherCharges: number; nonGstValue: number; total: number };

const lineTax = (l: Pick<DocLine, "cgst" | "sgst" | "igst">) => l.cgst + l.sgst + l.igst;
const isDigital = (meta: Prisma.JsonValue | null) => Boolean(meta && typeof meta === "object" && !Array.isArray(meta) && "giftCard" in meta && meta.giftCard);

export type InvoiceSource = {
  items: { id: string; name: string; label: string; sku: string; unitPrice: number; quantity: number; meta: Prisma.JsonValue | null; hsn: string }[];
  discount: number;
  pointsRedeemed: number;
  shipping: number;
  tax: number;
  total: number;
};

/**
 * Pure: the GST breakdown of an order. Detects whether its prices included GST from the order's own figures
 * (falls back to `taxInclusive`), so later settings changes never rewrite history.
 */
export function computeInvoice(o: InvoiceSource, opts: { interState: boolean; taxInclusive: boolean; pointValue?: number }): DocTotals {
  const physical = o.items.filter((i) => !isDigital(i.meta));
  const nonGstValue = o.items.filter((i) => isDigital(i.meta)).reduce((n, i) => n + i.unitPrice * i.quantity, 0);
  const gross = physical.map((i) => i.unitPrice * i.quantity);
  const reduction = Math.min(
    gross.reduce((a, b) => a + b, 0),
    o.discount + o.pointsRedeemed * (opts.pointValue ?? brand.loyalty.pointValue),
  );
  const shares = apportion(reduction, gross);
  const net = gross.map((g, k) => g - shares[k]);
  const goods = net.reduce((a, b) => a + b, 0);
  const inclusive = o.total === goods + o.shipping + nonGstValue ? true : o.total === goods + o.tax + o.shipping + nonGstValue ? false : opts.taxInclusive;
  const taxes = apportion(o.tax, net);
  const lines: DocLine[] = physical.map((i, k) => {
    const t = splitTax(taxes[k], opts.interState);
    const taxable = inclusive ? net[k] - taxes[k] : net[k];
    return { orderItemId: i.id, name: `${i.name}${i.label ? ` ${i.label}` : ""}`.trim(), sku: i.sku, hsn: i.hsn, qty: i.quantity, unitPrice: i.unitPrice, amount: taxable + taxes[k], taxable, ...t };
  });
  return totalsOf(lines, o.total, nonGstValue);
}

function totalsOf(lines: DocLine[], total: number, nonGstValue: number): DocTotals {
  const taxableValue = lines.reduce((n, l) => n + l.taxable, 0);
  const cgst = lines.reduce((n, l) => n + l.cgst, 0);
  const sgst = lines.reduce((n, l) => n + l.sgst, 0);
  const igst = lines.reduce((n, l) => n + l.igst, 0);
  return { lines, taxableValue, cgst, sgst, igst, otherCharges: total - taxableValue - cgst - sgst - igst - nonGstValue, nonGstValue, total };
}

/**
 * Pure: a credit note for part of an invoice. `items` are returned quantities per invoice line; `amount` is the value
 * actually credited (after any restocking fee). The goods value is scaled to `amount`; anything above it (e.g. refunded
 * shipping) becomes other charges.
 */
export function computeCreditNote(invoiceLines: DocLine[], items: { orderItemId: string; qty: number }[], amount: number, interState: boolean): DocTotals {
  const picked = items
    .map((it) => {
      const l = invoiceLines.find((x) => x.orderItemId === it.orderItemId);
      if (!l || it.qty <= 0) return null;
      const qty = Math.min(it.qty, l.qty);
      return { l, qty, value: Math.round((l.amount * qty) / l.qty) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const goods = picked.reduce((n, p) => n + p.value, 0);
  const credit = apportion(Math.min(amount, goods), picked.map((p) => p.value));
  const lines: DocLine[] = picked.map((p, k) => {
    const tax = p.l.amount ? Math.round((credit[k] * lineTax(p.l)) / p.l.amount) : 0;
    return { ...p.l, qty: p.qty, amount: credit[k], taxable: credit[k] - tax, ...splitTax(tax, interState) };
  });
  return totalsOf(lines, amount, 0);
}

/** Pure: what is still uncredited on an invoice after earlier credit notes (for a full cancellation/refund). */
export function remainingAfterCredits(invoice: DocTotals, credits: DocTotals[], interState: boolean): DocTotals {
  const lines: DocLine[] = invoice.lines
    .map((l) => {
      const prior = credits.flatMap((c) => c.lines.filter((x) => x.orderItemId === l.orderItemId));
      const taxable = l.taxable - prior.reduce((n, x) => n + x.taxable, 0);
      const tax = lineTax(l) - prior.reduce((n, x) => n + lineTax(x), 0);
      const qty = Math.max(0, l.qty - prior.reduce((n, x) => n + x.qty, 0));
      return { ...l, qty, taxable, amount: taxable + tax, ...splitTax(tax, interState) };
    })
    .filter((l) => l.amount > 0);
  const other = invoice.otherCharges - credits.reduce((n, c) => n + c.otherCharges, 0);
  const nonGst = invoice.nonGstValue - credits.reduce((n, c) => n + c.nonGstValue, 0);
  const goods = lines.reduce((n, l) => n + l.amount, 0);
  return totalsOf(lines, Math.max(0, goods + Math.max(0, other) + Math.max(0, nonGst)), Math.max(0, nonGst));
}

// ─────────────────────────────── Parties ───────────────────────────────

type AddressJson = { fullName?: string; line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string };
const asAddress = (v: Prisma.JsonValue | null | undefined): AddressJson => (v && typeof v === "object" && !Array.isArray(v) ? (v as AddressJson) : {});

export type Party = { b2b: boolean; buyerName: string; buyerGstin: string | null; placeOfSupply: string; interState: boolean };

/** Buyer and place of supply: delivery state (goods move there); trade buyers with a valid GSTIN are B2B. */
export function partyFor(
  order: { email: string; shippingAddress: Prisma.JsonValue; tradeAccount: { businessName: string; taxId: string | null; address: Prisma.JsonValue } | null },
  sellerState: string,
): Party {
  const ship = asAddress(order.shippingAddress);
  const gstin = order.tradeAccount?.taxId ? normalizeGstin(order.tradeAccount.taxId) : "";
  const b2b = isValidGstin(gstin);
  const country = (ship.country ?? asAddress(order.tradeAccount?.address).country ?? "IN").toUpperCase();
  const pos =
    country !== "IN" ? FOREIGN_POS : (stateCodeFor(ship.state) ?? stateCodeFor(asAddress(order.tradeAccount?.address).state) ?? (b2b ? gstin.slice(0, 2) : null) ?? sellerState);
  return {
    b2b,
    buyerName: (b2b ? order.tradeAccount?.businessName : null) ?? ship.fullName ?? order.tradeAccount?.businessName ?? order.email,
    buyerGstin: b2b ? gstin : null,
    placeOfSupply: pos,
    interState: pos !== sellerState,
  };
}

// ─────────────────────────────── Numbering ───────────────────────────────

/** Next gap-free sequence for a kind + FY. Must run inside the issuing transaction (holds an advisory lock to its end). */
export async function nextSeq(tx: Tx, kind: TaxDocKind, fy: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`TaxDocument:${kind}:${fy}`}))`;
  const rows = await tx.$queryRaw<{ seq: number | null }[]>`
    SELECT MAX(seq)::int AS seq FROM "TaxDocument" WHERE kind = ${kind}::"TaxDocKind" AND fy = ${fy}`;
  return (rows[0]?.seq ?? 0) + 1;
}

const isUnique = (e: unknown) => typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === "P2002";

type NewDoc = Omit<Prisma.TaxDocumentUncheckedCreateInput, "number" | "fy" | "seq" | "id" | "createdAt"> & { kind: TaxDocKind };

async function insertDoc(doc: NewDoc, s: AccountingSettings) {
  const fy = financialYear(doc.issuedAt as Date);
  const prefix = doc.kind === "INVOICE" ? s.invoicePrefix : s.creditNotePrefix;
  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.taxDocument.findUnique({ where: { sourceKey: doc.sourceKey } });
      if (existing) return existing;
      const seq = await nextSeq(tx, doc.kind, fy);
      return tx.taxDocument.create({ data: { ...doc, fy, seq, number: formatDocNumber(prefix, fy, seq) } });
    });
  } catch (e) {
    // Lost a race on the same sourceKey: the other issuer's document stands.
    if (isUnique(e)) {
      const existing = await db.taxDocument.findUnique({ where: { sourceKey: doc.sourceKey } });
      if (existing) return existing;
    }
    throw e;
  }
}

// ─────────────────────────────── Issuing ───────────────────────────────

type EventLike = { status: OrderStatus; message: string; createdAt: Date };
const isConfirmation = (e: EventLike) => (e.status === "PENDING" ? e.message.startsWith("Confirmed") : e.status !== "CANCELLED" && e.status !== "REFUNDED");

const orderInclude = {
  items: { orderBy: { id: "asc" } },
  events: { orderBy: { createdAt: "asc" } },
  tradeAccount: { select: { businessName: true, taxId: true, address: true } },
} satisfies Prisma.OrderInclude;

type IssueOpts = { settings?: AccountingSettings; at?: Date };

async function ready(opts: IssueOpts) {
  const s = opts.settings ?? (await getAccountingSettings());
  return s.enabled && setupProblems(s).length === 0 ? s : null;
}

/** IST calendar date "YYYY-MM-DD" ≥ startsOn. */
const onOrAfter = (d: Date, startsOn: string) => !startsOn || new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10) >= startsOn;

async function hsnFor(variantIds: string[], fallback: string) {
  const vs = await db.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, product: { select: { hsnCode: true, category: { select: { hsnCode: true } } } } },
  });
  return new Map(vs.map((v) => [v.id, v.product.hsnCode || v.product.category.hsnCode || fallback]));
}

/** Confirmation date of an order eligible for a tax invoice, or null. */
export function invoiceDateFor(o: { reservedUntil: Date | null; codStatus: string | null; placedAt: Date; events: EventLike[] }) {
  if (o.reservedUntil || o.codStatus === "AWAITING") return null;
  const confirmed = o.events.find(isConfirmation);
  if (!confirmed) return null;
  if (o.codStatus === "CANCELLED" && !o.events.some((e) => e.status !== "PENDING" && isConfirmation(e))) return null;
  return confirmed.createdAt;
}

/** Issues the tax invoice for a confirmed order (idempotent). Null when not eligible / accounting not set up. */
export async function issueInvoice(orderId: string, opts: IssueOpts = {}) {
  const s = await ready(opts);
  if (!s) return null;
  const existing = await db.taxDocument.findUnique({ where: { sourceKey: `inv:${orderId}` } });
  if (existing) return existing;
  const o = await db.order.findUnique({ where: { id: orderId }, include: orderInclude });
  if (!o) return null;
  const confirmed = invoiceDateFor(o);
  if (!confirmed) return null;
  const issuedAt = opts.at ?? confirmed;
  if (!onOrAfter(confirmed, s.startsOn)) return null;
  if (!o.items.some((i) => !isDigital(i.meta)) || o.total <= 0) return null; // vouchers only / zero-value replacement
  const hsn = await hsnFor(o.items.flatMap((i) => (i.variantId ? [i.variantId] : [])), s.defaultHsn);
  const party = partyFor(o, s.stateCode);
  const { taxInclusive, taxRatePercent } = await getSettings();
  const t = computeInvoice({ ...o, items: o.items.map((i) => ({ ...i, hsn: (i.variantId && hsn.get(i.variantId)) || s.defaultHsn })) }, { interState: party.interState, taxInclusive });
  return insertDoc(
    {
      kind: "INVOICE",
      sourceKey: `inv:${orderId}`,
      orderId,
      issuedAt,
      ...party,
      sellerState: s.stateCode,
      taxRate: taxRatePercent,
      taxableValue: t.taxableValue,
      cgst: t.cgst,
      sgst: t.sgst,
      igst: t.igst,
      otherCharges: t.otherCharges,
      nonGstValue: t.nonGstValue,
      total: t.total,
      lines: t.lines as unknown as Prisma.InputJsonValue,
    },
    s,
  );
}

type StoredDoc = Awaited<ReturnType<typeof db.taxDocument.findFirstOrThrow>>;
export const docTotals = (d: Pick<StoredDoc, "lines" | "taxableValue" | "cgst" | "sgst" | "igst" | "otherCharges" | "nonGstValue" | "total">): DocTotals => ({
  lines: d.lines as unknown as DocLine[],
  taxableValue: d.taxableValue,
  cgst: d.cgst,
  sgst: d.sgst,
  igst: d.igst,
  otherCharges: d.otherCharges,
  nonGstValue: d.nonGstValue,
  total: d.total,
});

async function creditNote(invoice: StoredDoc, sourceKey: string, t: DocTotals, issuedAt: Date, returnId: string | null, s: AccountingSettings) {
  if (t.total <= 0) return null;
  return insertDoc(
    {
      kind: "CREDIT_NOTE",
      sourceKey,
      orderId: invoice.orderId,
      invoiceId: invoice.id,
      returnId,
      issuedAt,
      b2b: invoice.b2b,
      buyerName: invoice.buyerName,
      buyerGstin: invoice.buyerGstin,
      placeOfSupply: invoice.placeOfSupply,
      sellerState: invoice.sellerState,
      interState: invoice.interState,
      taxRate: invoice.taxRate,
      taxableValue: t.taxableValue,
      cgst: t.cgst,
      sgst: t.sgst,
      igst: t.igst,
      otherCharges: t.otherCharges,
      nonGstValue: t.nonGstValue,
      total: t.total,
      lines: t.lines as unknown as Prisma.InputJsonValue,
    },
    s,
  );
}

/** Credit note for the rest of an invoiced order that was cancelled or refunded in full (idempotent). */
export async function issueOrderCreditNote(orderId: string, opts: IssueOpts = {}) {
  const s = await ready(opts);
  if (!s) return null;
  const key = `cn:order:${orderId}`;
  const existing = await db.taxDocument.findUnique({ where: { sourceKey: key } });
  if (existing) return existing;
  const invoice = await db.taxDocument.findUnique({ where: { sourceKey: `inv:${orderId}` } });
  const o = await db.order.findUnique({ where: { id: orderId }, select: { status: true, events: { orderBy: { createdAt: "desc" }, select: { status: true, createdAt: true } } } });
  if (!invoice || !o || (o.status !== "CANCELLED" && o.status !== "REFUNDED")) return null;
  const when = opts.at ?? o.events.find((e) => e.status === o.status)?.createdAt ?? new Date();
  const prior = await db.taxDocument.findMany({ where: { kind: "CREDIT_NOTE", invoiceId: invoice.id } });
  const t = remainingAfterCredits(docTotals(invoice), prior.map(docTotals), invoice.interState);
  return creditNote(invoice, key, t, when, null, s);
}

/** Credit note for a refunded / store-credit return (idempotent). */
export async function issueReturnCreditNote(returnId: string, opts: IssueOpts = {}) {
  const s = await ready(opts);
  if (!s) return null;
  const key = `cn:return:${returnId}`;
  const existing = await db.taxDocument.findUnique({ where: { sourceKey: key } });
  if (existing) return existing;
  const r = await db.returnRequest.findUnique({ where: { id: returnId }, include: { items: { select: { orderItemId: true, quantity: true } } } });
  if (!r || r.status !== "REFUNDED" || !r.refundAmount || r.resolution === "EXCHANGE") return null;
  const invoice = await db.taxDocument.findUnique({ where: { sourceKey: `inv:${r.orderId}` } });
  if (!invoice) return null;
  const t = computeCreditNote(
    docTotals(invoice).lines,
    r.items.map((i) => ({ orderItemId: i.orderItemId, qty: i.quantity })),
    r.refundAmount,
    invoice.interState,
  );
  return creditNote(invoice, key, t, opts.at ?? r.resolvedAt ?? new Date(), r.id, s);
}

/**
 * Catch-up sweep (daily cron, "Sync now" button, and after confirmation): issues missing invoices for confirmed
 * orders since the start date, then credit notes for cancellations/refunds and refunded returns. Oldest first.
 */
export async function syncDocuments(opts: { limit?: number; settings?: AccountingSettings } = {}) {
  const s = await ready(opts);
  if (!s) return { skipped: "accounting is not set up", invoices: 0, creditNotes: 0 };
  const limit = opts.limit ?? 500;
  const since = s.startsOn ? new Date(`${s.startsOn}T00:00:00+05:30`) : new Date(0);
  const candidates = await db.order.findMany({
    where: { reservedUntil: null, placedAt: { gte: new Date(since.getTime() - 30 * 86400_000) }, taxDocuments: { none: { kind: "INVOICE" } }, total: { gt: 0 } },
    orderBy: { placedAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let invoices = 0;
  for (const c of candidates) if (await issueInvoice(c.id, { settings: s })) invoices++;

  let creditNotes = 0;
  const voided = await db.order.findMany({
    where: { status: { in: ["CANCELLED", "REFUNDED"] }, taxDocuments: { some: { kind: "INVOICE" } }, NOT: { taxDocuments: { some: { sourceKey: { startsWith: "cn:order:" } } } } },
    select: { id: true },
    take: limit,
  });
  for (const o of voided) if (await issueOrderCreditNote(o.id, { settings: s })) creditNotes++;
  const returns = await db.returnRequest.findMany({ where: { status: "REFUNDED", resolution: { in: ["REFUND", "STORE_CREDIT"] } }, select: { id: true }, take: limit * 4 });
  const done = new Set((await db.taxDocument.findMany({ where: { returnId: { in: returns.map((r) => r.id) } }, select: { returnId: true } })).map((d) => d.returnId));
  for (const r of returns) if (!done.has(r.id) && (await issueReturnCreditNote(r.id, { settings: s }))) creditNotes++;
  return { invoices, creditNotes };
}

/** How many documents a sync would issue right now (for the "pending" banner). */
export async function pendingDocuments() {
  const s = await getAccountingSettings();
  if (!s.enabled || setupProblems(s).length) return null;
  const since = s.startsOn ? new Date(`${s.startsOn}T00:00:00+05:30`) : new Date(0);
  const [orders, voided] = await Promise.all([
    db.order.findMany({
      where: { reservedUntil: null, placedAt: { gte: new Date(since.getTime() - 30 * 86400_000) }, taxDocuments: { none: { kind: "INVOICE" } }, total: { gt: 0 } },
      select: { reservedUntil: true, codStatus: true, placedAt: true, events: { orderBy: { createdAt: "asc" }, select: { status: true, message: true, createdAt: true } }, items: { select: { meta: true } } },
      take: 2000,
    }),
    db.order.count({ where: { status: { in: ["CANCELLED", "REFUNDED"] }, taxDocuments: { some: { kind: "INVOICE" } }, NOT: { taxDocuments: { some: { sourceKey: { startsWith: "cn:order:" } } } } } }),
  ]);
  const invoices = orders.filter((o) => {
    const d = invoiceDateFor(o);
    return d && onOrAfter(d, s.startsOn) && o.items.some((i) => !isDigital(i.meta));
  }).length;
  return { invoices, creditNotes: voided };
}

/** Never throws: the credit note right after an invoiced order is cancelled or refunded (the daily sync is the backstop). */
export async function creditNoteOnOrderClosed(orderId: string) {
  try {
    await issueOrderCreditNote(orderId);
  } catch (e) {
    console.error("[accounting] credit note on cancel/refund failed", orderId, e);
  }
}

/** Never throws: the credit note right after a return is refunded or credited (the daily sync is the backstop). */
export async function creditNoteOnReturnRefunded(returnId: string) {
  try {
    await issueReturnCreditNote(returnId);
  } catch (e) {
    console.error("[accounting] credit note on return failed", returnId, e);
  }
}

/** Never throws: issues the invoice right after confirmation when accounting is on (called from afterOrderConfirmed). */
export async function invoiceOnConfirm(orderId: string) {
  try {
    await issueInvoice(orderId);
  } catch (e) {
    console.error("[accounting] invoice on confirm failed", orderId, e);
  }
}
