"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { buyAgain, cancelMyOrder } from "@/actions/customer-orders";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { useUI } from "@/store/ui";
import type { SelfCancelReason as Reason } from "@/server/invoices";

// Mirrors SELF_CANCEL_REASONS (server-only module); the action validates against the real list.
const REASONS = ["Changed my mind", "Ordered by mistake", "Found it elsewhere", "Delivery takes too long", "Other"] as const satisfies readonly Reason[];

/** Two-step cancel: reveal, choose an optional reason, then confirm. */
export function CancelOrder({ number, refund, amount }: { number: string; refund: boolean; amount: string }) {
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
          <p className="eyebrow mb-2">Changed your mind?</p>
          <p className="text-sm text-muted">
            You can cancel until we pack your order{refund ? ` — the full ${amount} goes back to your original payment method.` : "."}
          </p>
        </div>
        {!open && (
          <Button variant="danger" size="sm" onClick={() => setOpen(true)} aria-expanded={open} aria-controls={panelId}>
            Cancel order
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
                toast(res.refunded ? "Order cancelled — your refund is on its way" : "Order cancelled");
                setOpen(false);
                router.refresh();
              } else {
                setError(res.error);
              }
            });
          }}
        >
          <Field label="Reason (optional)" className="max-w-sm">
            <Select value={reason} onChange={(e) => setReason(e.target.value as Reason | "")} disabled={pending}>
              <option value="">Prefer not to say</option>
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-sm text-fg">
            Cancel order {number}? {refund ? "We’ll refund you in full. " : ""}This can’t be undone.
          </p>
          {error && (
            <p role="alert" className="border border-ember/40 p-4 text-sm text-ember">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-4">
            <Button type="submit" variant="danger" size="sm" disabled={pending}>
              {pending ? "Cancelling…" : refund ? "Yes, cancel and refund" : "Yes, cancel order"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
              Keep my order
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Adds the order's still-available pieces back to the bag, then opens it. */
export function BuyAgain({ number }: { number: string }) {
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
            if (res.partial.length) lines.push(...res.partial.map((p) => `Only ${p.added} of ${p.wanted} × ${p.name} available — added ${p.added}.`));
            if (res.unavailable.length) lines.push(`No longer available: ${res.unavailable.join(", ")}.`);
            if (res.skipped.length) lines.push(`Gift cards aren’t re-added — choose a new recipient from the gift card page.`);
            lines.push(...res.notes);
            setReport(lines.length ? lines : null);
            const count = res.added.length + res.partial.length;
            if (count) {
              toast(`${count} ${count === 1 ? "piece" : "pieces"} added to your bag`);
              router.refresh();
              openPanel("cart");
            } else {
              toast.error("Nothing from this order could be added.");
            }
          })
        }
      >
        <RotateCcw className="size-3.5" aria-hidden />
        {pending ? "Adding…" : "Buy again"}
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
