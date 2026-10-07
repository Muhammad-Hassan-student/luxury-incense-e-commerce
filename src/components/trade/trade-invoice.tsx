import type { TradeTerms } from "@/generated/prisma/enums";
import type { InvoiceData } from "@/server/invoices";
import { InvoiceDocument } from "@/components/account/invoice-document";
import { INVOICE_STATE_LABEL, TERMS_LABEL, businessTypeLabel, type InvoiceState } from "./trade-rules";

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

const date = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/**
 * The store's invoice renderer, plus a trade block (PO, buyer tax ID, terms, due date, payment state).
 * The block carries the `mo-invoice` class so it prints with the invoice and uses the same paper styling.
 */
export function TradeInvoice({ invoice, trade, backHref, backLabel }: { invoice: InvoiceData; trade: TradeInvoiceExtras; backHref: string; backLabel: string }) {
  const withTerms: InvoiceData = {
    ...invoice,
    paymentMethod: `${invoice.paymentMethod} · ${TERMS_LABEL[trade.terms]}${trade.dueDate && !trade.paidAt ? ` · due ${date(trade.dueDate)}` : ""}`,
  };
  const rows: [string, string][] = [
    ["Buyer", `${trade.businessName} (${businessTypeLabel(trade.businessType)})`],
    ["Buyer GSTIN / tax ID", trade.taxId ?? "—"],
    ["Your PO number", trade.poNumber ?? "—"],
    ["Payment terms", trade.proforma ? "Prepaid — proforma, goods dispatched after payment" : TERMS_LABEL[trade.terms]],
    ["Due date", trade.dueDate ? date(trade.dueDate) : "—"],
    ["Payment", trade.paidAt ? `Paid ${date(trade.paidAt)}` : INVOICE_STATE_LABEL[trade.state]],
  ];
  return (
    <>
      <InvoiceDocument invoice={withTerms} backHref={backHref} backLabel={backLabel} />
      <section className="mo-invoice mx-auto mt-4 max-w-[52rem] border border-neutral-300 p-6 sm:px-10" aria-label="Trade terms">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em]">{trade.proforma && !trade.paidAt ? "Proforma — trade terms" : "Trade terms"}</h2>
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
            Please pay by bank transfer quoting {invoice.orderNumber}
            {trade.poNumber ? ` / PO ${trade.poNumber}` : ""}. The amount due is the invoice total of this document.
          </p>
        ) : null}
      </section>
    </>
  );
}
