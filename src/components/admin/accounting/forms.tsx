"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deletePayout, fetchPayouts, importPayoutCsv, rematchPayout, saveAccountingSettingsAction, saveCodRemittance, saveHsnCode, syncAccountingDocuments } from "@/actions/admin-accounting";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { GST_STATES, HSN_SUGGESTIONS } from "@/lib/gst";

// ─────────────────────────────── Documents ───────────────────────────────

export function SyncDocumentsButton({ label = "Issue pending documents" }: { label?: string }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  return (
    <Button type="button" size="sm" disabled={pending} onClick={() => run(() => syncAccountingDocuments(), { onSuccess: () => router.refresh() })}>
      {pending ? "Issuing…" : label}
    </Button>
  );
}

// ─────────────────────────────── Settings ───────────────────────────────

export type AccountingSettingsValue = {
  enabled: boolean;
  legalName: string;
  gstin: string;
  stateCode: string;
  address: string;
  city: string;
  pincode: string;
  email: string;
  phone: string;
  invoicePrefix: string;
  creditNotePrefix: string;
  startsOn: string;
  defaultHsn: string;
  ledgerSales: string;
  ledgerCgst: string;
  ledgerSgst: string;
  ledgerIgst: string;
  ledgerShipping: string;
  ledgerGiftCards: string;
  ledgerCustomers: string;
  tallyCompany: string;
  tolerance: number;
};

export function AccountingSettingsForm({ initial }: { initial: AccountingSettingsValue }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [f, setF] = useState(initial);
  const set = <K extends keyof AccountingSettingsValue>(k: K, v: AccountingSettingsValue[K]) => setF((p) => ({ ...p, [k]: v }));
  const text = (k: keyof AccountingSettingsValue, label: string, extra: { hint?: string; placeholder?: string; maxLength?: number; className?: string; inputMode?: "numeric" | "text" | "email" | "tel" } = {}) => (
    <Field label={label} hint={extra.hint} className={extra.className}>
      <Input value={String(f[k])} onChange={(e) => set(k, e.target.value as never)} placeholder={extra.placeholder} maxLength={extra.maxLength ?? 120} inputMode={extra.inputMode} />
    </Field>
  );

  return (
    <form
      className="grid gap-x-6 gap-y-5 p-5 sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveAccountingSettingsAction(f), { onSuccess: () => router.refresh() });
      }}
    >
      <label className="flex items-start gap-3 text-sm sm:col-span-2 lg:col-span-3">
        <input type="checkbox" checked={f.enabled} onChange={(e) => set("enabled", e.target.checked)} className="mt-0.5 size-4 accent-[var(--gold)]" />
        <span>
          Issue numbered GST invoices and credit notes
          <span className="block text-xs text-muted">Each confirmed order gets the next number in its financial year; refunds and returns get credit notes.</span>
        </span>
      </label>
      {text("legalName", "Legal name (as on GST certificate)")}
      {text("gstin", "Store GSTIN", { placeholder: "07ABCDE1234F1Z5", maxLength: 15 })}
      <Field label="State (registered place of business)" hint="Defaults to the GSTIN's state">
        <Select value={f.stateCode} onChange={(e) => set("stateCode", e.target.value)}>
          <option value="">From GSTIN</option>
          {GST_STATES.map((s) => (
            <option key={s.code} value={s.code}>
              {s.code} · {s.name}
            </option>
          ))}
        </Select>
      </Field>
      {text("address", "Address", { className: "sm:col-span-2", maxLength: 200 })}
      {text("city", "City")}
      {text("pincode", "Pincode", { maxLength: 6, inputMode: "numeric" })}
      {text("email", "Accounts email", { inputMode: "email" })}
      {text("phone", "Phone", { inputMode: "tel", maxLength: 20 })}
      {text("invoicePrefix", "Invoice series prefix", { hint: "e.g. MO → MO/2026-27/00001", maxLength: 4 })}
      {text("creditNotePrefix", "Credit note prefix", { hint: "e.g. CN → CN/2026-27/00001", maxLength: 4 })}
      <Field label="Number orders confirmed from" hint="Earlier orders keep their INV- numbers">
        <Input type="date" value={f.startsOn} onChange={(e) => set("startsOn", e.target.value)} />
      </Field>
      <Field label="Default HSN" hint="When neither product nor category has one">
        <Input value={f.defaultHsn} onChange={(e) => set("defaultHsn", e.target.value)} list="hsn-suggestions" maxLength={8} inputMode="numeric" />
      </Field>
      <datalist id="hsn-suggestions">
        {HSN_SUGGESTIONS.map((h) => (
          <option key={h.code} value={h.code}>
            {h.label}
          </option>
        ))}
      </datalist>
      <Field label="Payout match tolerance (₹)" hint="Differences up to this are treated as equal">
        <Input type="number" min={0} max={100} step={0.01} value={f.tolerance / 100} onChange={(e) => set("tolerance", Math.round(Number(e.target.value || 0) * 100))} />
      </Field>
      <p className="eyebrow pt-4 sm:col-span-2 lg:col-span-3">Tally ledgers</p>
      {text("tallyCompany", "Tally company name", { hint: "Optional; imports into the open company when blank" })}
      {text("ledgerSales", "Sales ledger")}
      {text("ledgerCustomers", "B2C customers ledger")}
      {text("ledgerCgst", "Output CGST")}
      {text("ledgerSgst", "Output SGST")}
      {text("ledgerIgst", "Output IGST")}
      {text("ledgerShipping", "Shipping / other charges")}
      {text("ledgerGiftCards", "Gift cards (liability)")}
      <div className="flex justify-end sm:col-span-2 lg:col-span-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}

