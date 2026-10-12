import "server-only";
import type Stripe from "stripe";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { getIntegration } from "../integrations";
import { razorpay, stripe } from "../payments";
import { parseCsv } from "../inventory-csv";
import { getAccountingSettings } from "./settings";
import { regionNow } from "@/lib/region-runtime";

/*
 * Payout reconciliation: Stripe payouts (balance transactions), Razorpay settlements (settlement recon) and courier
 * COD remittances, each line matched to our orders / payments / refunds.
 *  - Live: keys come from Admin → Integrations (getIntegration). Without keys, "fetch" builds a clearly-labelled test
 *    settlement from our own captured payments (2% + 18% GST fee) so the screens can be tried end to end.
 *  - CSV: Stripe balance-transaction / itemised payout reports and Razorpay settlement recon exports.
 * A line is MATCHED when it ties to an order and the amount equals what we recorded (± tolerance), MISMATCH when it ties
 * to an order but the amount differs (or was already settled elsewhere), UNMATCHED when we can't find the order.
 * A settlement is MATCHED only when every line is and the deposit equals the sum of line nets.
 */

export type Provider = "STRIPE" | "RAZORPAY" | "COD";
export type LineType = "PAYMENT" | "REFUND" | "FEE" | "ADJUSTMENT" | "COD";

export type ImportedLine = {
  type: LineType;
  externalRef: string;
  /** PaymentIntent id (Stripe), payment id / order id (Razorpay), AWB (COD) */
  paymentRef: string | null;
  /** Our order number when the provider carries it (Razorpay receipt, description, COD sheet) */
  orderRef?: string | null;
  /** Signed gross: refunds negative */
  amount: number;
  fee: number;
  tax: number;
};

export type ImportedSettlement = {
  provider: Provider;
  externalId: string;
  settledAt: Date;
  deposited: number;
  currency?: string;
  lines: ImportedLine[];
  source: "api" | "csv" | "mock" | "manual";
  note?: string | null;
};

export class ReconciliationError extends Error {}

// ─────────────────────────────── Matching ───────────────────────────────

type Matched = { orderId: string | null; orderNumber: string | null; expected: number | null; status: "MATCHED" | "UNMATCHED" | "MISMATCH"; note: string | null };

async function findPayment(provider: Provider, ref: string | null, orderRef: string | null | undefined) {
  const include = { order: { select: { id: true, number: true, status: true, returns: { where: { status: "REFUNDED" as const }, select: { number: true, providerAmount: true } } } } };
  if (ref) {
    const byRef = await db.payment.findFirst({ where: { provider: provider === "COD" ? undefined : provider, OR: [{ providerRef: ref }, { raw: { path: ["paymentId"], equals: ref } }] }, include });
    if (byRef) return byRef;
  }
  if (orderRef) return db.payment.findFirst({ where: { order: { number: orderRef } }, orderBy: { createdAt: "asc" }, include });
  return null;
}

