import Link from "next/link";
import { Download } from "lucide-react";
import { Badge, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { AccountingTabs, money2 } from "@/components/admin/accounting/tabs";
import { SyncDocumentsButton } from "@/components/admin/accounting/forms";
import { Empty, Kpi, PageHeader, Pagination, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { can, requirePermission } from "@/server/roles";
import { getAccountingSettings, setupProblems } from "@/server/accounting/settings";
import { pendingDocuments } from "@/server/accounting/documents";
import { buildGstr1, documentsInRange, einvoiceFor, istRange, prepare } from "@/server/accounting/exports";
import { creditNoteBucket, gstDate, gstr1Bucket, istParts, stateName } from "@/lib/gst";
import { param, parsePage } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accounting" };

const PER_PAGE = 25;
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function monthRange(now = new Date()) {
  const p = istParts(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = new Date(Date.UTC(p.y, p.m, 0)).getUTCDate();
  return { from: `${p.y}-${pad(p.m)}-01`, to: `${p.y}-${pad(p.m)}-${pad(last)}` };
}

const EXPORTS = [
  { type: "sales-register", label: "Sales register (CSV)" },
  { type: "gstr1-json", label: "GSTR-1 (JSON)" },
  { type: "gstr1-csv", label: "GSTR-1 (CSV)" },
  { type: "tally-xml", label: "Tally vouchers (XML)" },
  { type: "tally-csv", label: "Tally vouchers (CSV)" },
  { type: "zoho-invoices", label: "Zoho Books invoices" },
  { type: "zoho-credit-notes", label: "Zoho Books credit notes" },
  { type: "einvoice-json", label: "E-invoice JSON (B2B)" },
] as const;

export default async function AccountingPage(props: PageProps<"/admin/accounting">) {
  const user = await requirePermission("accounting.view");
  const canManage = can(user, "accounting.manage");
  const sp = await props.searchParams;
  const def = monthRange();
  const from = isDay(param(sp.from)) ? param(sp.from) : def.from;
  const to = isDay(param(sp.to)) && param(sp.to) >= from ? param(sp.to) : def.to;
  const page = parsePage(sp.page);

  const settings = await getAccountingSettings();
  const missing = setupProblems(settings);
  const [pending, docs] = await Promise.all([pendingDocuments(), documentsInRange(from, to)]);
  const ctx = await prepare(docs);
  const g = buildGstr1(docs, { gstin: settings.gstin, invoiceTotals: ctx.totals, invoiceNumbers: ctx.numbers, invoiceDates: ctx.dates }, istRange(from, to).start);
  const invoices = docs.filter((d) => d.kind === "INVOICE");
  const notes = docs.filter((d) => d.kind === "CREDIT_NOTE");
  const sum = (ds: typeof docs, f: (d: (typeof docs)[number]) => number) => ds.reduce((n, d) => n + f(d), 0);
  const net = (f: (d: (typeof docs)[number]) => number) => sum(invoices, f) - sum(notes, f);
  const einv = docs.filter((d) => d.b2b).map((d) => einvoiceFor(d, settings, ctx.numbers, ctx.dates));
  const pages = Math.max(1, Math.ceil(docs.length / PER_PAGE));
  const shown = [...docs].sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime()).slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const qs = (over: Record<string, string | number>) => {
    const s = new URLSearchParams({ from, to, ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])) });
    return `/admin/accounting?${s}`;
  };

  const sections: { key: string; label: string; s: { count: number; taxable: number; tax: number; value: number }; sign?: -1 }[] = [
    { key: "b2b", label: "B2B — registered buyers (4A)", s: g.summary.b2b },
    { key: "b2cl", label: "B2C large — inter-state > ₹1 lakh (5)", s: g.summary.b2cl },
    { key: "b2cs", label: "B2C small — others (7)", s: g.summary.b2cs },
    { key: "exp", label: "Exports (6A)", s: g.summary.exports },
    { key: "cdnr", label: "Credit notes — registered (9B)", s: g.summary.cdnr, sign: -1 },
    { key: "cdnur", label: "Credit notes — unregistered (9B)", s: g.summary.cdnur, sign: -1 },
    { key: "b2csn", label: "Credit notes netted in B2C small", s: g.summary.b2csNotes, sign: -1 },
  ];

  return (
    <>
      <PageHeader eyebrow="Finance" title="Accounting">
        GST invoices &amp; credit notes, GSTR-1, Tally and Zoho exports for any period.
      </PageHeader>
      <AccountingTabs active="overview" canManage={canManage} />

      {!settings.enabled || missing.length ? (
        <div className="mb-8 border border-gold/40 bg-gold/5 px-5 py-4 text-sm">
          <p className="text-fg">GST numbering is {settings.enabled ? "on but incomplete" : "off"}.</p>
          <p className="mt-1 text-muted">
            {missing.length ? `Still needed: ${missing.join(", ")}. ` : ""}Orders keep their INV- numbers until it is set up.{" "}
            {canManage ? (
              <Link href="/admin/accounting/settings" className={linkClass}>
                Open settings
              </Link>
            ) : null}
          </p>
        </div>
      ) : pending && (pending.invoices || pending.creditNotes) ? (
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border border-gold/40 bg-gold/5 px-5 py-4 text-sm">
          <p>
            {pending.invoices} confirmed order{pending.invoices === 1 ? "" : "s"} without an invoice number and {pending.creditNotes} cancellation{pending.creditNotes === 1 ? "" : "s"} without a credit note. Issued automatically every night.
          </p>
          {canManage ? <SyncDocumentsButton /> : null}
        </div>
      ) : null}

      <form method="get" className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-[12rem_12rem_auto] sm:items-end">
        <label className="block">
          <span className="eyebrow !text-muted">From</span>
          <Input type="date" name="from" defaultValue={from} />
        </label>
        <label className="block">
          <span className="eyebrow !text-muted">To</span>
          <Input type="date" name="to" defaultValue={to} />
        </label>
        <Button type="submit" size="sm" variant="outline" className="col-span-2 sm:col-span-1">
          Show period
        </Button>
      </form>

      <div className="mb-8 grid grid-cols-2 gap-px lg:grid-cols-5">
        <Kpi label="Invoices" value={invoices.length} hint={`${notes.length} credit note${notes.length === 1 ? "" : "s"}`} />
        <Kpi label="Net taxable value" value={money2(net((d) => d.taxableValue))} />
        <Kpi label="CGST + SGST" value={money2(net((d) => d.cgst + d.sgst))} hint={`${money2(net((d) => d.cgst))} each side`} />
        <Kpi label="IGST" value={money2(net((d) => d.igst))} />
        <Kpi label="Net invoice value" value={money2(net((d) => d.total))} />
      </div>

      <Section title="Downloads" className="mb-8">
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {EXPORTS.map((e) => (
            <Button key={e.type} asChild size="sm" variant="outline" className="justify-start">
              <a href={`/api/admin/export/accounting?type=${e.type}&from=${from}&to=${to}`} download>
                <Download className="size-3.5 shrink-0" aria-hidden /> {e.label}
              </a>
            </Button>
          ))}
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-muted">
          Spreadsheet cells starting with = + − @ are neutralised. Credit notes are negative in the sales register. E-invoice JSON follows the NIC schema v1.1 for bulk upload to the IRP; IRNs are not generated here.
        </p>
      </Section>

      <div className="mb-8 grid gap-8 lg:grid-cols-2">
        <Section title={`GSTR-1 · ${gstDate(new Date(`${from}T12:00:00+05:30`))} – ${gstDate(new Date(`${to}T12:00:00+05:30`))}`}>
          <Table className="min-w-[520px]">
            <thead>
              <tr>
                <Th>Section</Th>
                <Th className="text-right">Docs</Th>
                <Th className="text-right">Taxable</Th>
                <Th className="text-right">Tax</Th>
              </tr>
            </thead>
            <tbody>
              {sections.map((x) => (
                <tr key={x.key}>
                  <Td className="text-xs">{x.label}</Td>
                  <Td className="text-right tabular-nums">{x.s.count}</Td>
                  <Td className="text-right tabular-nums">{money2((x.sign ?? 1) * x.s.taxable)}</Td>
                  <Td className="text-right tabular-nums">{money2((x.sign ?? 1) * x.s.tax)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>

        <Section title="HSN summary (net of credit notes)">
          {g.summary.hsn.length ? (
            <Table className="min-w-[520px]">
              <thead>
                <tr>
                  <Th>HSN</Th>
                  <Th className="text-right">Qty</Th>
                  <Th className="text-right">Taxable</Th>
                  <Th className="text-right">Tax</Th>
                </tr>
              </thead>
              <tbody>
                {g.summary.hsn.map((h, i) => (
                  <tr key={`${h.hsn_sc}-${h.rt}-${i}`}>
                    <Td className="font-mono text-xs">
                      {h.hsn_sc || <span className="text-ember">missing</span>} <span className="text-subtle">@{h.rt}%</span>
                    </Td>
                    <Td className="text-right tabular-nums">{h.qty}</Td>
                    <Td className="text-right tabular-nums">{money2(Math.round(h.txval * 100))}</Td>
                    <Td className="text-right tabular-nums">{money2(Math.round((h.iamt + h.camt + h.samt) * 100))}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty>No documents in this period.</Empty>
          )}
        </Section>
      </div>

      {einv.length ? (
        <Section title={`E-invoice readiness · ${einv.filter((e) => e.json).length} of ${einv.length} B2B documents ready`} className="mb-8">
          <ul className="divide-y divide-line">
            {einv.map((e) => (
              <li key={e.number} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3 text-sm">
                <span className="font-mono text-xs">{e.number}</span>
                {e.problems.length ? <span className="text-xs text-ember">{e.problems.join(" · ")}</span> : <Badge tone="muted">Ready</Badge>}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title={`Documents · ${docs.length}`}>
        {shown.length ? (
          <Table className="min-w-[860px]">
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Date</Th>
                <Th>Order</Th>
                <Th>Buyer</Th>
                <Th>Place of supply</Th>
                <Th>Section</Th>
                <Th className="text-right">Taxable</Th>
                <Th className="text-right">GST</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id}>
                  <Td className="whitespace-nowrap font-mono text-xs">
                    {d.number}
                    {d.kind === "CREDIT_NOTE" ? <span className="block text-subtle">vs {d.invoiceId ? ctx.numbers.get(d.invoiceId) : "—"}</span> : null}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{gstDate(d.issuedAt)}</Td>
                  <Td>
                    <Link href={`/admin/orders/${d.orderId}`} className={linkClass}>
                      {d.order.number}
                    </Link>
                  </Td>
                  <Td className="max-w-48 truncate text-xs">
                    {d.buyerName}
                    {d.buyerGstin ? <span className="block font-mono text-subtle">{d.buyerGstin}</span> : null}
                  </Td>
                  <Td className="text-xs">
                    {stateName(d.placeOfSupply)} <span className="text-subtle">{d.interState ? "IGST" : "CGST+SGST"}</span>
                  </Td>
                  <Td>
                    <Badge tone={d.kind === "CREDIT_NOTE" ? "ember" : "muted"}>{d.kind === "INVOICE" ? gstr1Bucket(d) : creditNoteBucket(d, d.invoiceId ? (ctx.totals.get(d.invoiceId) ?? 0) : 0)}</Badge>
                  </Td>
                  <Td className="text-right tabular-nums">{money2((d.kind === "CREDIT_NOTE" ? -1 : 1) * d.taxableValue)}</Td>
                  <Td className="text-right tabular-nums">{money2((d.kind === "CREDIT_NOTE" ? -1 : 1) * (d.cgst + d.sgst + d.igst))}</Td>
                  <Td className="text-right tabular-nums">{money2((d.kind === "CREDIT_NOTE" ? -1 : 1) * d.total)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>{settings.enabled ? "No GST documents dated in this period." : "No GST documents yet — turn numbering on in Settings."}</Empty>
        )}
        <Pagination page={page} pages={pages} href={(p) => qs({ page: p })} />
      </Section>
    </>
  );
}