// ─────────────────────────────── HSN ───────────────────────────────

export function HsnCell({ kind, id, name, value, fallback }: { kind: "category" | "product"; id: string; name: string; value: string; fallback?: string }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [v, setV] = useState(value);
  const dirty = v !== value;
  const valid = /^(\d{4}|\d{6}|\d{8})?$/.test(v.trim());
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!dirty || !valid) return;
        run(() => saveHsnCode({ kind, id, hsnCode: v.trim() }), { onSuccess: () => router.refresh() });
      }}
    >
      <label className="w-32">
        <span className="sr-only">HSN code for {name}</span>
        <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={fallback ? `${fallback} (inherited)` : "e.g. 33074100"} list="hsn-suggestions" inputMode="numeric" maxLength={8} aria-invalid={!valid || undefined} className="py-1.5 font-mono text-xs" />
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={pending || !dirty || !valid}>
        Save
      </Button>
    </form>
  );
}

export function HsnSuggestions() {
  return (
    <datalist id="hsn-suggestions">
      {HSN_SUGGESTIONS.map((h) => (
        <option key={h.code} value={h.code}>
          {h.label}
        </option>
      ))}
    </datalist>
  );
}

// ─────────────────────────────── Reconciliation ───────────────────────────────

export function FetchPayoutsForm({ from, to, live }: { from: string; to: string; live: { STRIPE: boolean; RAZORPAY: boolean } }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [f, setF] = useState({ provider: "RAZORPAY" as "STRIPE" | "RAZORPAY", from, to });
  return (
    <form
      className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => fetchPayouts(f), { onSuccess: (r) => (r.id ? router.push(`/admin/accounting/reconciliation/${r.id}`) : router.refresh()) });
      }}
    >
      <Field label="Provider" hint={live[f.provider] ? "Live keys from Integrations" : "No keys — builds a test settlement"}>
        <Select value={f.provider} onChange={(e) => setF((p) => ({ ...p, provider: e.target.value as "STRIPE" | "RAZORPAY" }))}>
          <option value="RAZORPAY">Razorpay settlements</option>
          <option value="STRIPE">Stripe payouts</option>
        </Select>
      </Field>
      <Field label="From">
        <Input type="date" value={f.from} onChange={(e) => setF((p) => ({ ...p, from: e.target.value }))} required />
      </Field>
      <Field label="To">
        <Input type="date" value={f.to} onChange={(e) => setF((p) => ({ ...p, to: e.target.value }))} required />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Fetching…" : "Fetch & match"}
      </Button>
    </form>
  );
}

