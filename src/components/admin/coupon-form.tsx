"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DiscountType } from "@/generated/prisma/enums";
import { saveCoupon } from "@/actions/admin-coupons";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { toLocalInput, toMajor } from "@/lib/admin-shared";
import { useAdminAction } from "./use-admin-action";

export type CouponFormInitial = {
  id: string;
  code: string;
  description: string | null;
  type: DiscountType;
  value: number;
  minSubtotal: number;
  maxUses: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
};

/** datetime-local (browser local time) → ISO string the server can parse unambiguously. */
const toIso = (local: string) => (local ? new Date(local).toISOString() : "");

export function CouponForm({ initial }: { initial?: CouponFormInitial }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [f, setF] = useState({
    code: initial?.code ?? "",
    description: initial?.description ?? "",
    type: initial?.type ?? ("PERCENT" as DiscountType),
    value: initial ? String(initial.type === "FIXED" ? toMajor(initial.value) : initial.value) : "",
    minSubtotal: initial ? String(toMajor(initial.minSubtotal)) : "0",
    maxUses: initial?.maxUses ? String(initial.maxUses) : "",
    startsAt: toLocalInput(initial?.startsAt),
    endsAt: toLocalInput(initial?.endsAt),
    isActive: initial?.isActive ?? true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  return (
    <form
      className="grid gap-6 p-5 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            saveCoupon({
              id: initial?.id,
              code: f.code,
              description: f.description,
              type: f.type,
              value: f.type === "FREE_SHIPPING" ? 0 : Number(f.value || 0),
              minSubtotal: Number(f.minSubtotal || 0),
              maxUses: f.maxUses.trim() ? Number(f.maxUses) : null,
              startsAt: toIso(f.startsAt),
              endsAt: toIso(f.endsAt),
              isActive: f.isActive,
            }),
          { onSuccess: () => router.push("/admin/coupons") },
        );
      }}
    >
      <Field label="Code">
        <Input value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase())} required minLength={3} maxLength={32} className="font-mono" />
      </Field>
      <Field label="Description" className="lg:col-span-3">
        <Input value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={200} placeholder="10% off your first order" />
      </Field>
      <Field label="Type">
        <Select value={f.type} onChange={(e) => set("type", e.target.value as DiscountType)}>
          <option value="PERCENT">Percent off</option>
          <option value="FIXED">Fixed amount off</option>
          <option value="FREE_SHIPPING">Free shipping</option>
        </Select>
      </Field>
      <Field label={f.type === "PERCENT" ? "Percent" : f.type === "FIXED" ? "Amount ₹" : "Value"} hint={f.type === "FREE_SHIPPING" ? "Not used for free shipping" : undefined}>
        <Input
          type="number"
          min={0}
          max={f.type === "PERCENT" ? 100 : undefined}
          step={f.type === "PERCENT" ? 1 : 0.01}
          value={f.type === "FREE_SHIPPING" ? "" : f.value}
          disabled={f.type === "FREE_SHIPPING"}
          required={f.type !== "FREE_SHIPPING"}
          onChange={(e) => set("value", e.target.value)}
        />
      </Field>
      <Field label="Minimum subtotal ₹">
        <Input type="number" min={0} step={0.01} value={f.minSubtotal} onChange={(e) => set("minSubtotal", e.target.value)} />
      </Field>
      <Field label="Max uses" hint="Blank = unlimited">
        <Input type="number" min={1} step={1} value={f.maxUses} onChange={(e) => set("maxUses", e.target.value)} />
      </Field>
      <Field label="Starts" hint="Blank = immediately">
        <Input type="datetime-local" value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
      </Field>
      <Field label="Ends" hint="Blank = never">
        <Input type="datetime-local" value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
      </Field>
      <label className="flex items-center gap-3 self-end pb-3 text-sm">
        <input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} className="size-4 accent-[var(--gold)]" />
        Active
      </label>
      <div className="flex items-end justify-end gap-3">
        <Button type="button" size="sm" variant="ghost" onClick={() => router.push("/admin/coupons")}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {initial ? "Save coupon" : "Create coupon"}
        </Button>
      </div>
    </form>
  );
}
