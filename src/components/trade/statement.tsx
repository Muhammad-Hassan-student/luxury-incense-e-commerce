import type { TradeTerms } from "@/generated/prisma/enums";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { INVOICE_STATE_LABEL, TERMS_LABEL, invoiceStateTone, type InvoiceState } from "./trade-rules";

export type StatementView = {
  outstanding: number;
  openInvoices: number;
  overdue: number;
  overdueInvoices: number;
  creditLimit: number;
  creditAvailable: number | null;
  creditUsedPercent: number;
};

/** Account statement: outstanding, overdue and credit available, with a usage bar. Used by the portal and admin. */
export function TradeStatementCard({ statement, terms, className }: { statement: StatementView; terms: TradeTerms; className?: string }) {
  const s = statement;
  const credit = s.creditAvailable !== null;
  return (
    <section className={cn("border border-line", className)} aria-label="Account statement">
      <div className="grid gap-px bg-line sm:grid-cols-3">
        <Figure label="Outstanding" value={formatMoney(s.outstanding)} hint={`${s.openInvoices} open invoice${s.openInvoices === 1 ? "" : "s"}`} />
        <Figure label="Overdue" value={formatMoney(s.overdue)} hint={s.overdueInvoices ? `${s.overdueInvoices} past due` : "Nothing overdue"} tone={s.overdue > 0 ? "ember" : undefined} />
        <Figure
          label={credit ? "Credit available" : "Payment terms"}
          value={credit ? formatMoney(s.creditAvailable!) : TERMS_LABEL[terms]}
          hint={credit ? `of ${formatMoney(s.creditLimit)} · ${TERMS_LABEL[terms]}` : "Proforma invoices — we ship once paid"}
          tone={credit ? "gold" : undefined}
        />
      </div>
      {credit ? (
        <div className="border-t border-line px-6 py-4">
          <div className="flex items-center justify-between text-[0.625rem] uppercase tracking-[0.2em] text-subtle">
            <span>Credit used</span>
            <span className="tabular-nums">{s.creditUsedPercent}%</span>
          </div>
          <div className="mt-2 h-px w-full bg-line-strong" role="progressbar" aria-valuenow={s.creditUsedPercent} aria-valuemin={0} aria-valuemax={100} aria-label="Credit used">
            <div className={cn("h-px", s.creditUsedPercent >= 90 ? "bg-ember" : "bg-gold")} style={{ width: `${s.creditUsedPercent}%` }} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "gold" | "ember" }) {
  return (
    <div className="bg-bg p-6 md:p-8">
      <p className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">{label}</p>
      <p className={cn("mt-3 font-display text-3xl tabular-nums md:text-4xl", tone === "gold" && "text-gold", tone === "ember" && "text-ember")}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function InvoiceStateBadge({ state }: { state: InvoiceState }) {
  return <Badge tone={invoiceStateTone(state)}>{INVOICE_STATE_LABEL[state]}</Badge>;
}
