"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { buyAgain, cancelMyOrder } from "@/actions/customer-orders";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { useUI } from "@/store/ui";
import type { SelfCancelReason as Reason } from "@/server/invoices";

// Mirrors SELF_CANCEL_REASONS (server-only module); the action validates against the real list.
const REASONS = ["Changed my mind", "Ordered by mistake", "Found it elsewhere", "Delivery takes too long", "Other"] as const satisfies readonly Reason[];
// Display labels by value; the English value is what is sent to the server.
const REASON_KEY = {
  "Changed my mind": "cancelReason_changedMind",
  "Ordered by mistake": "cancelReason_mistake",
  "Found it elsewhere": "cancelReason_elsewhere",
  "Delivery takes too long": "cancelReason_slow",
  Other: "cancelReason_other",
} as const satisfies Record<(typeof REASONS)[number], string>;

/** Two-step cancel: reveal, choose an optional reason, then confirm. */
export function CancelOrder({ number, refund, amount }: { number: string; refund: boolean; amount: string }) {
  const t = useTranslations("orders");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason | "">("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const panelId = useId();

  return (
    <div className="border border-line p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">{t("cancelEyebrow")}</p>
          <p className="text-sm text-muted">{refund ? t("cancelUntilRefund", { amount }) : t("cancelUntil")}</p>
        </div>
        {!open && (
          <Button variant="danger" size="sm" onClick={() => setOpen(true)} aria-expanded={open} aria-controls={panelId}>
            {t("cancelOrder")}
          </Button>
        )}
      </div>

      {open && (
        <form
          id={panelId}
          className="mt-6 space-y-6 border-t border-line pt-6"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start(async () => {
              const res = await cancelMyOrder({ number, reason: reason || null, confirm: true });
              if (res.ok) {
                toast(res.refunded ? t("cancelledRefundToast") : t("cancelledToast"));
                setOpen(false);
                router.refresh();
              } else {
                setError(res.error);
              }
            });
          }}
        >
          <Field label={t("reasonOptional")} className="max-w-sm">
            <Select value={reason} onChange={(e) => setReason(e.target.value as Reason | "")} disabled={pending}>
              <option value="">{t("preferNotToSay")}</option>
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(REASON_KEY[r])}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-sm text-fg">{refund ? t("cancelConfirmRefund", { number }) : t("cancelConfirm", { number })}</p>
          {error && (
            <p role="alert" className="border border-ember/40 p-4 text-sm text-ember">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-4">
            <Button type="submit" variant="danger" size="sm" disabled={pending}>
              {pending ? t("cancelling") : refund ? t("yesCancelRefund") : t("yesCancel")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
              {t("keepOrder")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Adds the order's still-available pieces back to the bag, then opens it. */
export function BuyAgain({ number }: { number: string }) {
  const t = useTranslations("orders");
  const [pending, start] = useTransition();
  const [report, setReport] = useState<string[] | null>(null);
  const openPanel = useUI((s) => s.open);
  const router = useRouter();

  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await buyAgain({ number });
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            const lines: string[] = [];
            if (res.partial.length) lines.push(...res.partial.map((p) => t("partial", { added: p.added, wanted: p.wanted, name: p.name })));
            if (res.unavailable.length) lines.push(t("unavailable", { names: res.unavailable.join(", ") }));
            if (res.skipped.length) lines.push(t("giftCardsSkipped"));
            lines.push(...res.notes);
            setReport(lines.length ? lines : null);
            const count = res.added.length + res.partial.length;
            if (count) {
              toast(t("addedToBag", { count }));
              router.refresh();
              openPanel("cart");
            } else {
              toast.error(t("nothingAdded"));
            }
          })
        }
      >
        <RotateCcw className="size-3.5" aria-hidden />
        {pending ? t("adding") : t("buyAgain")}
      </Button>
      {report && (
        <ul role="status" className="space-y-1 text-xs text-muted">
          {report.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
