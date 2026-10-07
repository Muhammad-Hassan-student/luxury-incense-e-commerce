"use client";

import { useState } from "react";
import type { TradeStatus, TradeTerms } from "@/generated/prisma/enums";
import { approveTradeAccount, reactivateTradeAccount, rejectTradeAccount, saveTradeStaffNotes, suspendTradeAccount } from "@/actions/admin-trade";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { TERMS, TERMS_LABEL } from "@/components/trade/trade-rules";
import { formatMoney } from "@/lib/money";
import { toMajor } from "@/lib/admin-shared";

export type TierOption = { id: string; name: string; discountPercent: number; minOrderValue: number };

/** Approve (pending/rejected) or update terms (approved): tier, payment terms, credit limit, minimum-order override. */
export function TradeTermsForm({
  id,
  status,
  tiers,
  initial,
}: {
  id: string;
  status: TradeStatus;
  tiers: TierOption[];
  initial: { tierId: string | null; terms: TradeTerms; creditLimit: number; minOrderValue: number };
}) {
  const { pending, run } = useAdminAction();
  const [f, setF] = useState({
    tierId: initial.tierId ?? "",
    terms: initial.terms,
    creditLimit: initial.creditLimit ? String(toMajor(initial.creditLimit)) : "",
    minOrderValue: initial.minOrderValue ? String(toMajor(initial.minOrderValue)) : "",
  });
  const tier = tiers.find((t) => t.id === f.tierId);
  const approving = status !== "APPROVED";
  const credit = f.terms !== "PREPAID";

  return (
    <form
      className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-6 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          approveTradeAccount({
            id,
            tierId: f.tierId || null,
            terms: f.terms,
            creditLimit: credit ? Number(f.creditLimit || 0) : 0,
            minOrderValue: Number(f.minOrderValue || 0),
          }),
        );
      }}
    >
      <Field label="Price tier" hint={tier ? `${tier.discountPercent}% off retail · tier minimum ${tier.minOrderValue ? formatMoney(tier.minOrderValue) : "none"}` : "No tier = retail prices, no minimum"}>
        <Select value={f.tierId} onChange={(e) => setF({ ...f, tierId: e.target.value })} disabled={pending}>
          <option value="">No tier</option>
          {tiers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} — {t.discountPercent}%
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Payment terms">
        <Select value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value as TradeTerms })} disabled={pending}>
          {TERMS.map((t) => (
            <option key={t} value={t}>
              {TERMS_LABEL[t]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Credit limit ₹" hint={credit ? "Unpaid invoices + a new order must stay within this" : "Not used on prepaid terms"}>
        <Input type="number" min={0} step={1} value={credit ? f.creditLimit : ""} disabled={!credit || pending} required={credit} onChange={(e) => setF({ ...f, creditLimit: e.target.value })} />
      </Field>
      <Field label="Minimum order override ₹" hint="Blank or 0 = use the tier’s minimum">
        <Input type="number" min={0} step={1} value={f.minOrderValue} disabled={pending} onChange={(e) => setF({ ...f, minOrderValue: e.target.value })} />
      </Field>
      <div className="col-span-full flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {approving ? (status === "REJECTED" ? "Approve after all" : "Approve account") : "Save terms"}
        </Button>
      </div>
    </form>
  );
}

export function RejectForm({ id }: { id: string }) {
  const { pending, run } = useAdminAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        Decline application
      </Button>
    );
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => rejectTradeAccount({ id, reason }), { onSuccess: () => setOpen(false) });
      }}
    >
      <Field label="Reason (sent to the applicant)">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={1000} rows={3} disabled={pending} />
      </Field>
      <div className="flex gap-3">
        <Button type="submit" size="sm" variant="danger" disabled={pending || reason.trim().length < 3}>
          Decline and email
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function SuspendControls({ id, status }: { id: string; status: TradeStatus }) {
  const { pending, run } = useAdminAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (status === "SUSPENDED")
    return (
      <Button size="sm" disabled={pending} onClick={() => run(() => reactivateTradeAccount({ id }))}>
        Reactivate account
      </Button>
    );
  if (status !== "APPROVED") return null;
  if (!open)
    return (
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        Suspend account
      </Button>
    );
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => suspendTradeAccount({ id, reason }), { onSuccess: () => setOpen(false) });
      }}
    >
      <Field label="Note to the buyer (optional)" hint="New orders and quotes are blocked; existing invoices are unaffected">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={3} disabled={pending} />
      </Field>
      <div className="flex gap-3">
        <Button type="submit" size="sm" variant="danger" disabled={pending}>
          Suspend and email
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function TradeStaffNotes({ id, notes, canEdit, kind = "account" }: { id: string; notes: string; canEdit: boolean; kind?: "account" }) {
  const { pending, run } = useAdminAction();
  const [value, setValue] = useState(notes);
  if (!canEdit) return <p className="whitespace-pre-wrap text-sm text-muted">{notes || "No notes."}</p>;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (kind === "account") run(() => saveTradeStaffNotes({ id, notes: value }));
      }}
    >
      <Field label="Internal notes" hint="Never shown to the buyer">
        <Textarea value={value} onChange={(e) => setValue(e.target.value)} maxLength={5000} rows={4} disabled={pending} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="outline" disabled={pending || value === notes}>
          Save notes
        </Button>
      </div>
    </form>
  );
}
