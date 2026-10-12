import Link from "next/link";
import { useTranslations } from "next-intl";
import type { InvoiceData } from "@/server/invoices";
import { brand } from "@/config/brand";
import { formatOrderCharge, formatOrderMoney } from "@/lib/money";
import { storeTz } from "@/lib/region-runtime";
import { stateName } from "@/lib/gst";
import { useIntlLocale } from "@/i18n/format";
import { PrintButton } from "./print-button";

// Deliberately plain: white paper, black ink, whatever the site theme. In print, only the invoice is shown.
const css = `
.mo-invoice { background:#fff; color:#111; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif; font-size:13px; line-height:1.5; }
.mo-invoice h1, .mo-invoice h2, .mo-invoice .mo-serif { font-family: Georgia, "Times New Roman", serif; font-weight:400; color:#111; }
.mo-invoice .mo-muted { color:#555; }
.mo-invoice table { width:100%; border-collapse:collapse; }
.mo-invoice th { text-align:start; font-weight:600; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:#333; border-bottom:1.5px solid #111; padding:8px 6px; }
.mo-invoice td { border-bottom:1px solid #ddd; padding:8px 6px; vertical-align:top; }
.mo-invoice .num { text-align:end; font-variant-numeric: tabular-nums; white-space:nowrap; }
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
  // The order's own currency — or the currency the customer was charged in, at the rate frozen at checkout.
  const money = (minor: number) => formatOrderMoney(minor, invoice.money, { fixed: true });
  const l = useTranslations("invoice");
  const locale = useIntlLocale();
  const date = (d: Date) => d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric", timeZone: storeTz() });
  return (
    <>
      <style>{css}</style>
      <div className="mo-invoice-noprint mb-6 flex flex-wrap items-center justify-between gap-4">
        <Link href={backHref} className="link-draw eyebrow">
          {backLabel}
        </Link>
        <PrintButton />
      </div>
      <article className="mo-invoice mx-auto max-w-[52rem] border border-neutral-300 p-6 shadow-sm sm:p-10" aria-label={l("label", { number: invoice.invoiceNumber })}>
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
          <div className="text-start sm:text-end">
            <h1 className="text-2xl">{l("title")}</h1>
            <dl className="mt-3 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-xs sm:justify-end">
              <dt className="mo-muted">{l("invoiceNo")}</dt>
              <dd className="font-semibold">{invoice.invoiceNumber}</dd>
              <dt className="mo-muted">{l("invoiceDate")}</dt>
              <dd>{date(invoice.invoiceDate)}</dd>
              <dt className="mo-muted">{l("orderNo")}</dt>
              <dd>{invoice.orderNumber}</dd>
              <dt className="mo-muted">{l("orderDate")}</dt>
              <dd>{date(invoice.orderDate)}</dd>
              {invoice.gst ? (
                <>
                  <dt className="mo-muted">{l("ourGstin")}</dt>
                  <dd className="font-mono">{invoice.gst.sellerGstin}</dd>
                  {invoice.gst.buyerGstin ? (
                    <>
                      <dt className="mo-muted">{l("buyerGstin")}</dt>
                      <dd className="font-mono">{invoice.gst.buyerGstin}</dd>
                    </>
                  ) : null}
                  <dt className="mo-muted">{l("placeOfSupply")}</dt>
                  <dd>
                    {invoice.gst.placeOfSupply} · {stateName(invoice.gst.placeOfSupply)}
                  </dd>
                </>
              ) : null}
            </dl>
          </div>
        </header>

        {invoice.void && (
          <p className="mt-6 border-2 border-neutral-900 px-4 py-2 text-center text-sm font-semibold uppercase tracking-[0.2em]">
            {invoice.void === "REFUNDED" ? l("voidRefunded") : l("voidCancelled")}
          </p>
        )}

        <section className="grid gap-6 py-6 sm:grid-cols-2">
          <div>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em]">{l("billedTo")}</h2>
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
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em]">{l("shippedTo")}</h2>
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
              <p className="mo-muted text-sm">{l("deliveredByEmail")}</p>
            )}
          </div>
        </section>

        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th scope="col">{l("item")}</th>
                <th scope="col" className="hidden sm:table-cell">{l("sku")}</th>
                <th scope="col" className="num">{l("qty")}</th>
                <th scope="col" className="num">{l("unitPrice")}</th>
                <th scope="col" className="num">{l("amount")}</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line, i) => (
                <tr key={`${line.sku}-${i}`}>
                  <td>
                    <span className="font-medium">{line.name}</span>
                    <span className="mo-muted block text-xs">
                      {line.label}
                      {line.digital && ` · ${l("giftCardNoTax", { label: t.name })}`}
                    </span>
                  </td>
                  <td className="mo-muted hidden text-xs sm:table-cell">{line.sku}</td>
                  <td className="num">{line.quantity}</td>
                  <td className="num">{money(line.unitPrice)}</td>
                  <td className="num">{money(line.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="mt-6 grid gap-8 sm:grid-cols-[1fr_20rem]">
          <div className="text-xs">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em]">{l("taxSummary")}</h2>
            <table>
              <tbody>
                <tr>
                  <td className="mo-muted">{l("taxableValue")}</td>
                  <td className="num">{money(t.taxableValue)}</td>
                </tr>
                {invoice.gst && !invoice.gst.interState ? (
                  <>
                    <tr>
                      <td className="mo-muted">{l("cgst", { rate: t.ratePercent / 2 })}</td>
                      <td className="num">{money(invoice.gst.cgst)}</td>
                    </tr>
                    <tr>
                      <td className="mo-muted">{l("sgst", { rate: t.ratePercent / 2 })}</td>
                      <td className="num">{money(invoice.gst.sgst)}</td>
                    </tr>
                  </>
                ) : invoice.gst ? (
                  <tr>
                    <td className="mo-muted">{l("igst", { rate: t.ratePercent })}</td>
                    <td className="num">{money(invoice.gst.igst)}</td>
                  </tr>
                ) : (
                  <tr>
                    <td className="mo-muted">{l("taxAt", { label: t.label, rate: t.ratePercent })}</td>
                    <td className="num">{money(t.amount)}</td>
                  </tr>
                )}
                {invoice.gst?.hsn.length ? (
                  <tr>
                    <td className="mo-muted">{l("hsn")}</td>
                    <td className="num">{invoice.gst.hsn.join(", ")}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            {invoice.gst?.creditNotes.length ? (
              <p className="mt-2">
                {l("creditNotes", { count: invoice.gst.creditNotes.length, list: invoice.gst.creditNotes.map((c) => `${c.number} (${money(c.total)})`).join(", ") })}
              </p>
            ) : null}
            <p className="mo-muted mt-2">
              {t.inclusive ? l("pricesIncludeTax", { label: t.name }) : l("pricesExcludeTax", { label: t.name })} {l("noTax", { label: t.name })}
            </p>
          </div>

          <dl className="space-y-1.5 text-sm">
            <Row label={l("subtotal")} value={money(invoice.subtotal)} />
            {invoice.discount > 0 && <Row label={invoice.couponCode ? l("discountCode", { code: invoice.couponCode }) : l("discount")} value={`−${money(invoice.discount)}`} />}
            {invoice.pointsRedeemed > 0 && <Row label={`${brand.loyalty.name} (${invoice.pointsRedeemed})`} value={`−${money(invoice.pointsValue)}`} />}
            <Row label={invoice.giftWrap ? l("shippingWrap") : l("shipping")} value={invoice.shippingAndWrap ? money(invoice.shippingAndWrap) : l("free")} />
            {!t.inclusive && <Row label={t.label} value={money(t.amount)} />}
            {t.inclusive && <Row label={t.label} value={money(t.amount)} muted />}
            <div className="flex justify-between border-t border-neutral-900 pt-2 text-base font-semibold">
              <dt>{l("total")}</dt>
              <dd className="num">{money(invoice.total)}</dd>
            </div>
            {invoice.giftCardApplied > 0 && <Row label={l("giftCardApplied")} value={`−${money(invoice.giftCardApplied)}`} />}
            <div className="flex justify-between border-t border-neutral-300 pt-2 font-semibold">
              <dt>{invoice.paid ? l("totalPaid") : l("amountDue")}</dt>
              <dd className="num">{formatOrderCharge(invoice.amountPaid, invoice.money, { fixed: true })}</dd>
            </div>
            <Row label={l("paymentMethod")} value={invoice.paymentMethod} muted />
          </dl>
        </section>

        <footer className="mo-muted mt-10 border-t border-neutral-300 pt-4 text-[11px] leading-relaxed">
          {l("thanks", { store: invoice.store.name, email: invoice.store.email, number: invoice.orderNumber })}
          <br />
          {l("computerGenerated")}
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
