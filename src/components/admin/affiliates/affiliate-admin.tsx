"use client";

import { useState } from "react";
import { inviteAffiliateAction, reviewCommission, runAffiliateSweepAction, runPayoutBatch, saveAffiliateProgram, setAffiliateStatus, updateAffiliate } from "@/actions/admin-affiliates";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { toMajor } from "@/lib/admin-shared";
import { useAdminAction } from "../use-admin-action";
import { baseSymbol } from "@/lib/money";

export function ProgramSettingsForm({ initial }: { initial: { enabled: boolean; defaultCommissionPercent: number; cookieDays: number; holdDays: number; minPayout: number } }) {
  const { pending, run } = useAdminAction();
  const [f, setF] = useState({ ...initial, defaultCommissionPercent: String(initial.defaultCommissionPercent), cookieDays: String(initial.cookieDays), holdDays: String(initial.holdDays), minPayout: String(toMajor(initial.minPayout)) });
  return (
    <form
      className="grid gap-6 p-5 sm:grid-cols-2 lg:grid-cols-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveAffiliateProgram({ enabled: f.enabled, defaultCommissionPercent: Number(f.defaultCommissionPercent), cookieDays: Math.round(Number(f.cookieDays)), holdDays: Math.round(Number(f.holdDays)), minPayout: Number(f.minPayout) }));
      }}
    >
      <Field label="Default commission %">
        <Input type="number" min={0} max={50} step={0.5} value={f.defaultCommissionPercent} onChange={(e) => setF({ ...f, defaultCommissionPercent: e.target.value })} required />
      </Field>
      <Field label="Cookie window (days)" hint="Last click wins">
        <Input type="number" min={1} max={90} value={f.cookieDays} onChange={(e) => setF({ ...f, cookieDays: e.target.value })} required />
      </Field>
      <Field label="Hold (days)" hint="After confirmation; order must be delivered">
        <Input type="number" min={0} max={120} value={f.holdDays} onChange={(e) => setF({ ...f, holdDays: e.target.value })} required />
      </Field>
      <Field label={`Minimum payout ${baseSymbol()}`}>
        <Input type="number" min={0} step={1} value={f.minPayout} onChange={(e) => setF({ ...f, minPayout: e.target.value })} required />
      </Field>
      <div className="flex flex-col justify-end gap-3">
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} className="size-4 accent-[var(--gold)]" />
          Programme open
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}

export function InviteForm() {
  const { pending, run } = useAdminAction();
  const empty = { email: "", name: "", rate: "", code: "" };
  const [f, setF] = useState(empty);
  return (
    <form
      className="grid gap-6 p-5 sm:grid-cols-2 lg:grid-cols-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => inviteAffiliateAction({ email: f.email, name: f.name, ratePercent: f.rate.trim() ? Number(f.rate) : null, code: f.code }), { onSuccess: () => setF(empty) });
      }}
    >
      <Field label="Email" className="lg:col-span-2">
        <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required placeholder="creator@example.com" />
      </Field>
      <Field label="Name">
        <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} />
      </Field>
      <Field label="Rate %" hint="Blank = default">
        <Input type="number" min={0} max={50} step={0.5} value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
      </Field>
      <Field label="Link code" hint="Blank = generated">
        <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={20} className="font-mono" />
      </Field>
      <div className="flex justify-end sm:col-span-2 lg:col-span-5">
        <Button type="submit" size="sm" disabled={pending}>
          Invite
        </Button>
      </div>
    </form>
  );
}

export function AffiliateActions({ a }: { a: { id: string; code: string; status: string; ratePercent: number | null; couponCode: string | null; hasUser: boolean } }) {
  const { pending, run } = useAdminAction();
  const [f, setF] = useState({ rate: a.ratePercent == null ? "" : String(a.ratePercent), code: a.code, couponCode: a.couponCode ?? "", couponPercent: "10" });
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-3">
        {a.status !== "APPROVED" && a.hasUser ? (
          <button type="button" disabled={pending} onClick={() => run(() => setAffiliateStatus({ id: a.id, status: "APPROVED" }))} className="text-xs uppercase tracking-[0.18em] text-gold hover:text-fg disabled:opacity-50">
            Approve
          </button>
        ) : null}
        {a.status === "APPROVED" || a.status === "PENDING" ? (
          <button type="button" disabled={pending} onClick={() => run(() => setAffiliateStatus({ id: a.id, status: "SUSPENDED" }))} className="text-xs uppercase tracking-[0.18em] text-muted hover:text-ember disabled:opacity-50">
            Suspend
          </button>
        ) : null}
      </div>
      <details className="w-full max-w-xs text-start">
        <summary className="cursor-pointer text-end text-xs uppercase tracking-[0.18em] text-muted hover:text-gold">Edit</summary>
        <form
          className="mt-2 grid gap-3 border border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => updateAffiliate({ id: a.id, ratePercent: f.rate.trim() ? Number(f.rate) : null, code: f.code, couponCode: f.couponCode, couponPercent: Math.round(Number(f.couponPercent) || 10) }));
          }}
        >
          <Field label="Rate %" hint="Blank = default">
            <Input type="number" min={0} max={50} step={0.5} value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
          </Field>
          <Field label="Link code">
            <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={20} className="font-mono" required />
          </Field>
          <Field label="Personal discount code" hint="Created as a % coupon if new">
            <Input value={f.couponCode} onChange={(e) => setF({ ...f, couponCode: e.target.value.toUpperCase() })} maxLength={32} className="font-mono" />
          </Field>
          {f.couponCode && f.couponCode !== (a.couponCode ?? "") ? (
            <Field label="New code % off">
              <Input type="number" min={1} max={50} value={f.couponPercent} onChange={(e) => setF({ ...f, couponPercent: e.target.value })} />
            </Field>
          ) : null}
          <Button type="submit" size="sm" disabled={pending}>
            Save
          </Button>
        </form>
      </details>
    </div>
  );
}

export function CommissionReview({ id, canApprove }: { id: string; canApprove: boolean }) {
  const { pending, run } = useAdminAction();
  return (
    <div className="flex flex-wrap justify-end gap-3">
      {canApprove ? (
        <button type="button" disabled={pending} onClick={() => run(() => reviewCommission({ id, decision: "approve" }))} className="text-xs uppercase tracking-[0.18em] text-gold hover:text-fg disabled:opacity-50">
          Approve
        </button>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm("Reject this commission? The affiliate won’t be paid for this order.")) run(() => reviewCommission({ id, decision: "reject" }));
        }}
        className="text-xs uppercase tracking-[0.18em] text-muted hover:text-ember disabled:opacity-50"
      >
        Reject
      </button>
    </div>
  );
}

export function PayoutControls() {
  const { pending, run } = useAdminAction();
  const [reference, setReference] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm("Mark every approved commission as paid in a new batch?")) run(() => runPayoutBatch({ reference }), { onSuccess: () => setReference("") });
      }}
    >
      <Field label="Bank / UPI batch reference" hint="Optional" className="w-full max-w-xs">
        <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        Create payout batch
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => runAffiliateSweepAction())}>
        Approve matured now
      </Button>
    </form>
  );
}
