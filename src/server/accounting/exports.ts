import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { GST_STATES, creditNoteBucket, gstDate, gstr1Bucket, isValidGstin, istParts, returnPeriod, stateName, validDocNumber, validHsn, FOREIGN_POS } from "@/lib/gst";
import { csvRow, rupees } from "../invoices";
import { db } from "../db";
import { docTotals, type DocLine } from "./documents";
import type { AccountingSettings } from "./settings";

/*
 * Accounting exports for a date range (IST days, by document date). Every CSV cell goes through csvCell (formula
 * injection guard: = + - @ tab CR are prefixed with '), every XML value through xml() (escaped, control chars stripped).
 * Credit notes are negative in registers and positive (as notes) in GSTR-1 / Tally / Zoho, as those formats expect.
 */

export const EXPORT_TYPES = ["sales-register", "gstr1-json", "gstr1-csv", "tally-xml", "tally-csv", "zoho-invoices", "zoho-credit-notes", "einvoice-json"] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

/** Inclusive IST date range → UTC instants [from, to). */
export function istRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86400_000);
  return { start, end };
}

const docInclude = {
  order: {
    select: {
      number: true,
      email: true,
      shippingAddress: true,
      tradeAccount: { select: { businessName: true, phone: true, address: true } },
      user: { select: { phone: true } },
    },
  },
} satisfies Prisma.TaxDocumentInclude;

export type ExportDoc = Prisma.TaxDocumentGetPayload<{ include: typeof docInclude }>;

export async function documentsInRange(from: string, to: string) {
  const { start, end } = istRange(from, to);
  return db.taxDocument.findMany({ where: { issuedAt: { gte: start, lt: end } }, include: docInclude, orderBy: [{ kind: "asc" }, { fy: "asc" }, { seq: "asc" }] });
}

const tax = (d: { cgst: number; sgst: number; igst: number }) => d.cgst + d.sgst + d.igst;
const sign = (d: { kind: string }) => (d.kind === "CREDIT_NOTE" ? -1 : 1);
const r2 = (minor: number) => Math.round(minor) / 100;
const BOM = "﻿";
const csv = (rows: (string | number | null | undefined)[][]) => BOM + rows.map(csvRow).join("\r\n") + "\r\n";
const posLabel = (code: string) => `${code}-${stateName(code)}`;

// ─────────────────────────────── Sales register ───────────────────────────────

export type DocContext = { numbers: Map<string, string>; dates: Map<string, Date>; totals: Map<string, number> };

export function salesRegisterCsv(docs: ExportDoc[], ctx: DocContext) {
  const rows: (string | number | null)[][] = [
    ["Type", "Number", "Date", "Order", "Buyer", "Buyer GSTIN", "Place of supply", "Supply", "GSTR-1 section", "Taxable value", "CGST", "SGST", "IGST", "Other charges", "Non-GST (gift cards)", "Total", "Against invoice"],
  ];
  for (const d of docs) {
    const s = sign(d);
    const section = d.kind === "INVOICE" ? gstr1Bucket(d) : creditNoteBucket(d, d.invoiceId ? (ctx.totals.get(d.invoiceId) ?? 0) : 0);
    rows.push([
      d.kind === "INVOICE" ? "Tax invoice" : "Credit note",
      d.number,
      gstDate(d.issuedAt),
      d.order.number,
      d.buyerName,
      d.buyerGstin ?? "",
      posLabel(d.placeOfSupply),
      d.interState ? "Inter-state" : "Intra-state",
      section,
      rupees(s * d.taxableValue),
      rupees(s * d.cgst),
      rupees(s * d.sgst),
      rupees(s * d.igst),
      rupees(s * d.otherCharges),
      rupees(s * d.nonGstValue),
      rupees(s * d.total),
      d.invoiceId ? (ctx.numbers.get(d.invoiceId) ?? "") : "",
    ]);
  }
  return csv(rows);
}