/** Matches one line against our records. `seen` holds refs already matched in OTHER settlements. */
export async function matchLine(provider: Provider, l: ImportedLine, opts: { tolerance: number; settlementId?: string }): Promise<Matched> {
  if (l.type === "FEE" || l.type === "ADJUSTMENT") return { orderId: null, orderNumber: null, expected: null, status: "MATCHED", note: l.type === "FEE" ? "Provider fee" : "Adjustment" };

  if (l.type === "COD") {
    const ref = l.paymentRef ?? l.orderRef ?? "";
    const shipment = await db.shipment.findFirst({
      where: { OR: [{ awb: ref }, { order: { number: ref } }], cod: true },
      orderBy: { createdAt: "desc" },
      include: { order: { select: { id: true, number: true, status: true } } },
    });
    if (!shipment) return { orderId: null, orderNumber: null, expected: null, status: "UNMATCHED", note: `No COD shipment for ${ref}` };
    const dup = await db.settlementLine.findFirst({ where: { orderId: shipment.orderId, type: "COD", status: { not: "UNMATCHED" }, settlementId: opts.settlementId ? { not: opts.settlementId } : undefined } });
    const base = { orderId: shipment.order.id, orderNumber: shipment.order.number, expected: shipment.codAmount };
    if (dup) return { ...base, status: "MISMATCH", note: "Already remitted in another settlement" };
    if (shipment.order.status !== "DELIVERED") return { ...base, status: "MISMATCH", note: `Order is ${shipment.order.status.toLowerCase()}, not delivered` };
    if (Math.abs(l.amount - shipment.codAmount) > opts.tolerance) return { ...base, status: "MISMATCH", note: `Remitted ${l.amount / 100} vs COD due ${shipment.codAmount / 100}` };
    return { ...base, status: "MATCHED", note: null };
  }

  const p = await findPayment(provider, l.paymentRef, l.orderRef);
  if (!p) return { orderId: null, orderNumber: null, expected: null, status: "UNMATCHED", note: "No order found for this transaction" };
  const base = { orderId: p.order.id, orderNumber: p.order.number };
  if (l.type === "PAYMENT") {
    const dup = await db.settlementLine.findFirst({ where: { orderId: p.order.id, type: "PAYMENT", status: { not: "UNMATCHED" }, settlementId: opts.settlementId ? { not: opts.settlementId } : undefined } });
    if (dup) return { ...base, expected: p.amount, status: "MISMATCH", note: "Payment already settled in another payout" };
    if (p.status !== "CAPTURED" && p.status !== "REFUNDED") return { ...base, expected: p.amount, status: "MISMATCH", note: `Our payment is ${p.status.toLowerCase()}` };
    if (Math.abs(l.amount - p.amount) > opts.tolerance) return { ...base, expected: p.amount, status: "MISMATCH", note: `Settled ${l.amount / 100} vs charged ${p.amount / 100}` };
    return { ...base, expected: p.amount, status: "MATCHED", note: null };
  }
  // REFUND: a full refund (order REFUNDED) or one of the order's refunded returns.
  const refunded = -l.amount;
  const candidates = [...(p.order.status === "REFUNDED" ? [p.amount] : []), ...p.order.returns.map((r) => r.providerAmount)].filter((x) => x > 0);
  const hit = candidates.find((x) => Math.abs(x - refunded) <= opts.tolerance);
  if (hit !== undefined) return { ...base, expected: -hit, status: "MATCHED", note: null };
  if (!candidates.length) return { ...base, expected: 0, status: "MISMATCH", note: "Refund at the provider but none recorded on the order" };
  return { ...base, expected: -candidates[0], status: "MISMATCH", note: `Refunded ${refunded / 100} vs recorded ${candidates.map((c) => c / 100).join(" / ")}` };
}

/** Stores (or replaces) a settlement with freshly matched lines and its totals. */
export async function importSettlement(input: ImportedSettlement, actorId?: string | null) {
  if (!input.externalId.trim()) throw new ReconciliationError("Missing payout / settlement reference.");
  const { tolerance } = await getAccountingSettings();
  const existing = await db.settlement.findUnique({ where: { provider_externalId: { provider: input.provider, externalId: input.externalId } }, select: { id: true } });
  const matched: { l: ImportedLine; m: Matched }[] = [];
  for (const l of input.lines) matched.push({ l, m: await matchLine(input.provider, l, { tolerance, settlementId: existing?.id }) });

  const sum = (f: (x: (typeof matched)[number]) => number) => matched.reduce((n, x) => n + f(x), 0);
  const isSale = (t: LineType) => t === "PAYMENT" || t === "COD";
  const net = sum((x) => x.l.amount - x.l.fee - x.l.tax);
  const expected = sum((x) => (x.m.expected ?? (x.l.type === "FEE" || x.l.type === "ADJUSTMENT" ? x.l.amount : 0)) - x.l.fee - x.l.tax);
  const counts = { matched: matched.filter((x) => x.m.status === "MATCHED").length, unmatched: matched.filter((x) => x.m.status === "UNMATCHED").length, mismatched: matched.filter((x) => x.m.status === "MISMATCH").length };
  const depositOk = Math.abs(input.deposited - net) <= tolerance;
  const status = counts.unmatched === 0 && counts.mismatched === 0 && depositOk ? "MATCHED" : "REVIEW";
  const data = {
    settledAt: input.settledAt,
    currency: (input.currency ?? regionNow().baseCurrency).toUpperCase(),
    gross: sum((x) => (isSale(x.l.type) ? x.l.amount : 0)),
    refunds: -sum((x) => (x.l.type === "REFUND" ? x.l.amount : 0)),
    fees: sum((x) => x.l.fee),
    feeTax: sum((x) => x.l.tax),
    adjustments: sum((x) => (x.l.type === "FEE" || x.l.type === "ADJUSTMENT" ? x.l.amount : 0)),
    net,
    deposited: input.deposited,
    expected,
    ...counts,
    status,
    source: input.source,
    note: [input.note, depositOk ? null : `Deposit ${input.deposited / 100} differs from line total ${net / 100}`].filter(Boolean).join(" · ") || null,
  };
  return db.$transaction(async (tx) => {
    const s = existing
      ? await tx.settlement.update({ where: { id: existing.id }, data })
      : await tx.settlement.create({ data: { ...data, provider: input.provider, externalId: input.externalId, createdById: actorId ?? null } });
    if (existing) await tx.settlementLine.deleteMany({ where: { settlementId: s.id } });
    if (matched.length) {
      await tx.settlementLine.createMany({
        data: matched.map(({ l, m }) => ({
          settlementId: s.id,
          type: l.type,
          externalRef: l.externalRef.slice(0, 120),
          paymentRef: l.paymentRef?.slice(0, 120) ?? null,
          amount: l.amount,
          fee: l.fee,
          tax: l.tax,
          net: l.amount - l.fee - l.tax,
          orderId: m.orderId,
          orderNumber: m.orderNumber,
          expected: m.expected,
          status: m.status,
          note: m.note,
        })),
      });
    }
    return { ...s, replaced: Boolean(existing) };
  });
}