export function ImportCsvForm() {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [provider, setProvider] = useState<"STRIPE" | "RAZORPAY">("RAZORPAY");
  const [csv, setCsv] = useState("");
  const [file, setFile] = useState("");
  const [fallbackId, setFallbackId] = useState("");
  return (
    <form
      className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-[1fr_1.4fr_1fr_auto] lg:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => importPayoutCsv({ provider, csv, fallbackId }), { onSuccess: (r) => (r.id ? router.push(`/admin/accounting/reconciliation/${r.id}`) : router.refresh()) });
      }}
    >
      <Field label="Report">
        <Select value={provider} onChange={(e) => setProvider(e.target.value as "STRIPE" | "RAZORPAY")}>
          <option value="RAZORPAY">Razorpay settlement recon CSV</option>
          <option value="STRIPE">Stripe balance transactions CSV</option>
        </Select>
      </Field>
      <Field label="CSV file" hint={file || "Exported from the provider dashboard"}>
        <Input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const fl = e.target.files?.[0];
            setFile(fl ? fl.name : "");
            setCsv(fl ? await fl.text() : "");
          }}
          className="file:mr-3 file:border-0 file:bg-transparent file:text-xs file:uppercase file:tracking-[0.2em] file:text-gold"
        />
      </Field>
      <Field label="Payout / settlement id" hint="Only if the file has no id column">
        <Input value={fallbackId} onChange={(e) => setFallbackId(e.target.value)} maxLength={120} />
      </Field>
      <Button type="submit" size="sm" variant="outline" disabled={pending || !csv}>
        {pending ? "Importing…" : "Import"}
      </Button>
    </form>
  );
}

export function CodRemittanceForm({ today }: { today: string }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [f, setF] = useState({ reference: "", courier: "Shiprocket", date: today, amount: "", refs: "" });
  return (
    <form
      className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveCodRemittance({ ...f, amount: Number(f.amount) }), { onSuccess: (r) => (r.id ? router.push(`/admin/accounting/reconciliation/${r.id}`) : router.refresh()) });
      }}
    >
      <Field label="Remittance ref / UTR">
        <Input value={f.reference} onChange={(e) => setF((p) => ({ ...p, reference: e.target.value }))} required minLength={3} maxLength={120} />
      </Field>
      <Field label="Courier">
        <Input value={f.courier} onChange={(e) => setF((p) => ({ ...p, courier: e.target.value }))} maxLength={60} />
      </Field>
      <Field label="Received on">
        <Input type="date" value={f.date} onChange={(e) => setF((p) => ({ ...p, date: e.target.value }))} required />
      </Field>
      <Field label="Amount received (₹)">
        <Input type="number" min={0} step={0.01} inputMode="decimal" value={f.amount} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} required />
      </Field>
      <Field label="AWBs or order numbers (one per line, optionally “AWB, amount”)" className="sm:col-span-2 lg:col-span-4">
        <Textarea value={f.refs} onChange={(e) => setF((p) => ({ ...p, refs: e.target.value }))} required placeholder={"MOCK1234567890\nMO-26012345, 2499.00"} className="font-mono text-xs" />
      </Field>
      <div className="flex justify-end sm:col-span-2 lg:col-span-4">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Matching…" : "Record remittance"}
        </Button>
      </div>
    </form>
  );
}

export function SettlementActions({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  return (
    <div className="flex flex-wrap gap-3">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => rematchPayout({ id }), { onSuccess: () => router.refresh() })}>
        Re-match
      </Button>
      <Button
        type="button"
        size="sm"
        variant="danger"
        disabled={pending}
        onClick={() => {
          if (window.confirm(`Remove ${label}? Its lines and matches are deleted; you can import it again.`)) run(() => deletePayout({ id }), { onSuccess: () => router.push("/admin/accounting/reconciliation") });
        }}
      >
        Remove
      </Button>
    </div>
  );
}
