"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateVariantInventory } from "@/actions/admin-inventory";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { toMajor } from "@/lib/admin-shared";

export type VariantSettingsInitial = {
  id: string;
  sku: string;
  costPrice: number | null;
  reorderPoint: number | null;
  reorderQty: number | null;
  barcode: string | null;
  supplierId: string | null;
};

const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

/** Cost price (₹), reorder point/qty, barcode and preferred supplier for one variant. */
export function VariantSettingsForm({
  initial,
  suppliers,
  defaultReorderPoint,
  backHref,
}: {
  initial: VariantSettingsInitial;
  suppliers: { id: string; name: string; isActive: boolean }[];
  defaultReorderPoint: number;
  backHref: string;
}) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [f, setF] = useState({
    costPrice: initial.costPrice === null ? "" : String(toMajor(initial.costPrice)),
    reorderPoint: initial.reorderPoint === null ? "" : String(initial.reorderPoint),
    reorderQty: initial.reorderQty === null ? "" : String(initial.reorderQty),
    barcode: initial.barcode ?? "",
    supplierId: initial.supplierId ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <form
      className="grid gap-6 p-5 sm:grid-cols-2 lg:grid-cols-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            updateVariantInventory({
              variantId: initial.id,
              costPrice: numOrNull(f.costPrice),
              reorderPoint: numOrNull(f.reorderPoint),
              reorderQty: numOrNull(f.reorderQty),
              barcode: f.barcode,
              supplierId: f.supplierId || null,
            }),
          { onSuccess: () => router.push(backHref) },
        );
      }}
    >
      <Field label="Cost price ₹" hint="Landed cost per unit; blank = unknown">
        <Input type="number" min={0} step={0.01} inputMode="decimal" value={f.costPrice} onChange={(e) => set("costPrice", e.target.value)} />
      </Field>
      <Field label="Reorder point" hint={`Blank = store default (${defaultReorderPoint})`}>
        <Input type="number" min={0} step={1} inputMode="numeric" value={f.reorderPoint} onChange={(e) => set("reorderPoint", e.target.value)} />
      </Field>
      <Field label="Reorder qty" hint="Blank = top up to 2× reorder point">
        <Input type="number" min={1} step={1} inputMode="numeric" value={f.reorderQty} onChange={(e) => set("reorderQty", e.target.value)} />
      </Field>
      <Field label="Barcode" hint="EAN/UPC or internal code">
        <Input value={f.barcode} onChange={(e) => set("barcode", e.target.value)} maxLength={64} pattern="[A-Za-z0-9._\-]{3,64}" className="font-mono" />
      </Field>
      <Field label="Preferred supplier">
        <Select value={f.supplierId} onChange={(e) => set("supplierId", e.target.value)}>
          <option value="">None</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id} disabled={!s.isActive && s.id !== initial.supplierId}>
              {s.name}
              {s.isActive ? "" : " (inactive)"}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex items-end justify-end gap-3 sm:col-span-2 lg:col-span-5">
        <Button type="button" size="sm" variant="ghost" onClick={() => router.push(backHref)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          Save {initial.sku}
        </Button>
      </div>
    </form>
  );
}