/** Re-runs matching for a stored settlement (after orders/refunds changed). */
export async function rematchSettlement(id: string) {
  const s = await db.settlement.findUnique({ where: { id }, include: { lines: true } });
  if (!s) throw new ReconciliationError("Settlement not found.");
  return importSettlement({
    provider: s.provider as Provider,
    externalId: s.externalId,
    settledAt: s.settledAt,
    deposited: s.deposited,
    currency: s.currency,
    source: s.source as ImportedSettlement["source"],
    note: s.note?.replace(/ ?·? ?Deposit .* differs from line total .*$/, "") || null,
    lines: s.lines.map((l) => ({ type: l.type as LineType, externalRef: l.externalRef, paymentRef: l.paymentRef, orderRef: l.orderNumber, amount: l.amount, fee: l.fee, tax: l.tax })),
  });
}

// ─────────────────────────────── Providers ───────────────────────────────

const unix = (d: Date) => Math.floor(d.getTime() / 1000);

const stripeType = (t: string): LineType =>
  t === "charge" || t === "payment" ? "PAYMENT" : t === "refund" || t === "payment_refund" || t === "payment_failure_refund" ? "REFUND" : t === "stripe_fee" || t === "application_fee" || t === "tax" ? "FEE" : "ADJUSTMENT";

/** Stripe: paid payouts arriving in the window, each with its balance transactions. */
export async function fetchStripe(from: Date, to: Date): Promise<ImportedSettlement[]> {
  const client = await stripe();
  const out: ImportedSettlement[] = [];
  for await (const p of client.payouts.list({ arrival_date: { gte: unix(from), lte: unix(to) }, limit: 100 })) {
    if (p.status !== "paid" && p.status !== "in_transit") continue;
    const lines: ImportedLine[] = [];
    for await (const t of client.balanceTransactions.list({ payout: p.id, limit: 100, expand: ["data.source"] })) {
      if (t.type === "payout") continue;
      const src = t.source as (Stripe.Charge | Stripe.Refund | { payment_intent?: string | { id: string } | null; metadata?: Record<string, string> }) | string | null;
      const pi = src && typeof src === "object" && "payment_intent" in src ? (typeof src.payment_intent === "string" ? src.payment_intent : (src.payment_intent?.id ?? null)) : null;
      const tax = t.fee_details.filter((f) => f.type === "tax").reduce((n, f) => n + f.amount, 0);
      lines.push({ type: stripeType(t.type), externalRef: t.id, paymentRef: pi, orderRef: null, amount: t.amount, fee: t.fee - tax, tax });
    }
    out.push({ provider: "STRIPE", externalId: p.id, settledAt: new Date(p.arrival_date * 1000), deposited: p.amount, currency: p.currency, lines, source: "api" });
  }
  return out;
}

type RzRecon = { entity_id: string; type: string; debit: number; credit: number; amount: number | string; fee: number; tax: number; settlement_id: string; order_id?: string | null; order_receipt?: string | null; payment_id?: string | null; settled_at: number };

