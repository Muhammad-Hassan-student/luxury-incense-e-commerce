"use client";

import { useState } from "react";
import type { ReturnCondition, ReturnResolution } from "@/generated/prisma/enums";
import { approveReturnAction, receiveReturnAction, rejectReturnAction, resolveReturnAction, saveReturnNoteAction, saveReturnPolicyAction } from "@/actions/admin-returns";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { CONDITION_LABEL, RESOLUTION_LABEL, RETURN_CONDITIONS, RETURN_RESOLUTIONS, type ReturnSettings } from "@/lib/returns";
import { cn } from "@/lib/utils";
import { useAdminAction } from "./use-admin-action";

/** Decline with a reason the customer will receive by email. Used while REQUESTED or APPROVED. */
function RejectForm({ id, onBack }: { id: string; onBack: () => void }) {
  const { pending, run } = useAdminAction();
  const [reason, setReason] = useState("");
  return (
    <form
      className="space-y-4 border border-ember/40 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => rejectReturnAction({ id, reason }), { onSuccess: onBack });
      }}
    >
      <Field label="Reason (emailed to the customer)">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={1000} className="min-h-16" autoFocus />
      </Field>
      <div className="flex gap-3">
        <Button size="sm" variant="danger" type="submit" disabled={pending || reason.trim().length < 3}>
          {pending ? "Declining…" : "Decline return"}
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onBack}>
          Back
        </Button>
      </div>
    </form>
  );
}

export function ReviewReturn({ id }: { id: string }) {
  const { pending, run } = useAdminAction();
  const [rejecting, setRejecting] = useState(false);
  if (rejecting) return <RejectForm id={id} onBack={() => setRejecting(false)} />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Approving emails the customer instructions to send the pieces back.</p>
      <div className="flex flex-wrap gap-3">
        <Button size="sm" disabled={pending} onClick={() => run(() => approveReturnAction({ id }))}>
          Approve return
        </Button>
        <Button size="sm" variant="danger" disabled={pending} onClick={() => setRejecting(true)}>
          Decline
        </Button>
      </div>
    </div>
  );
}

type ReceiveLine = { id: string; name: string; label: string; quantity: number; canRestock: boolean };

