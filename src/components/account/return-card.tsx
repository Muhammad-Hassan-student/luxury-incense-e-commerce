import type { ReturnCondition, ReturnResolution, ReturnStatus } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/field";
import { formatMoney } from "@/lib/money";
import { RESOLUTION_LABEL, RETURN_STATUS_LABEL, refundMethodText, returnStatusTone, returnTimeline } from "@/lib/returns";
import { cn } from "@/lib/utils";
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

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** One return on the customer's order page: status, progress, pieces and outcome. */
export function ReturnCard({ r, orderNumber }: { r: ReturnCardData; orderNumber: string }) {
  const steps = returnTimeline(r);
  return (
    <article className="border border-line p-6" aria-label={`Return ${r.number}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Return</p>
          <h3 className="font-display text-2xl">{r.number}</h3>
        </div>
        <Badge tone={returnStatusTone(r.status)}>{RETURN_STATUS_LABEL[r.status]}</Badge>
      </div>

      <ol className="mt-8 grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="Return progress">
        {steps.map((s) => (
          <li key={s.key} className="relative">
            <div className={cn("h-px", s.tone === "done" ? "bg-gold" : s.tone === "stop" ? "bg-ember" : "bg-line-strong")} />
            <span className={cn("absolute -top-1 size-2 rounded-full", s.tone === "done" ? "bg-gold" : s.tone === "stop" ? "bg-ember" : "bg-line-strong")} />
            <p className={cn("mt-4 pe-2 text-[0.625rem] uppercase tracking-[0.08em] sm:text-[0.6875rem] sm:tracking-[0.2em]", s.tone === "todo" ? "text-subtle" : s.tone === "stop" ? "text-ember" : "text-fg")}>{s.label}</p>
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
        {r.reason} · you asked for {RESOLUTION_LABEL[r.preferred].toLowerCase()}
        {r.customerNote && <> · “{r.customerNote}”</>}
      </p>

      {r.status === "APPROVED" && (
        <p className="mt-6 border-t border-line pt-4 text-sm text-muted">
          Approved — please pack the pieces securely, write <span className="text-gold">{r.number}</span> on the parcel and send it to our atelier. The details are in your email.
        </p>
      )}
      {r.status === "REJECTED" && r.rejectionReason && (
        <p className="mt-6 border-t border-ember/40 pt-4 text-sm text-ember">
          We couldn’t accept this return: {r.rejectionReason}
        </p>
      )}
      {r.status === "REFUNDED" && r.refundAmount != null && (
        <p className="mt-6 border-t border-line pt-4 text-sm text-muted">
          {r.resolution === "STORE_CREDIT" ? (
            <>
              <span className="text-fg">{formatMoney(r.refundAmount)}</span> issued as store credit{r.giftCardCode && <> — code <span className="text-gold">{r.giftCardCode}</span></>}.
            </>
          ) : (
            <>
              <span className="text-fg">{formatMoney(r.refundAmount)}</span> refunded ({refundMethodText(r.refundMethod)}).
            </>
          )}
          {r.restockingFee > 0 && ` A ${formatMoney(r.restockingFee)} restocking fee was deducted.`}
        </p>
      )}
      {r.status === "EXCHANGED" && (
        <p className="mt-6 border-t border-line pt-4 text-sm text-muted">
          Replacement {r.exchangeOrderNumber ? <span className="text-gold">{r.exchangeOrderNumber}</span> : "order"} is on its way at no charge.
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
