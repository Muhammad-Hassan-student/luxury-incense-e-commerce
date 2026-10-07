import Link from "next/link";
import type { InvoiceData } from "@/server/invoices";
import { brand } from "@/config/brand";
import { PrintButton } from "./print-button";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (minor: number) => inr.format(minor / 100);
const date = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

// Deliberately plain: white paper, black ink, whatever the site theme. In print, only the invoice is shown.
const css = `
.mo-invoice { background:#fff; color:#111; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif; font-size:13px; line-height:1.5; }
.mo-invoice h1, .mo-invoice h2, .mo-invoice .mo-serif { font-family: Georgia, "Times New Roman", serif; font-weight:400; color:#111; }
.mo-invoice .mo-muted { color:#555; }
.mo-invoice table { width:100%; border-collapse:collapse; }
.mo-invoice th { text-align:left; font-weight:600; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:#333; border-bottom:1.5px solid #111; padding:8px 6px; }
.mo-invoice td { border-bottom:1px solid #ddd; padding:8px 6px; vertical-align:top; }
.mo-invoice .num { text-align:right; font-variant-numeric: tabular-nums; white-space:nowrap; }
.mo-invoice a { color:#111; }
@media print {
  @page { size: A4; margin: 14mm; }
  html, body { background:#fff !important; color:#000 !important; }
  body::before, body::after { display:none !important; }
  body *:not(:has(.mo-invoice)):not(.mo-invoice):not(.mo-invoice *) { display:none !important; }
  :has(> .mo-invoice), :has(.mo-invoice) { background:#fff !important; padding:0 !important; margin:0 !important; border:0 !important; max-width:none !important; min-height:0 !important; display:block !important; }
  .mo-invoice { border:0 !important; box-shadow:none !important; padding:0 !important; margin:0 !important; max-width:none !important; }
  .mo-invoice-noprint { display:none !important; }
  .mo-invoice tr { break-inside: avoid; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

export function InvoiceDocument({ invoice, backHref, backLabel }: { invoice: InvoiceData; backHref: string; backLabel: string }) {
  const t = invoice.tax;
  return (
    <>
      <style>{css}</style>
      <div className="mo-invoice-noprint mb-6 flex flex-wrap items-center justify-between gap-4">
        <Link href={backHref} className="link-draw eyebrow">
          {backLabel}
        </Link>
        <PrintButton />
      </div>
      <article className="mo-invoice mx-auto max-w-[52rem] border border-neutral-300 p-6 shadow-sm sm:p-10" aria-label={`Tax invoice ${invoice.invoiceNumber}`}>
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-neutral-900 pb-6">
          <div>
            <p className="mo-serif text-3xl tracking-[0.18em]">{invoice.store.name.toUpperCase()}</p>
            <p className="mo-muted mt-1 text-xs">{invoice.store.tagline}</p>
            <p className="mo-muted mt-3 text-xs leading-relaxed">
              {invoice.store.email}
              <br />
              {invoice.store.phone} · {invoice.store.website}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <h1 className="text-2xl">Tax invoice</h1>
            <dl className="mt-3 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-xs sm:justify-end">
              <dt className="mo-muted">Invoice no.</dt>
              <dd className="font-semibold">{invoice.invoiceNumber}</dd>
              <dt className="mo-muted">Invoice date</dt>
              <dd>{date(invoice.invoiceDate)}</dd>
              <dt className="mo-muted">Order no.</dt>
              <dd>{invoice.orderNumber}</dd>
              <dt className="mo-muted">Order date</dt>
              <dd>{date(invoice.orderDate)}</dd>
            </dl>
          </div>
        </header>

        {invoice.void && (
          <p className="mt-6 border-2 border-neutral-900 px-4 py-2 text-center text-sm font-semibold uppercase tracking-[0.2em]">
            {invoice.void === "REFUNDED" ? "Order cancelled and refunded" : "Order cancelled"}
          </p>
        )}

        <section className="grid gap-6 py-6 sm:grid-cols-2">
          <div>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em]">Billed to</h2>
            <p className="text-sm leading-relaxed">
              {invoice.billTo.name}
              <br />
              {invoice.billTo.lines.map((l) => (
                <span key={l}>
                  {l}
                  <br />
                </span>
              ))}
              <span className="mo-muted">{invoice.billTo.email}</span>
              {invoice.billTo.phone && <span className="mo-muted"> · {invoice.billTo.phone}</span>}
            </p>
          </div>
          <div>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em]">Shipped to</h2>
            {invoice.shipTo ? (
              <p className="text-sm leading-relaxed">
                {invoice.shipTo.name}
                <br />
                {invoice.shipTo.lines.map((l) => (
                  <span key={l}>
                    {l}
                    <br />
                  </span>
                ))}
              </p>
            ) : (
              <p className="mo-muted text-sm">Delivered by email</p>
            )}
          </div>
        </section>

        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="hidden sm:table-cell">SKU</th>
                <th scope="col" className="num">Qty</th>
                <th scope="col" className="num">Unit price</th>
                <th scope="col" className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l, i) => (
                <tr key={`${l.sku}-${i}`}>
                  <td>
                    <span className="font-medium">{l.name}</span>
                    <span className="mo-muted block text-xs">
                      {l.label}
                      {l.digital && " · gift card (no GST)"}
                    </span>
                  </td>
                  <td className="mo-muted hidden text-xs sm:table-cell">{l.sku}</td>
                  <td className="num">{l.quantity}</td>
                  <td className="num">{money(l.unitPrice)}</td>
                  <td className="num">{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="mt-6 grid gap-8 sm:grid-cols-[1fr_20rem]">
          <div className="text-xs">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em]">Tax summary</h2>
            <table>
              <tbody>
                <tr>
                  <td className="mo-muted">Taxable value</td>
                  <td className="num">{money(t.taxableValue)}</td>
                </tr>
                <tr>
                  <td className="mo-muted">
                    {t.label} @ {t.ratePercent}%
                  </td>
                  <td className="num">{money(t.amount)}</td>
                </tr>
              </tbody>
            </table>
            <p className="mo-muted mt-2">
              {t.inclusive ? "Prices include GST. " : "GST is charged on top of listed prices. "}
              Shipping, gift wrap and gift cards carry no GST.
            </p>
          </div>

          <dl className="space-y-1.5 text-sm">
            <Row label="Subtotal" value={money(invoice.subtotal)} />
            {invoice.discount > 0 && <Row label={`Discount${invoice.couponCode ? ` (${invoice.couponCode})` : ""}`} value={`−${money(invoice.discount)}`} />}
            {invoice.pointsRedeemed > 0 && <Row label={`${brand.loyalty.name} (${invoice.pointsRedeemed})`} value={`−${money(invoice.pointsValue)}`} />}
            <Row label={invoice.giftWrap ? "Shipping & gift wrap" : "Shipping"} value={invoice.shippingAndWrap ? money(invoice.shippingAndWrap) : "Free"} />
            {!t.inclusive && <Row label={t.label} value={money(t.amount)} />}
            {t.inclusive && <Row label={t.label} value={money(t.amount)} muted />}
            <div className="flex justify-between border-t border-neutral-900 pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd className="num">{money(invoice.total)}</dd>
            </div>
            {invoice.giftCardApplied > 0 && <Row label="Gift card applied" value={`−${money(invoice.giftCardApplied)}`} />}
            <div className="flex justify-between border-t border-neutral-300 pt-2 font-semibold">
              <dt>{invoice.paid ? "Total paid" : "Amount due on delivery"}</dt>
              <dd className="num">{money(invoice.amountPaid)}</dd>
            </div>
            <Row label="Payment method" value={invoice.paymentMethod} muted />
          </dl>
        </section>

        <footer className="mo-muted mt-10 border-t border-neutral-300 pt-4 text-[11px] leading-relaxed">
          Thank you for choosing {invoice.store.name}. Questions about this invoice? Write to {invoice.store.email} quoting {invoice.orderNumber}.
          <br />
          This is a computer-generated invoice and does not require a signature.
        </footer>
      </article>
    </>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${muted ? "mo-muted text-xs" : ""}`}>
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}
