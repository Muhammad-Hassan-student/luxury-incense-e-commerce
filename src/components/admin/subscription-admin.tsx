"use client";

import { useState } from "react";
import { adminChangeSubscription, saveSubscriptionSettingsAction } from "@/actions/admin-subscriptions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useAdminAction } from "./use-admin-action";

type Change = "skip" | "pause" | "resume" | "cancel" | "renew_now";
const LABELS: Record<Change, { label: string; confirm: string; danger?: boolean }> = {
  renew_now: { label: "Renew now", confirm: "Create the renewal order now and charge the saved card (or email a payment link)?" },
  skip: { label: "Skip next", confirm: "Skip the next renewal for this customer?" },
  pause: { label: "Pause", confirm: "Pause this subscription? Nothing will be charged until it is resumed." },
  resume: { label: "Resume", confirm: "Resume this subscription? The next renewal is tomorrow at the earliest." },
  cancel: { label: "Cancel", confirm: "Cancel this subscription? An unpaid renewal is released too. This can’t be undone.", danger: true },
};

/** Row actions with an inline confirmation step. */
export function SubscriptionRowActions({ id, status, processing }: { id: string; status: "ACTIVE" | "PAUSED" | "CANCELLED"; processing: boolean }) {
  const { pending, run } = useAdminAction();
  const [ask, setAsk] = useState<Change | null>(null);
  if (status === "CANCELLED") return <span className="text-xs text-subtle">—</span>;
  const options: Change[] = status === "ACTIVE" ? (processing ? ["pause", "cancel"] : ["renew_now", "skip", "pause", "cancel"]) : ["resume", "cancel"];
  if (ask) {
    return (
      <div className="flex max-w-xs flex-col gap-2">
        <p className="text-xs text-fg">{LABELS[ask].confirm}</p>
        <div className="flex gap-2">
          <Button size="sm" variant={LABELS[ask].danger ? "danger" : "primary"} disabled={pending} onClick={() => run(() => adminChangeSubscription({ id, change: { type: ask } }), { onSuccess: () => setAsk(null) })}>
            {pending ? "…" : "Confirm"}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setAsk(null)}>
            Back
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Button key={o} size="sm" variant={LABELS[o].danger ? "danger" : "outline"} onClick={() => setAsk(o)}>
          {LABELS[o].label}
        </Button>
      ))}
    </div>
  );
}

type Settings = { enabled: boolean; discountPercent: number; maxFailures: number; retryDays: number; payWindowDays: number; reminderDays: number };

export function SubscriptionSettingsForm({ initial, canEdit }: { initial: Settings; canEdit: boolean }) {
  const { pending, run } = useAdminAction();
  const [s, setS] = useState(initial);
  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setS((x) => ({ ...x, [k]: Number(e.target.value) }));
  return (
    <form
      className="space-y-6 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveSubscriptionSettingsAction(s));
      }}
    >
      <label className="flex items-center gap-3 text-sm text-fg">
        <input type="checkbox" className="size-4 accent-[var(--gold)]" checked={s.enabled} onChange={(e) => setS((x) => ({ ...x, enabled: e.target.checked }))} disabled={!canEdit || pending} />
        Offer Subscribe &amp; Save on product pages
      </label>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-6">
        <Field label="Discount %" hint="New subscriptions only">
          <Input type="number" min={0} max={50} value={s.discountPercent} onChange={num("discountPercent")} disabled={!canEdit || pending} />
        </Field>
        <Field label="Pause after failures">
          <Input type="number" min={1} max={10} value={s.maxFailures} onChange={num("maxFailures")} disabled={!canEdit || pending} />
        </Field>
        <Field label="Retry after (days)">
          <Input type="number" min={1} max={14} value={s.retryDays} onChange={num("retryDays")} disabled={!canEdit || pending} />
        </Field>
        <Field label="Pay-link window (days)" hint="Stock is held this long">
          <Input type="number" min={1} max={7} value={s.payWindowDays} onChange={num("payWindowDays")} disabled={!canEdit || pending} />
        </Field>
        <Field label="Reminder (days before)">
          <Input type="number" min={1} max={14} value={s.reminderDays} onChange={num("reminderDays")} disabled={!canEdit || pending} />
        </Field>
      </div>
      {canEdit ? (
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-subtle">Changing these needs the “Store settings” permission.</p>
      )}
    </form>
  );
}