/** Razorpay: settlements created in the window plus their settlement-recon items (fetched day by day, ≤ 62 days). */
export async function fetchRazorpay(from: Date, to: Date): Promise<ImportedSettlement[]> {
  const rz = await razorpay();
  const list = (await rz.settlements.all({ from: unix(from), to: unix(to), count: 100 })) as unknown as { items: { id: string; amount: number; created_at: number; status: string }[] };
  const items: RzRecon[] = [];
  for (let d = new Date(from); d <= to && items.length < 20_000; d = new Date(d.getTime() + 86400_000)) {
    if ((d.getTime() - from.getTime()) / 86400_000 > 62) break;
    for (let skip = 0; ; skip += 1000) {
      const page = (await rz.settlements.reports({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), count: 1000, skip })) as unknown as { items?: RzRecon[] };
      items.push(...(page.items ?? []));
      if ((page.items ?? []).length < 1000) break;
    }
  }
  return list.items
    .filter((s) => s.status === "processed" || s.status === "partially_processed")
    .map((s) => ({
      provider: "RAZORPAY" as const,
      externalId: s.id,
      settledAt: new Date(s.created_at * 1000),
      deposited: s.amount,
      source: "api" as const,
      lines: items
        .filter((i) => i.settlement_id === s.id)
        .map((i): ImportedLine => {
          const type: LineType = i.type === "payment" ? "PAYMENT" : i.type === "refund" ? "REFUND" : "ADJUSTMENT";
          const amount = type === "REFUND" ? -Math.abs(Number(i.debit || i.amount)) : Number(i.credit || i.amount) - (type === "ADJUSTMENT" ? Number(i.debit || 0) : 0);
          return { type, externalRef: i.entity_id, paymentRef: type === "REFUND" ? (i.payment_id ?? i.order_id ?? null) : i.entity_id, orderRef: i.order_receipt ?? null, amount, fee: i.fee ?? 0, tax: i.tax ?? 0 };
        }),
    }));
}

/**
 * Test settlement built from our own captured payments in the window (no provider keys). Fee 2% + 18% GST on it;
 * refunded payments appear as a payment and its refund. Labelled "mock" everywhere.
 */
