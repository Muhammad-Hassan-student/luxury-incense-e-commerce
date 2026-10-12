import { useTranslations } from "next-intl";
import type { ReturnCondition, ReturnResolution, ReturnStatus } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/field";
import { formatMoney } from "@/lib/money";
import { RETURN_REASONS, returnStatusTone, returnTimeline } from "@/lib/returns";
import { cn } from "@/lib/utils";
import { useIntlLocale } from "@/i18n/format";
import { CancelReturn } from "./returns";

export type ReturnCardData = {
  id: string;
  number: string;
  status: ReturnStatus;
  reason: string;
  customerNote: string | null;
  rejectionReason: string | null;
  preferred: ReturnResolution;
  resolution: ReturnResolution | null;
  refundAmount: number | null;
  restockingFee: number;
  refundMethod: string | null;
  requestedAt: Date;
  approvedAt: Date | null;
  receivedAt: Date | null;
  resolvedAt: Date | null;
  rejectedAt: Date | null;
  cancelledAt: Date | null;
  items: { id: string; quantity: number; condition: ReturnCondition | null; orderItem: { name: string; label: string } }[];
  giftCardCode?: string | null;
  exchangeOrderNumber?: string | null;
};

// Message keys in RETURN_REASONS order; reasons are stored in English.
const REASON_KEYS = ["reason_notExpected", "reason_damaged", "reason_wrongItem", "reason_notForMe", "reason_late", "reason_other"] as const;
// returnTimeline's English step labels → message keys (stop steps use the status label).
const STEP_KEYS: Record<string, "step_requested" | "step_approved" | "step_received" | "step_refunded" | "step_exchanged" | "step_credited"> = {
  Requested: "step_requested",
  Approved: "step_approved",
  Received: "step_received",
  Refunded: "step_refunded",
  Exchanged: "step_exchanged",
  Credited: "step_credited",
};
const METHOD_KEYS = ["PROVIDER", "MANUAL", "GIFT_CARD", "STORE_CREDIT"] as const;
const gold = (c: React.ReactNode) => <span className="text-gold">{c}</span>;
const strong = (c: React.ReactNode) => <span className="text-fg">{c}</span>;

/** One return on the customer's order page: status, progress, pieces and outcome. */
export function ReturnCard({ r, orderNumber }: { r: ReturnCardData; orderNumber: string }) {
  const t = useTranslations("returns");
  const locale = useIntlLocale();
  const day = (d: Date) => d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  const steps = returnTimeline(r);
  const reasonIdx = (RETURN_REASONS as readonly string[]).indexOf(r.reason);
  const reason = reasonIdx >= 0 ? t(REASON_KEYS[reasonIdx]) : r.reason;
  const stepLabel = (s: (typeof steps)[number]) =>
    s.tone === "stop" && (r.status === "REJECTED" || r.status === "CANCELLED") ? t(`status_${r.status}`) : STEP_KEYS[s.label] ? t(STEP_KEYS[s.label]) : s.label;
  const methods = (r.refundMethod ?? "")
    .split("+")
    .filter(Boolean)
    .map((m) => ((METHOD_KEYS as readonly string[]).includes(m) ? t(`method_${m as (typeof METHOD_KEYS)[number]}`) : m.toLowerCase()));
  const methodText = new Intl.ListFormat(locale, { type: "conjunction" }).format(methods);
  return (
    <article className="border border-line p-6" aria-label={t("cardLabel", { number: r.number })}>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">{t("eyebrow")}</p>
          <h3 className="font-display text-2xl">{r.number}</h3>
        </div>
        <Badge tone={returnStatusTone(r.status)}>{t(`status_${r.status}`)}</Badge>
      </div>

      <ol className="mt-8 grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label={t("progress")}>
        {steps.map((s) => (
          <li key={s.key} className="relative">
            <div className={cn("h-px", s.tone === "done" ? "bg-gold" : s.tone === "stop" ? "bg-ember" : "bg-line-strong")} />
            <span className={cn("absolute -top-1 size-2 rounded-full", s.tone === "done" ? "bg-gold" : s.tone === "stop" ? "bg-ember" : "bg-line-strong")} />
            <p className={cn("mt-4 pe-2 text-[0.625rem] uppercase tracking-[0.08em] sm:text-[0.6875rem] sm:tracking-[0.2em]", s.tone === "todo" ? "text-subtle" : s.tone === "stop" ? "text-ember" : "text-fg")}>{stepLabel(s)}</p>
            {s.at && <p className="mt-1 text-xs text-subtle">{day(s.at)}</p>}
          </li>
        ))}
      </ol>

      <ul className="mt-8 space-y-1 text-sm">
        {r.items.map((i) => (
          <li key={i.id} className="flex justify-between gap-4">
            <span>
              {i.orderItem.name} <span className="text-muted">· {i.orderItem.label}</span>
            </span>
            <span className="text-muted">× {i.quantity}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-subtle">
        {t("askedFor", { reason, resolution: r.preferred })}
        {r.customerNote && <> · “{r.customerNote}”</>}
      </p>

      {r.status === "APPROVED" && (
        <p className="mt-6 border-t border-line pt-4 text-sm text-muted">
          {t.rich("approvedNote", { number: r.number, gold })}
        </p>
      )}
      {r.status === "REJECTED" && r.rejectionReason && (
        <p className="mt-6 border-t border-ember/40 pt-4 text-sm text-ember">{t("rejectedNote", { reason: r.rejectionReason })}</p>
      )}
      {r.status === "REFUNDED" && r.refundAmount != null && (
        <p className="mt-6 border-t border-line pt-4 text-sm text-muted">
          {r.resolution !== "STORE_CREDIT"
            ? t.rich("refunded", { amount: formatMoney(r.refundAmount), method: methodText, strong })
            : r.giftCardCode
              ? t.rich("storeCreditCode", { amount: formatMoney(r.refundAmount), code: r.giftCardCode, strong, gold })
              : t.rich("storeCredit", { amount: formatMoney(r.refundAmount), strong })}
          {r.restockingFee > 0 && ` ${t("restockingFee", { fee: formatMoney(r.restockingFee) })}`}
        </p>
      )}
      {r.status === "EXCHANGED" && (
        <p className="mt-6 border-t border-line pt-4 text-sm text-muted">
          {r.exchangeOrderNumber
            ? t.rich("exchanged", { number: r.exchangeOrderNumber, gold })
            : t("exchangedNoNumber")}
        </p>
      )}
      {r.status === "REQUESTED" && (
        <div className="mt-6 border-t border-line pt-4">
          <CancelReturn returnId={r.id} number={orderNumber} rma={r.number} />
        </div>
      )}
    </article>
  );
}