/** Loads the invoices credit notes point at (number + value) — some may fall outside the range. */
export async function prepare(docs: ExportDoc[]): Promise<DocContext> {
  const ids = [...new Set(docs.flatMap((d) => (d.invoiceId ? [d.invoiceId] : [])))];
  const invs = ids.length ? await db.taxDocument.findMany({ where: { id: { in: ids } }, select: { id: true, number: true, issuedAt: true, total: true } }) : [];
  return { numbers: new Map(invs.map((i) => [i.id, i.number])), dates: new Map(invs.map((i) => [i.id, i.issuedAt])), totals: new Map(invs.map((i) => [i.id, i.total])) };
}

// ─────────────────────────────── GSTR-1 ───────────────────────────────

type Itm = { txval: number; rt: number; iamt: number; camt: number; samt: number; csamt: number };
const itm = (d: { taxableValue: number; taxRate: number; cgst: number; sgst: number; igst: number }): Itm => ({
  txval: r2(d.taxableValue),
  rt: d.taxRate,
  iamt: r2(d.igst),
  camt: r2(d.cgst),
  samt: r2(d.sgst),
  csamt: 0,
});

export type Gstr1 = ReturnType<typeof buildGstr1>;

/** GSTR-1 sections from the period's documents (GSTN offline-tool JSON shape) plus a human summary. */
export function buildGstr1(docs: ExportDoc[], ctx: { gstin: string; invoiceTotals: Map<string, number>; invoiceNumbers: Map<string, string>; invoiceDates: Map<string, Date> }, period: Date) {
  const invoices = docs.filter((d) => d.kind === "INVOICE");
  const notes = docs.filter((d) => d.kind === "CREDIT_NOTE");

  const b2b = new Map<string, { ctin: string; inv: unknown[] }>();
  const b2cl = new Map<string, { pos: string; inv: unknown[] }>();
  const b2cs = new Map<string, { sply_ty: string; pos: string; typ: string; rt: number; txval: number; iamt: number; camt: number; samt: number; csamt: number }>();
  const exp: unknown[] = [];
  const addB2cs = (d: ExportDoc, s: 1 | -1) => {
    const key = `${d.interState ? "INTER" : "INTRA"}|${d.placeOfSupply}|${d.taxRate}`;
    const row = b2cs.get(key) ?? { sply_ty: d.interState ? "INTER" : "INTRA", pos: d.placeOfSupply, typ: "OE", rt: d.taxRate, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
    row.txval = r2(row.txval * 100 + s * d.taxableValue);
    row.iamt = r2(row.iamt * 100 + s * d.igst);
    row.camt = r2(row.camt * 100 + s * d.cgst);
    row.samt = r2(row.samt * 100 + s * d.sgst);
    b2cs.set(key, row);
  };

  for (const d of invoices) {
    const bucket = gstr1Bucket(d);
    const inv = { inum: d.number, idt: gstDate(d.issuedAt), val: r2(d.total), pos: d.placeOfSupply, rchrg: "N", inv_typ: "R", itms: [{ num: 1, itm_det: itm(d) }] };
    if (bucket === "B2B") {
      const g = b2b.get(d.buyerGstin!) ?? { ctin: d.buyerGstin!, inv: [] };
      g.inv.push(inv);
      b2b.set(d.buyerGstin!, g);
    } else if (bucket === "B2CL") {
      const g = b2cl.get(d.placeOfSupply) ?? { pos: d.placeOfSupply, inv: [] };
      g.inv.push({ inum: inv.inum, idt: inv.idt, val: inv.val, itms: inv.itms });
      b2cl.set(d.placeOfSupply, g);
    } else if (bucket === "EXPORT") {
      exp.push({ exp_typ: "WPAY", inum: d.number, idt: gstDate(d.issuedAt), val: r2(d.total), itms: [{ txval: r2(d.taxableValue), rt: d.taxRate, iamt: r2(d.igst), csamt: 0 }] });
    } else addB2cs(d, 1);
  }

  const cdnr = new Map<string, { ctin: string; nt: unknown[] }>();
  const cdnur: unknown[] = [];
  for (const d of notes) {
    const invTotal = d.invoiceId ? (ctx.invoiceTotals.get(d.invoiceId) ?? 0) : 0;
    const bucket = creditNoteBucket(d, invTotal);
    const nt = { ntty: "C", nt_num: d.number, nt_dt: gstDate(d.issuedAt), val: r2(d.total), pos: d.placeOfSupply, rchrg: "N", inv_typ: "R", itms: [{ num: 1, itm_det: itm(d) }] };
    if (bucket === "CDNR") {
      const g = cdnr.get(d.buyerGstin!) ?? { ctin: d.buyerGstin!, nt: [] };
      g.nt.push(nt);
      cdnr.set(d.buyerGstin!, g);
    } else if (bucket === "CDNUR") {
      cdnur.push({ typ: d.placeOfSupply === FOREIGN_POS ? "EXPWP" : "B2CL", ntty: "C", nt_num: nt.nt_num, nt_dt: nt.nt_dt, val: nt.val, pos: d.placeOfSupply, itms: nt.itms });
    } else addB2cs(d, -1);
  }

  // HSN summary (net of credit notes), split B2B / B2C as GSTR-1 now requires.
  type HsnRow = { hsn_sc: string; desc: string; uqc: string; qty: number; val: number; txval: number; iamt: number; camt: number; samt: number; csamt: number; rt: number };
  const hsn = { b2b: new Map<string, HsnRow>(), b2c: new Map<string, HsnRow>() };
  for (const d of docs) {
    const s = sign(d);
    for (const l of docTotals(d).lines as DocLine[]) {
      const table = d.b2b ? hsn.b2b : hsn.b2c;
      const key = `${l.hsn || "NA"}|${d.taxRate}`;
      const row = table.get(key) ?? { hsn_sc: l.hsn || "", desc: l.name.slice(0, 30), uqc: "NOS", qty: 0, val: 0, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0, rt: d.taxRate };
      row.qty += s * l.qty;
      row.val = r2(row.val * 100 + s * l.amount);
      row.txval = r2(row.txval * 100 + s * l.taxable);
      row.iamt = r2(row.iamt * 100 + s * l.igst);
      row.camt = r2(row.camt * 100 + s * l.cgst);
      row.samt = r2(row.samt * 100 + s * l.sgst);
      table.set(key, row);
    }
  }
  const numbered = (rows: HsnRow[]) => rows.map((r, i) => ({ num: i + 1, ...r }));

  // Documents issued (series ranges).
  const series = (list: ExportDoc[]) => {
    const by = new Map<string, ExportDoc[]>();
    for (const d of list) {
      const prefix = d.number.slice(0, d.number.lastIndexOf("/"));
      by.set(prefix, [...(by.get(prefix) ?? []), d]);
    }
    return [...by.values()].map((ds, i) => ({ num: i + 1, from: ds[0].number, to: ds[ds.length - 1].number, totnum: ds.length, cancel: 0, net_issue: ds.length }));
  };

  const json = {
    gstin: ctx.gstin,
    fp: returnPeriod(period),
    version: "GST3.2",
    hash: "hash",
    b2b: [...b2b.values()],
    b2cl: [...b2cl.values()],
    b2cs: [...b2cs.values()],
    exp: exp.length ? [{ exp_typ: "WPAY", inv: exp }] : [],
    cdnr: [...cdnr.values()],
    cdnur,
    hsn: { hsn_b2b: numbered([...hsn.b2b.values()]), hsn_b2c: numbered([...hsn.b2c.values()]) },
    doc_issue: {
      doc_det: [
        { doc_num: 1, doc_typ: "Invoices for outward supply", docs: series(invoices) },
        { doc_num: 5, doc_typ: "Credit Note", docs: series(notes) },
      ].filter((x) => x.docs.length),
    },
  };

  const sum = (ds: ExportDoc[]) => ({ count: ds.length, taxable: ds.reduce((n, d) => n + d.taxableValue, 0), tax: ds.reduce((n, d) => n + tax(d), 0), value: ds.reduce((n, d) => n + d.total, 0) });
  const summary = {
    b2b: sum(invoices.filter((d) => gstr1Bucket(d) === "B2B")),
    b2cl: sum(invoices.filter((d) => gstr1Bucket(d) === "B2CL")),
    b2cs: sum(invoices.filter((d) => gstr1Bucket(d) === "B2CS")),
    exports: sum(invoices.filter((d) => gstr1Bucket(d) === "EXPORT")),
    cdnr: sum(notes.filter((d) => creditNoteBucket(d, d.invoiceId ? (ctx.invoiceTotals.get(d.invoiceId) ?? 0) : 0) === "CDNR")),
    cdnur: sum(notes.filter((d) => creditNoteBucket(d, d.invoiceId ? (ctx.invoiceTotals.get(d.invoiceId) ?? 0) : 0) === "CDNUR")),
    b2csNotes: sum(notes.filter((d) => creditNoteBucket(d, d.invoiceId ? (ctx.invoiceTotals.get(d.invoiceId) ?? 0) : 0) === "B2CS")),
    b2csRows: [...b2cs.values()],
    hsn: [...hsn.b2b.values(), ...hsn.b2c.values()],
    hsnB2b: [...hsn.b2b.values()],
    hsnB2c: [...hsn.b2c.values()],
    docs: { invoices: series(invoices), creditNotes: series(notes) },
  };
  return { json, summary };
}

export function gstr1Csv(g: Gstr1, docs: ExportDoc[], invoiceTotals: Map<string, number>) {
  const rows: (string | number | null)[][] = [["Section", "GSTIN / POS", "Number", "Date", "Value", "Rate %", "Taxable value", "IGST", "CGST", "SGST", "Cess", "HSN", "Qty"]];
  for (const d of docs) {
    const sec = d.kind === "INVOICE" ? gstr1Bucket(d) : creditNoteBucket(d, d.invoiceId ? (invoiceTotals.get(d.invoiceId) ?? 0) : 0);
    if (sec === "B2CS") continue;
    rows.push([d.kind === "INVOICE" ? sec : sec, d.buyerGstin ?? posLabel(d.placeOfSupply), d.number, gstDate(d.issuedAt), rupees(d.total), d.taxRate, rupees(d.taxableValue), rupees(d.igst), rupees(d.cgst), rupees(d.sgst), "0.00", "", ""]);
  }
  for (const r of g.summary.b2csRows) rows.push(["B2CS", `${posLabel(r.pos)} (${r.sply_ty})`, "", "", "", r.rt, r.txval.toFixed(2), r.iamt.toFixed(2), r.camt.toFixed(2), r.samt.toFixed(2), "0.00", "", ""]);
  for (const [label, list] of [["HSN-B2B", g.summary.hsnB2b], ["HSN-B2C", g.summary.hsnB2c]] as const) {
    for (const h of list) rows.push([label, "", "", "", h.val.toFixed(2), h.rt, h.txval.toFixed(2), h.iamt.toFixed(2), h.camt.toFixed(2), h.samt.toFixed(2), "0.00", h.hsn_sc, h.qty]);
  }
  for (const d of [...g.summary.docs.invoices.map((x) => ({ ...x, t: "Invoices" })), ...g.summary.docs.creditNotes.map((x) => ({ ...x, t: "Credit notes" }))]) {
    rows.push([`DOCS-${d.t}`, "", `${d.from} – ${d.to}`, "", "", "", "", "", "", "", "", "", d.totnum]);
  }
  return csv(rows);
}

// ─────────────────────────────── Tally ───────────────────────────────

/** XML text: escaped, control characters removed. */
export function xml(v: string | number | null | undefined) {
  return String(v ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const tallyDate = (d: Date) => {
  const p = istParts(d);
  return `${p.y}${String(p.m).padStart(2, "0")}${String(p.d).padStart(2, "0")}`;
};

type Entry = { ledger: string; debit: boolean; amount: number };

/** Double entry per document: party Dr / sales, GST, shipping, gift cards Cr (reversed for credit notes). */
export function voucherEntries(d: ExportDoc, s: AccountingSettings): { party: string; entries: Entry[] } {
  const party = d.b2b ? d.buyerName : s.ledgerCustomers;
  const credit = [
    { ledger: s.ledgerSales, amount: d.taxableValue },
    { ledger: s.ledgerCgst, amount: d.cgst },
    { ledger: s.ledgerSgst, amount: d.sgst },
    { ledger: s.ledgerIgst, amount: d.igst },
    { ledger: s.ledgerShipping, amount: d.otherCharges },
    { ledger: s.ledgerGiftCards, amount: d.nonGstValue },
  ].filter((e) => e.amount !== 0);
  const invoice = d.kind === "INVOICE";
  return { party, entries: [{ ledger: party, debit: invoice, amount: d.total }, ...credit.map((e) => ({ ...e, debit: !invoice }))] };
}

export function tallyXml(docs: ExportDoc[], s: AccountingSettings, invoiceNumbers: Map<string, string>) {
  const parties = new Map<string, ExportDoc>();
  for (const d of docs) if (d.b2b) parties.set(d.buyerName, d);
  const ledgerMasters = [...parties.values()].map(
    (d) => `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <LEDGER NAME="${xml(d.buyerName)}" ACTION="Create">
        <NAME>${xml(d.buyerName)}</NAME>
        <PARENT>Sundry Debtors</PARENT>
        <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
        <PARTYGSTIN>${xml(d.buyerGstin)}</PARTYGSTIN>
        <LEDSTATENAME>${xml(stateName(d.placeOfSupply))}</LEDSTATENAME>
        <ISBILLWISEON>Yes</ISBILLWISEON>
      </LEDGER>
    </TALLYMESSAGE>`,
  );
  const vouchers = docs.map((d) => {
    const { party, entries } = voucherEntries(d, s);
    const type = d.kind === "INVOICE" ? "Sales" : "Credit Note";
    const lines = entries
      .map(
        (e) => `        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${xml(e.ledger)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${e.debit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
          <AMOUNT>${(e.debit ? -e.amount / 100 : e.amount / 100).toFixed(2)}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>`,
      )
      .join("\n");
    const against = d.invoiceId ? invoiceNumbers.get(d.invoiceId) : null;
    return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="${type}" ACTION="Create" OBJVIEW="Accounting Voucher View">
        <DATE>${tallyDate(d.issuedAt)}</DATE>
        <VOUCHERTYPENAME>${type}</VOUCHERTYPENAME>
        <VOUCHERNUMBER>${xml(d.number)}</VOUCHERNUMBER>
        <REFERENCE>${xml(against ?? d.order.number)}</REFERENCE>
        <PARTYLEDGERNAME>${xml(party)}</PARTYLEDGERNAME>
        <PARTYNAME>${xml(d.buyerName)}</PARTYNAME>
${d.buyerGstin ? `        <PARTYGSTIN>${xml(d.buyerGstin)}</PARTYGSTIN>\n` : ""}        <PLACEOFSUPPLY>${xml(stateName(d.placeOfSupply))}</PLACEOFSUPPLY>
        <STATENAME>${xml(stateName(d.placeOfSupply))}</STATENAME>
        <NARRATION>${xml(`${type} ${d.number} for order ${d.order.number}${against ? ` against ${against}` : ""}`)}</NARRATION>
${lines}
      </VOUCHER>
    </TALLYMESSAGE>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
${s.tallyCompany ? `        <STATICVARIABLES>\n          <SVCURRENTCOMPANY>${xml(s.tallyCompany)}</SVCURRENTCOMPANY>\n        </STATICVARIABLES>\n` : ""}      </REQUESTDESC>
      <REQUESTDATA>
${[...ledgerMasters, ...vouchers].join("\n")}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
`;
}

/** Flat voucher lines (one row per ledger entry) for Tally import utilities / spreadsheets. */
export function tallyCsv(docs: ExportDoc[], s: AccountingSettings) {
  const rows: (string | number | null)[][] = [["Voucher Date", "Voucher Type", "Voucher Number", "Reference", "Ledger", "Dr/Cr", "Amount", "Party GSTIN", "Place of Supply", "Narration"]];
  for (const d of docs) {
    const { entries } = voucherEntries(d, s);
    for (const e of entries) {
      rows.push([gstDate(d.issuedAt), d.kind === "INVOICE" ? "Sales" : "Credit Note", d.number, d.order.number, e.ledger, e.debit ? "Dr" : "Cr", rupees(e.amount), d.buyerGstin ?? "", stateName(d.placeOfSupply), `Order ${d.order.number}`]);
    }
  }
  return csv(rows);
}

// ─────────────────────────────── Zoho Books ───────────────────────────────

const zohoState = (code: string) => (code === FOREIGN_POS ? "" : (GST_STATES.find((s) => s.code === code)?.alias[0] ?? code));
const treatment = (d: ExportDoc) => (d.b2b ? "business_gst" : d.placeOfSupply === FOREIGN_POS ? "overseas" : "consumer");

/** Zoho Books import: one row per line item; shipping/gift-card values on the first row only. */
export function zohoCsv(docs: ExportDoc[], kind: "INVOICE" | "CREDIT_NOTE", invoiceNumbers: Map<string, string>) {
  const inv = kind === "INVOICE";
  const head = inv
    ? ["Invoice Date", "Invoice Number", "Invoice Status", "Customer Name", "GST Treatment", "GST Identification Number (GSTIN)", "Place of Supply", "Currency Code", "Item Name", "SKU", "HSN/SAC", "Quantity", "Item Price", "Is Inclusive Tax", "Item Tax", "Item Tax %", "Item Tax Type", "Shipping Charge", "Adjustment", "Adjustment Description", "Reference#", "Notes"]
    : ["Credit Note Date", "Credit Note Number", "Credit Note Status", "Customer Name", "GST Treatment", "GST Identification Number (GSTIN)", "Place of Supply", "Currency Code", "Item Name", "SKU", "HSN/SAC", "Quantity", "Item Price", "Is Inclusive Tax", "Item Tax", "Item Tax %", "Item Tax Type", "Shipping Charge", "Adjustment", "Adjustment Description", "Associated Invoice Number", "Notes"];
  const rows: (string | number | null)[][] = [head];
  for (const d of docs.filter((x) => x.kind === kind)) {
    const lines = docTotals(d).lines as DocLine[];
    lines.forEach((l, i) => {
      const qty = l.qty || 1;
      rows.push([
        istIso(d.issuedAt),
        d.number,
        inv ? "Sent" : "Open",
        d.buyerName,
        treatment(d),
        d.buyerGstin ?? "",
        zohoState(d.placeOfSupply),
        "INR",
        l.name,
        l.sku,
        l.hsn,
        qty,
        (l.taxable / qty / 100).toFixed(2),
        "false",
        `${d.interState ? "IGST" : "GST"}${d.taxRate}`,
        d.taxRate,
        "Tax Group",
        i === 0 ? rupees(d.otherCharges) : "",
        i === 0 && d.nonGstValue ? rupees(d.nonGstValue) : "",
        i === 0 && d.nonGstValue ? "Gift cards (no GST)" : "",
        inv ? d.order.number : (d.invoiceId ? (invoiceNumbers.get(d.invoiceId) ?? "") : ""),
        `Order ${d.order.number}`,
      ]);
    });
  }
  return csv(rows);
}

const istIso = (d: Date) => {
  const p = istParts(d);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
};

// ─────────────────────────────── E-invoice (IRN) ───────────────────────────────

type AddressJson = { fullName?: string; phone?: string; line1?: string; line2?: string; city?: string; state?: string; postalCode?: string };
const addr = (v: Prisma.JsonValue | null | undefined): AddressJson => (v && typeof v === "object" && !Array.isArray(v) ? (v as AddressJson) : {});
const clip = (s: string | null | undefined, n: number) => (s ?? "").trim().slice(0, n);

export type EinvoiceResult = { number: string; json: Record<string, unknown> | null; problems: string[] };

/**
 * NIC e-invoice schema v1.1 JSON for B2B invoices and credit notes (bulk upload to the IRP / a GSP). No live IRP call:
 * the portal returns the IRN and signed QR, which are then printed on the invoice.
 */
export function einvoiceFor(d: ExportDoc, s: AccountingSettings, invoiceNumbers: Map<string, string>, invoiceDates: Map<string, Date>): EinvoiceResult {
  const problems: string[] = [];
  if (!d.b2b || !d.buyerGstin) return { number: d.number, json: null, problems: ["Not a B2B document (e-invoicing applies to registered buyers)"] };
  if (!isValidGstin(s.gstin)) problems.push("Store GSTIN missing or invalid");
  if (!isValidGstin(d.buyerGstin)) problems.push("Buyer GSTIN invalid");
  if (!validDocNumber(d.number)) problems.push(`Document number must be ≤16 characters (A–Z 0–9 / -): ${d.number}`);
  if (!/^\d{6}$/.test(s.pincode)) problems.push("Store pincode missing");
  if (!s.address) problems.push("Store address missing");
  const lines = docTotals(d).lines as DocLine[];
  for (const l of lines) if (!validHsn(l.hsn)) problems.push(`${l.sku}: HSN code missing or invalid`);
  const ta = addr(d.order.tradeAccount?.address);
  const ship = addr(d.order.shippingAddress);
  const buyer = ta.line1 ? ta : ship;
  if (!/^\d{6}$/.test(buyer.postalCode ?? "")) problems.push("Buyer pincode missing");
  if (!buyer.line1) problems.push("Buyer address missing");

  const sellerState = s.stateCode;
  const json = {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: "B2B", RegRev: "N", EcmGstin: null, IgstOnIntra: "N" },
    DocDtls: { Typ: d.kind === "INVOICE" ? "INV" : "CRN", No: d.number, Dt: gstDate(d.issuedAt) },
    SellerDtls: {
      Gstin: s.gstin,
      LglNm: clip(s.legalName, 100),
      Addr1: clip(s.address, 100),
      Loc: clip(s.city || "—", 50),
      Pin: Number(s.pincode) || null,
      Stcd: sellerState,
      ...(s.phone ? { Ph: s.phone.replace(/\D/g, "").slice(-12) } : {}),
      ...(s.email ? { Em: clip(s.email, 100) } : {}),
    },
    BuyerDtls: {
      Gstin: d.buyerGstin,
      LglNm: clip(d.buyerName, 100),
      Pos: d.placeOfSupply,
      Addr1: clip(buyer.line1, 100),
      ...(buyer.line2 ? { Addr2: clip(buyer.line2, 100) } : {}),
      Loc: clip(buyer.city || "—", 50),
      Pin: Number(buyer.postalCode) || null,
      Stcd: d.buyerGstin.slice(0, 2),
      ...(d.order.tradeAccount?.phone ? { Ph: d.order.tradeAccount.phone.replace(/\D/g, "").slice(-12) } : {}),
      Em: clip(d.order.email, 100),
    },
    ...(d.kind === "CREDIT_NOTE" && d.invoiceId
      ? { RefDtls: { PrecDocDtls: [{ InvNo: invoiceNumbers.get(d.invoiceId) ?? "", InvDt: invoiceDates.get(d.invoiceId) ? gstDate(invoiceDates.get(d.invoiceId)!) : "" }] } }
      : {}),
    ItemList: lines.map((l, i) => ({
      SlNo: String(i + 1),
      PrdDesc: clip(l.name, 300),
      IsServc: "N",
      HsnCd: l.hsn,
      Qty: l.qty || 1,
      Unit: "NOS",
      UnitPrice: Math.round(l.taxable / (l.qty || 1)) / 100,
      TotAmt: r2(l.taxable),
      Discount: 0,
      AssAmt: r2(l.taxable),
      GstRt: d.taxRate,
      IgstAmt: r2(l.igst),
      CgstAmt: r2(l.cgst),
      SgstAmt: r2(l.sgst),
      CesRt: 0,
      CesAmt: 0,
      CesNonAdvlAmt: 0,
      StateCesRt: 0,
      StateCesAmt: 0,
      StateCesNonAdvlAmt: 0,
      OthChrg: 0,
      TotItemVal: r2(l.taxable + l.cgst + l.sgst + l.igst),
    })),
    ValDtls: {
      AssVal: r2(d.taxableValue),
      CgstVal: r2(d.cgst),
      SgstVal: r2(d.sgst),
      IgstVal: r2(d.igst),
      CesVal: 0,
      StCesVal: 0,
      Discount: 0,
      OthChrg: r2(d.otherCharges + d.nonGstValue),
      RndOffAmt: 0,
      TotInvVal: r2(d.total),
    },
  };
  return { number: d.number, json: problems.length ? null : json, problems };
}