export async function mockSettlement(provider: "STRIPE" | "RAZORPAY", from: Date, to: Date): Promise<ImportedSettlement | null> {
  const payments = await db.payment.findMany({
    where: { provider, status: { in: ["CAPTURED", "REFUNDED"] }, amount: { gt: 0 }, createdAt: { gte: from, lte: to } },
    include: { order: { select: { number: true } } },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  if (!payments.length) return null;
  const lines: ImportedLine[] = [];
  for (const p of payments) {
    const fee = Math.round(p.amount * 0.02);
    const tax = Math.round(fee * 0.18);
    const ref = provider === "STRIPE" ? p.providerRef : ((p.raw as { paymentId?: string } | null)?.paymentId ?? p.providerRef);
    lines.push({ type: "PAYMENT", externalRef: `mock_txn_${p.id}`, paymentRef: ref, orderRef: p.order.number, amount: p.amount, fee, tax });
    if (p.status === "REFUNDED") lines.push({ type: "REFUND", externalRef: `mock_rf_${p.id}`, paymentRef: ref, orderRef: p.order.number, amount: -p.amount, fee: 0, tax: 0 });
  }
  const day = to.toISOString().slice(0, 10).replace(/-/g, "");
  return {
    provider,
    externalId: `mock_${provider.toLowerCase()}_${day}`,
    settledAt: to,
    deposited: lines.reduce((n, l) => n + l.amount - l.fee - l.tax, 0),
    lines,
    source: "mock",
    note: "Test settlement generated from store payments (no provider keys in Integrations).",
  };
}

/** Fetch from the provider when its keys are in Integrations, else build a test settlement. Imports every result. */
export async function fetchSettlements(provider: "STRIPE" | "RAZORPAY", from: Date, to: Date, actorId: string) {
  const live = provider === "STRIPE" ? Boolean((await getIntegration("stripe")).secretKey) : Boolean((await getIntegration("razorpay")).keySecret);
  const batch = live ? await (provider === "STRIPE" ? fetchStripe(from, to) : fetchRazorpay(from, to)) : [await mockSettlement(provider, from, to)].filter((x): x is ImportedSettlement => x !== null);
  const saved = [];
  for (const s of batch) saved.push(await importSettlement(s, actorId));
  return { live, imported: saved.length, settlements: saved };
}

// ─────────────────────────────── CSV import ───────────────────────────────

/** "1,234.50" / "-12" (major units) → paise. */
export function parseMoney(v: string | undefined) {
  const s = (v ?? "").replace(/[₹,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new ReconciliationError(`Not an amount: ${v}`);
  return Math.round(n * 100);
}

const pick = (head: string[], ...names: string[]) => {
  for (const n of names) {
    const i = head.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
};

/**
 * Parses a Stripe (balance transactions / itemised payout reconciliation) or Razorpay (settlement recon) CSV into
 * settlements, grouped by payout / settlement id (or `fallbackId` when the file has none).
 */
export function parseSettlementCsv(provider: "STRIPE" | "RAZORPAY", text: string, opts: { fallbackId?: string; settledAt?: Date } = {}): ImportedSettlement[] {
  const rows = parseCsv(text).filter((r) => r.cells.some((c) => c.trim()));
  if (rows.length < 2) throw new ReconciliationError("The file has no data rows.");
  const head = rows[0].cells.map((h) => h.trim().toLowerCase().replace(/[\s()]+/g, "_").replace(/_+$/, ""));
  const col = {
    id: pick(head, "id", "balance_transaction_id", "entity_id", "transaction_id"),
    type: pick(head, "type", "reporting_category", "transaction_type"),
    amount: pick(head, "amount", "gross", "credit"),
    debit: pick(head, "debit"),
    fee: pick(head, "fee", "fees"),
    tax: pick(head, "tax", "gst"),
    pi: pick(head, "payment_intent_id", "payment_intent", "source_id", "source", "payment_id"),
    payout: pick(head, "automatic_payout_id", "payout_id", "transfer", "settlement_id"),
    order: pick(head, "order_receipt", "receipt", "order_number", "description", "order_id"),
    date: pick(head, "automatic_payout_effective_at_utc", "available_on_utc", "available_on", "settled_at", "created_utc", "created", "created_at"),
  };
  if (col.id < 0 || (col.amount < 0 && col.debit < 0)) throw new ReconciliationError("Unrecognised file: expected an id and an amount column (Stripe balance transactions or Razorpay settlement recon).");
  const groups = new Map<string, ImportedSettlement>();
  for (const r of rows.slice(1)) {
    const c = (i: number) => (i >= 0 ? (r.cells[i] ?? "").trim() : "");
    const rawType = c(col.type).toLowerCase();
    if (rawType === "payout" || rawType === "transfer" || rawType === "settlement") continue;
    let type: LineType = provider === "STRIPE" ? stripeType(rawType.replace(/^payment_refund$/, "refund")) : rawType.startsWith("refund") ? "REFUND" : rawType === "payment" || rawType === "" ? "PAYMENT" : "ADJUSTMENT";
    if (rawType === "fee") type = "FEE";
    let amount = col.amount >= 0 ? parseMoney(c(col.amount)) : 0;
    if (col.debit >= 0 && parseMoney(c(col.debit))) amount = -Math.abs(parseMoney(c(col.debit)));
    if (type === "REFUND" && amount > 0) amount = -amount;
    // Stripe fee includes GST; a separate tax column (Razorpay) splits it out.
    const tax = col.tax >= 0 ? Math.abs(parseMoney(c(col.tax))) : 0;
    const fee = Math.abs(parseMoney(c(col.fee))) - (provider === "STRIPE" ? tax : 0);
    const orderText = c(col.order);
    const receiptCol = col.order >= 0 && ["order_receipt", "receipt", "order_number"].includes(head[col.order]);
    const orderRef = /MO-[A-Z0-9]+/i.exec(orderText)?.[0]?.toUpperCase() ?? (receiptCol && orderText ? orderText : null);
    const payout = c(col.payout) || opts.fallbackId || "";
    if (!payout) throw new ReconciliationError("No payout / settlement id in the file — enter one in the form.");
    const dateText = c(col.date);
    const parsed = dateText ? new Date(/^\d{10}$/.test(dateText) ? Number(dateText) * 1000 : dateText.replace(" ", "T") + (/[zZ+]/.test(dateText) ? "" : "Z")) : null;
    const g = groups.get(payout) ?? { provider, externalId: payout, settledAt: opts.settledAt ?? (parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date()), deposited: 0, lines: [], source: "csv" as const };
    // Razorpay recon: entity_id IS the payment id on payment rows (refund rows carry payment_id).
    const paymentRef = c(col.pi) || (provider === "RAZORPAY" && type === "PAYMENT" ? c(col.id) : "") || null;
    g.lines.push({ type, externalRef: c(col.id), paymentRef, orderRef, amount, fee, tax });
    groups.set(payout, g);
  }
  for (const g of groups.values()) g.deposited = g.lines.reduce((n, l) => n + l.amount - l.fee - l.tax, 0);
  return [...groups.values()];
}

// ─────────────────────────────── COD remittance ───────────────────────────────

/**
 * Courier COD remittance: the amount the courier paid in, against the AWBs / order numbers it covers. Each line's
 * expected value is the shipment's COD amount; a per-line amount ("AWB, 1234.00") is optional.
 */
export async function recordCodRemittance(input: { reference: string; courier: string; date: Date; amount: number; refs: string }, actorId: string) {
  const lines: ImportedLine[] = [];
  for (const raw of input.refs.split(/\r?\n/)) {
    const [ref, amt] = raw.split(/[,\t;]/).map((x) => x.trim());
    if (!ref) continue;
    const shipment = await db.shipment.findFirst({ where: { OR: [{ awb: ref }, { order: { number: ref } }], cod: true }, orderBy: { createdAt: "desc" }, select: { codAmount: true } });
    lines.push({ type: "COD", externalRef: ref, paymentRef: ref, orderRef: ref, amount: amt ? parseMoney(amt) : (shipment?.codAmount ?? 0), fee: 0, tax: 0 });
  }
  if (!lines.length) throw new ReconciliationError("List at least one AWB or order number.");
  if (new Set(lines.map((l) => l.externalRef)).size !== lines.length) throw new ReconciliationError("Each AWB / order can only be listed once.");
  return importSettlement(
    { provider: "COD", externalId: input.reference.trim(), settledAt: input.date, deposited: input.amount, lines, source: "manual", note: input.courier ? `Courier: ${input.courier}` : null },
    actorId,
  );
}

// ─────────────────────────────── Dashboard ───────────────────────────────

export async function reconciliationOverview(opts: { provider?: string; status?: string; from?: Date; to?: Date } = {}) {
  const where: Prisma.SettlementWhereInput = {
    provider: opts.provider || undefined,
    status: opts.status || undefined,
    settledAt: opts.from || opts.to ? { gte: opts.from, lte: opts.to } : undefined,
  };
  const [settlements, totals] = await Promise.all([
    db.settlement.findMany({ where, orderBy: { settledAt: "desc" }, take: 200 }),
    db.settlement.groupBy({ by: ["provider"], where, _sum: { gross: true, refunds: true, fees: true, feeTax: true, net: true, deposited: true, matched: true, unmatched: true, mismatched: true }, _count: true }),
  ]);
  return { settlements, totals };
}

/** Online payments captured more than `days` ago that no settlement has matched yet. */
export async function unsettledPayments(days = 7, take = 50) {
  const before = new Date(Date.now() - days * 86400_000);
  const settled = await db.settlementLine.findMany({ where: { type: "PAYMENT", status: { not: "UNMATCHED" }, orderId: { not: null } }, select: { orderId: true } });
  const ids = settled.map((s) => s.orderId!);
  return db.payment.findMany({
    where: { provider: { in: ["STRIPE", "RAZORPAY"] }, status: "CAPTURED", amount: { gt: 0 }, createdAt: { lt: before }, orderId: { notIn: ids } },
    include: { order: { select: { number: true } } },
    orderBy: { createdAt: "asc" },
    take,
  });
}

/** Delivered COD orders whose cash no remittance has covered yet. */
export async function unremittedCod(take = 50) {
  const remitted = await db.settlementLine.findMany({ where: { type: "COD", status: { not: "UNMATCHED" }, orderId: { not: null } }, select: { orderId: true } });
  return db.shipment.findMany({
    where: { cod: true, codAmount: { gt: 0 }, status: "DELIVERED", orderId: { notIn: remitted.map((r) => r.orderId!) } },
    include: { order: { select: { number: true } } },
    orderBy: { deliveredAt: "asc" },
    take,
  });
}
