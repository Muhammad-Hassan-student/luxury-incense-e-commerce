"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import type { ReturnResolution } from "@/generated/prisma/enums";
import { cancelMyReturn, requestReturn } from "@/actions/customer-returns";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { RESOLUTION_LABEL, RETURN_REASONS, RETURN_RESOLUTIONS, type ReturnReason } from "@/lib/returns";
import { cn } from "@/lib/utils";

export type ReturnLine = { orderItemId: string; name: string; label: string; returnable: number; returned: number; blocked: string | null };

const preferredHint: Record<ReturnResolution, string> = {
  REFUND: "Back to your original payment method",
  STORE_CREDIT: "A gift card code to spend on anything in the house",
  EXCHANGE: "The same pieces, sent again at no charge",
};

/** Reveal → choose pieces, quantities, a reason and what you'd like → submit. */
export function RequestReturn({ number, deadline, feePercent, lines }: { number: string; deadline: string; feePercent: number; lines: ReturnLine[] }) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<ReturnReason | "">("");
  const [preferred, setPreferred] = useState<ReturnResolution>("REFUND");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const panelId = useId();
  const chosen = Object.values(qty).reduce((s, n) => s + n, 0);

  return (
    <div className="border border-line p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Something not quite right?</p>
          <p className="text-sm text-muted">
            You can return pieces until {deadline}.{feePercent > 0 ? ` A ${feePercent}% restocking fee applies to refunds and store credit.` : ""}
          </p>
        </div>
        {!open && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-expanded={open} aria-controls={panelId}>
            <Undo2 className="size-3.5" aria-hidden />
            Return items
          </Button>
        )}
      </div>

      {open && (
        <form
          id={panelId}
          className="mt-6 space-y-8 border-t border-line pt-6"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!chosen) return setError("Choose at least one piece to return.");
            if (!reason) return setError("Tell us why you’re returning it.");
            start(async () => {
              const res = await requestReturn({
                number,
                items: Object.entries(qty).map(([orderItemId, quantity]) => ({ orderItemId, quantity })).filter((i) => i.quantity > 0),
                reason,
                preferred,
                note: note.trim() || null,
              });
              if (res.ok) {
                toast(`Return ${res.number} requested — we’ll be in touch shortly`);
                setOpen(false);
                setQty({});
                setReason("");
                setNote("");
                router.refresh();
              } else {
                setError(res.error);
              }
            });
          }}
        >
          <fieldset>
            <legend className="eyebrow !text-muted mb-3">Pieces to return</legend>
            <ul className="divide-y divide-line border-y border-line">
              {lines.map((l) => (
                <li key={l.orderItemId} className="flex flex-wrap items-center justify-between gap-4 py-4">
                  <div>
                    <p className="font-display text-lg">{l.name}</p>
                    <p className="text-xs text-muted">
                      {l.label}
                      {l.returned > 0 && ` · ${l.returned} already in a return`}
                    </p>
                  </div>
                  {l.blocked || l.returnable === 0 ? (
                    <span className="text-xs text-subtle">{l.blocked ?? "Already returned"}</span>
                  ) : (
                    <label className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-muted">
                      Qty
                      <Select
                        className="w-16 py-1.5"
                        value={qty[l.orderItemId] ?? 0}
                        disabled={pending}
                        onChange={(e) => setQty((q) => ({ ...q, [l.orderItemId]: Number(e.target.value) }))}
                        aria-label={`Quantity of ${l.name} to return`}
                      >
                        {Array.from({ length: l.returnable + 1 }, (_, n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </Select>
                    </label>
                  )}
                </li>
              ))}
            </ul>
          </fieldset>

          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="Reason">
              <Select value={reason} onChange={(e) => setReason(e.target.value as ReturnReason | "")} disabled={pending} required>
                <option value="">Choose a reason</option>
                {RETURN_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </Field>
            <fieldset>
              <legend className="eyebrow !text-muted">You’d like</legend>
              <div className="mt-3 flex flex-wrap gap-2" role="radiogroup">
                {RETURN_RESOLUTIONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={preferred === r}
                    disabled={pending}
                    onClick={() => setPreferred(r)}
                    className={cn(
                      "border px-3 py-2 text-[0.6875rem] uppercase tracking-[0.2em] transition-colors duration-500",
                      preferred === r ? "border-gold text-gold" : "border-line-strong text-muted hover:text-fg",
                    )}
                  >
                    {RESOLUTION_LABEL[r]}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-subtle">{preferredHint[preferred]}</p>
            </fieldset>
          </div>

          <Field label="Anything we should know? (optional)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} disabled={pending} className="min-h-20" />
          </Field>

          {error && (
            <p role="alert" className="border border-ember/40 p-4 text-sm text-ember">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-4">
            <Button type="submit" size="sm" disabled={pending || chosen === 0}>
              {pending ? "Sending…" : `Request return${chosen ? ` · ${chosen} piece${chosen === 1 ? "" : "s"}` : ""}`}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
              Back
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Withdraw a request that hasn't been reviewed yet (two-step). */
export function CancelReturn({ returnId, number, rma }: { returnId: string; number: string; rma: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" className="px-0 text-muted" onClick={() => setConfirming(true)}>
        Cancel this return
      </Button>
    );
  }
  return (
    <div role="alertdialog" aria-label={`Cancel return ${rma}`} className="flex flex-wrap items-center gap-4">
      <span className="text-sm text-fg">Cancel return {rma}?</span>
      <Button
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await cancelMyReturn({ returnId, number });
            if (res.ok) {
              toast(`Return ${res.number} cancelled`);
              router.refresh();
            } else {
              toast.error(res.error);
            }
            setConfirming(false);
          })
        }
      >
        {pending ? "Cancelling…" : "Yes, cancel"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
        Keep it
      </Button>
    </div>
  );
}
