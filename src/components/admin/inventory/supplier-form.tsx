"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveSupplier, setSupplierActive } from "@/actions/admin-purchasing";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useAdminAction } from "@/components/admin/use-admin-action";

export type SupplierInitial = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  leadTimeDays: number;
  notes: string | null;
  isActive: boolean;
};

export function SupplierForm({ initial, backHref }: { initial?: SupplierInitial; backHref: string }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [f, setF] = useState({
    name: initial?.name ?? "",
    contactName: initial?.contactName ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    leadTimeDays: String(initial?.leadTimeDays ?? 14),
    notes: initial?.notes ?? "",
    isActive: initial?.isActive ?? true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  return (
    <form
      className="grid gap-6 p-5 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveSupplier({ id: initial?.id, ...f, leadTimeDays: Number(f.leadTimeDays || 0) }), { onSuccess: () => router.push(backHref) });
      }}
    >
      <Field label="Name" className="lg:col-span-2">
        <Input value={f.name} onChange={(e) => set("name", e.target.value)} required minLength={2} maxLength={120} />
      </Field>
      <Field label="Contact person">
        <Input value={f.contactName} onChange={(e) => set("contactName", e.target.value)} maxLength={120} />
      </Field>
      <Field label="Lead time (days)">
        <Input type="number" min={0} max={365} step={1} inputMode="numeric" value={f.leadTimeDays} onChange={(e) => set("leadTimeDays", e.target.value)} required />
      </Field>
      <Field label="Email">
        <Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} maxLength={200} />
      </Field>
      <Field label="Phone">
        <Input type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} maxLength={40} />
      </Field>
      <label className="flex items-center gap-3 self-end pb-3 text-sm">
        <input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} className="size-4 accent-[var(--gold)]" />
        Active
      </label>
      <Field label="Notes" className="sm:col-span-2 lg:col-span-4">
        <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} maxLength={2000} placeholder="Payment terms, minimum order, batch notes…" />
      </Field>
      <div className="flex items-end justify-end gap-3 sm:col-span-2 lg:col-span-4">
        <Button type="button" size="sm" variant="ghost" onClick={() => router.push(backHref)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {initial ? "Save supplier" : "Add supplier"}
        </Button>
      </div>
    </form>
  );
}

export function SupplierActiveButton({ id, name, isActive }: { id: string; name: string; isActive: boolean }) {
  const { pending, run } = useAdminAction();
  return (
    <Button
      type="button"
      size="sm"
      variant={isActive ? "danger" : "outline"}
      disabled={pending}
      onClick={() => {
        if (isActive && !window.confirm(`Deactivate ${name}? Existing POs stay; it won't be offered for new ones.`)) return;
        run(() => setSupplierActive({ id, isActive: !isActive }));
      }}
    >
      {isActive ? "Deactivate" : "Reactivate"}
    </Button>
  );
}
