import { useTranslations } from "next-intl";
import type { TradeTerms } from "@/generated/prisma/enums";
import { useIntlLocale } from "@/i18n/format";
import type { InvoiceData } from "@/server/invoices";
import { InvoiceDocument } from "@/components/account/invoice-document";
import { BUSINESS_TYPE_VALUES, type InvoiceState } from "./trade-rules";

export type TradeInvoiceExtras = {
  businessName: string;
  businessType: string;
  taxId: string | null;
  terms: TradeTerms;
  poNumber: string | null;
  dueDate: Date | null;
  paidAt: Date | null;
  state: InvoiceState;
  proforma: boolean;
};

/**
 * The store's invoice renderer, plus a trade block (PO, buyer tax ID, terms, due date, payment state).
 * The block carries the `mo-invoice` class so it prints with the invoice and uses the same paper styling.
 */
export function TradeInvoice({ invoice, trade, backHref, backLabel }: { invoice: InvoiceData; trade: TradeInvoiceExtras; backHref: string; backLabel: string }) {
  const t = useTranslations("trade.invoice");
  const tt = useTranslations("trade");
  const intl = useIntlLocale();
  const date = (d: Date) => d.toLocaleDateString(intl, { day: "2-digit", month: "short", year: "numeric" });
  const termsLabel = tt(`terms_${trade.terms}`);
  const typeLabel = (BUSINESS_TYPE_VALUES as readonly string[]).includes(trade.businessType) ? tt(`businessType_${trade.businessType}` as Parameters<typeof tt>[0]) : trade.businessType;
  const withTerms: InvoiceData = {
    ...invoice,
    paymentMethod:
      trade.dueDate && !trade.paidAt
        ? t("methodDue", { method: invoice.paymentMethod, terms: termsLabel, date: date(trade.dueDate) })
        : t("method", { method: invoice.paymentMethod, terms: termsLabel }),
  };
  const rows: [string, string][] = [
    [t("buyer"), t("buyerValue", { business: trade.businessName, type: typeLabel })],
    [t("buyerTaxId"), trade.taxId ?? "—"],
    [t("poNumber"), trade.poNumber ?? "—"],
    [t("paymentTerms"), trade.proforma ? t("proformaTerms") : termsLabel],
    [t("dueDate"), trade.dueDate ? date(trade.dueDate) : "—"],
    [t("payment"), trade.paidAt ? t("paidOn", { date: date(trade.paidAt) }) : tt(`invoiceState_${trade.state}`)],
  ];
  return (
    <>
      <InvoiceDocument invoice={withTerms} backHref={backHref} backLabel={backLabel} />
      <section className="mo-invoice mx-auto mt-4 max-w-[52rem] border border-neutral-300 p-6 sm:px-10" aria-label={t("tradeTerms")}>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em]">{trade.proforma && !trade.paidAt ? t("proformaTradeTerms") : t("tradeTerms")}</h2>
        <table>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="mo-muted w-48 text-xs">{k}</td>
                <td className="text-sm">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!trade.paidAt && trade.state !== "void" ? (
          <p className="mo-muted mt-3 text-xs">
            {trade.poNumber ? t("payNoteWithPo", { order: invoice.orderNumber, po: trade.poNumber }) : t("payNote", { order: invoice.orderNumber })}
          </p>
        ) : null}
      </section>
    </>
  );
}