/** Per-line inspection: condition and whether the units go back into sellable stock. */
export function ReceiveReturn({ id, items }: { id: string; items: ReceiveLine[] }) {
  const { pending, run } = useAdminAction();
  const [rejecting, setRejecting] = useState(false);
  const [state, setState] = useState<Record<string, { condition: ReturnCondition; restock: boolean }>>(() =>
    Object.fromEntries(items.map((i) => [i.id, { condition: "RESELLABLE" as ReturnCondition, restock: i.canRestock }])),
  );
  if (rejecting) return <RejectForm id={id} onBack={() => setRejecting(false)} />;
  const restockUnits = items.reduce((s, i) => s + (state[i.id].restock ? i.quantity : 0), 0);

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => receiveReturnAction({ id, items: items.map((i) => ({ itemId: i.id, ...state[i.id] })) }));
      }}
    >
      <p className="text-sm text-muted">Inspect each line as the parcel is opened. Restocked units are added back to stock with a RETURN movement.</p>
      <ul className="divide-y divide-line border-y border-line">
        {items.map((i) => {
          const s = state[i.id];
          return (
            <li key={i.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_10rem_auto] sm:items-center">
              <div>
                <p className="text-sm">
                  {i.name} <span className="text-muted">× {i.quantity}</span>
                </p>
                <p className="text-xs text-subtle">{i.label}</p>
              </div>
              <label className="block">
                <span className="sr-only">Condition of {i.name}</span>
                <Select
                  value={s.condition}
                  disabled={pending}
                  onChange={(e) => {
                    const condition = e.target.value as ReturnCondition;
                    setState((st) => ({ ...st, [i.id]: { condition, restock: i.canRestock && condition === "RESELLABLE" } }));
                  }}
                >
                  {RETURN_CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {CONDITION_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </label>
              <label className={cn("flex items-center gap-2 text-xs uppercase tracking-[0.15em]", i.canRestock ? "text-muted" : "text-subtle")}>
                <input
                  type="checkbox"
                  className="accent-gold"
                  checked={s.restock}
                  disabled={pending || !i.canRestock}
                  onChange={(e) => setState((st) => ({ ...st, [i.id]: { ...st[i.id], restock: e.target.checked } }))}
                />
                {i.canRestock ? "Restock" : "Not in catalogue"}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Button size="sm" type="submit" disabled={pending}>
          {pending ? "Saving…" : `Mark received${restockUnits ? ` · restock ${restockUnits}` : ""}`}
        </Button>
        <Button size="sm" type="button" variant="danger" disabled={pending} onClick={() => setRejecting(true)}>
          Decline
        </Button>
      </div>
    </form>
  );
}

/** Refund preview, pre-formatted on the server: `amount` after the fee, `waived` without it. */
export type ResolveQuote = { feePercent: number; hasFee: boolean; gross: string; fee: string; amount: string; waived: string };

/** Refund / store credit / exchange, with the refund maths shown before confirming. */
export function ResolveReturn({ id, preferred, quote, refundTo }: { id: string; preferred: ReturnResolution; quote: ResolveQuote; refundTo: string }) {
  const { pending, run } = useAdminAction();
  const [resolution, setResolution] = useState<ReturnResolution>(preferred);
  const [waiveFee, setWaiveFee] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const money = resolution !== "EXCHANGE";
  const amount = waiveFee ? quote.waived : quote.amount;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Resolution">
        {RETURN_RESOLUTIONS.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={resolution === r}
            disabled={pending}
            onClick={() => {
              setResolution(r);
              setConfirming(false);
            }}
            className={cn(
              "border px-3 py-2 text-[0.6875rem] uppercase tracking-[0.2em] transition-colors",
              resolution === r ? "border-gold text-gold" : "border-line-strong text-muted hover:text-fg",
            )}
          >
            {RESOLUTION_LABEL[r]}
            {r === preferred ? " · asked" : ""}
          </button>
        ))}
      </div>

      {money ? (
        <dl className="max-w-sm space-y-2 text-sm">
          <div className="flex justify-between gap-6">
            <dt className="text-muted">Paid share of returned lines</dt>
            <dd className="tabular-nums">{quote.gross}</dd>
          </div>
          {quote.hasFee ? (
            <div className="flex justify-between gap-6">
              <dt className="text-muted">Restocking fee ({quote.feePercent}%)</dt>
              <dd className={cn("tabular-nums", waiveFee && "line-through text-subtle")}>−{quote.fee}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-6 border-t border-line pt-2">
            <dt className="eyebrow">{resolution === "STORE_CREDIT" ? "Store credit" : "Refund"}</dt>
            <dd className="font-display text-xl font-light tabular-nums">{amount}</dd>
          </div>
          {quote.hasFee ? (
            <label className="flex items-center gap-2 pt-1 text-xs text-muted">
              <input type="checkbox" className="accent-gold" checked={waiveFee} onChange={(e) => setWaiveFee(e.target.checked)} disabled={pending} />
              Waive the restocking fee
            </label>
          ) : null}
          <p className="text-xs text-subtle">{resolution === "STORE_CREDIT" ? "Issued as a new gift card code, emailed to the customer." : `Goes to: ${refundTo}.`} Loyalty earned on this share is reversed.</p>
        </dl>
      ) : (
        <p className="text-sm text-muted">Creates a zero-value replacement order for the same pieces, ready to pack. Stock is taken now.</p>
      )}

      {confirming ? (
        <div role="alertdialog" aria-label="Confirm resolution" className="space-y-4 border border-gold/40 p-5">
          <p className="text-sm text-fg">
            {resolution === "EXCHANGE" ? "Create the replacement order?" : resolution === "STORE_CREDIT" ? `Issue ${amount} in store credit?` : `Refund ${amount}?`} This cannot be undone.
          </p>
          <div className="flex gap-3">
            <Button size="sm" disabled={pending} onClick={() => run(() => resolveReturnAction({ id, resolution, waiveFee }), { onSuccess: () => setConfirming(false) })}>
              {pending ? "Working…" : "Confirm"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" onClick={() => setConfirming(true)} disabled={pending}>
          {resolution === "EXCHANGE" ? "Send replacement" : resolution === "STORE_CREDIT" ? "Issue store credit" : "Refund"}
        </Button>
      )}
    </div>
  );
}

export function ReturnNote({ id, note }: { id: string; note: string }) {
  const { pending, run } = useAdminAction();
  const [value, setValue] = useState(note);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveReturnNoteAction({ id, note: value }));
      }}
    >
      <Field label="Staff note" hint="Internal — never shown to the customer.">
        <Textarea value={value} onChange={(e) => setValue(e.target.value)} maxLength={5000} />
      </Field>
      <Button size="sm" variant="outline" type="submit" disabled={pending || value === note}>
        Save note
      </Button>
    </form>
  );
}

export function ReturnPolicyForm({ settings, categories }: { settings: ReturnSettings; categories: { slug: string; name: string }[] }) {
  const { pending, run } = useAdminAction();
  const [s, setS] = useState(settings);
  const toggleCat = (slug: string) =>
    setS((x) => ({ ...x, nonReturnableCategories: x.nonReturnableCategories.includes(slug) ? x.nonReturnableCategories.filter((c) => c !== slug) : [...x.nonReturnableCategories, slug] }));

  return (
    <form
      className="grid gap-6 p-5 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveReturnPolicyAction(s));
      }}
    >
      <label className="flex items-center gap-3 text-sm sm:col-span-3">
        <input type="checkbox" className="accent-gold" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} disabled={pending} />
        Customers can request returns online
      </label>
      <Field label="Return window (days after delivery)">
        <Input type="number" min={1} max={365} value={s.windowDays} onChange={(e) => setS({ ...s, windowDays: Number(e.target.value) })} disabled={pending} />
      </Field>
      <Field label="Restocking fee (%)" hint="Refunds & store credit; staff can waive it.">
        <Input type="number" min={0} max={50} step="0.5" value={s.restockingFeePercent} onChange={(e) => setS({ ...s, restockingFeePercent: Number(e.target.value) })} disabled={pending} />
      </Field>
      <fieldset>
        <legend className="eyebrow !text-muted">Non-returnable categories</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {categories.map((c) => {
            const on = s.nonReturnableCategories.includes(c.slug);
            return (
              <button
                key={c.slug}
                type="button"
                aria-pressed={on}
                onClick={() => toggleCat(c.slug)}
                disabled={pending}
                className={cn("border px-2.5 py-1 text-[0.625rem] uppercase tracking-[0.2em] transition-colors", on ? "border-ember/60 text-ember" : "border-line-strong text-muted hover:text-fg")}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="sm:col-span-3">
        <Button size="sm" variant="outline" type="submit" disabled={pending}>
          Save policy
        </Button>
      </div>
    </form>
  );
}
