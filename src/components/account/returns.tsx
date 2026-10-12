"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReturnResolution } from "@/generated/prisma/enums";
import { cancelMyReturn, requestReturn } from "@/actions/customer-returns";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { RETURN_REASONS, RETURN_RESOLUTIONS, type ReturnReason } from "@/lib/returns";
import { cn } from "@/lib/utils";

export type ReturnLine = { orderItemId: string; name: string; label: string; returnable: number; returned: number; blocked: string | null };

// Message keys in RETURN_REASONS order (the English value is what is sent to the server).
const REASON_KEYS = ["reason_notExpected", "reason_damaged", "reason_wrongItem", "reason_notForMe", "reason_late", "reason_other"] as const;

/** Reveal → choose pieces, quantities, a reason and what you'd like → submit. */
export function RequestReturn({ number, deadline, feePercent, lines }: { number: string; deadline: string; feePercent: number; lines: ReturnLine[] }) {
  const t = useTranslations("returns");
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
          <p className="eyebrow mb-2">{t("requestEyebrow")}</p>
          <p className="text-sm text-muted">
            {t("returnUntil", { date: deadline })}
            {feePercent > 0 ? ` ${t("feeNote", { percent: feePercent })}` : ""}
          </p>
        </div>
        {!open && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-expanded={open} aria-controls={panelId}>
            <Undo2 className="size-3.5" aria-hidden />
            {t("returnItems")}
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
            if (!chosen) return setError(t("chooseOne"));
            if (!reason) return setError(t("tellWhy"));
            start(async () => {
              const res = await requestReturn({
                number,
                items: Object.entries(qty).map(([orderItemId, quantity]) => ({ orderItemId, quantity })).filter((i) => i.quantity > 0),
                reason,
                preferred,
                note: note.trim() || null,
              });
              if (res.ok) {
                toast(t("requestedToast", { number: res.number }));
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
            <legend className="eyebrow !text-muted mb-3">{t("piecesToReturn")}</legend>
            <ul className="divide-y divide-line border-y border-line">
              {lines.map((l) => (
                <li key={l.orderItemId} className="flex flex-wrap items-center justify-between gap-4 py-4">
                  <div>
                    <p className="font-display text-lg">{l.name}</p>
                    <p className="text-xs text-muted">
                      {l.label}
                      {l.returned > 0 && ` · ${t("alreadyInReturn", { count: l.returned })}`}
                    </p>
                  </div>
                  {l.blocked || l.returnable === 0 ? (
                    <span className="text-xs text-subtle">{l.blocked ?? t("alreadyReturned")}</span>
                  ) : (
                    <label className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-muted">
                      {t("qty")}
                      <Select
                        className="w-16 py-1.5"
                        value={qty[l.orderItemId] ?? 0}
                        disabled={pending}
                        onChange={(e) => setQty((q) => ({ ...q, [l.orderItemId]: Number(e.target.value) }))}
                        aria-label={t("qtyLabel", { name: l.name })}
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
            <Field label={t("reason")}>
              <Select value={reason} onChange={(e) => setReason(e.target.value as ReturnReason | "")} disabled={pending} required>
                <option value="">{t("chooseReason")}</option>
                {RETURN_REASONS.map((r, i) => (
                  <option key={r} value={r}>
                    {REASON_KEYS[i] ? t(REASON_KEYS[i]) : r}
                  </option>
                ))}
              </Select>
            </Field>
            <fieldset>
              <legend className="eyebrow !text-muted">{t("youdLike")}</legend>
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
                    {t(`resolution_${r}`)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-subtle">{t(`hint_${preferred}`)}</p>
            </fieldset>
          </div>

          <Field label={t("note")}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} disabled={pending} className="min-h-20" />
          </Field>

          {error && (
            <p role="alert" className="border border-ember/40 p-4 text-sm text-ember">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-4">
            <Button type="submit" size="sm" disabled={pending || chosen === 0}>
              {pending ? t("sending") : t("request", { count: chosen })}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
              {t("back")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Withdraw a request that hasn't been reviewed yet (two-step). */
export function CancelReturn({ returnId, number, rma }: { returnId: string; number: string; rma: string }) {
  const t = useTranslations("returns");
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" className="px-0 text-muted" onClick={() => setConfirming(true)}>
        {t("cancelThis")}
      </Button>
    );
  }
  return (
    <div role="alertdialog" aria-label={t("cancelLabel", { rma })} className="flex flex-wrap items-center gap-4">
      <span className="text-sm text-fg">{t("cancelConfirm", { rma })}</span>
      <Button
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await cancelMyReturn({ returnId, number });
            if (res.ok) {
              toast(t("cancelledToast", { number: res.number }));
              router.refresh();
            } else {
              toast.error(res.error);
            }
            setConfirming(false);
          })
        }
      >
        {pending ? t("cancelling") : t("yesCancel")}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
        {t("keepIt")}
      </Button>
    </div>
  );
}
