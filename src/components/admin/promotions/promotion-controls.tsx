"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deletePromotion, releasePreorderStock, savePreorder, savePromotionGuard, setPromotionActive } from "@/actions/admin-promotions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { toLocalInput } from "@/lib/admin-shared";
import { useAdminAction } from "../use-admin-action";

/** Pause / resume + delete for one promotion row. */
export function PromotionRowActions({ id, name, isActive }: { id: string; name: string; isActive: boolean }) {
  const { pending, run } = useAdminAction();
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <button type="button" disabled={pending} onClick={() => run(() => setPromotionActive({ id, isActive: !isActive }))} className="text-xs uppercase tracking-[0.18em] text-muted hover:text-gold disabled:opacity-50">
        {isActive ? "Pause" : "Resume"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm(`Delete “${name}”? Order history keeps its usage.`)) run(() => deletePromotion({ id }));
        }}
        className="text-xs uppercase tracking-[0.18em] text-muted hover:text-ember disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  );
}

export function GuardForm({ maxDiscountPercent }: { maxDiscountPercent: number }) {
  const { pending, run } = useAdminAction();
  const [v, setV] = useState(String(maxDiscountPercent));
  return (
    <form
      className="flex flex-wrap items-end gap-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => savePromotionGuard({ maxDiscountPercent: Math.round(Number(v)) }));
      }}
    >
      <Field label="Max total discount %" hint="Sale + bundles + tiers + coupon never take more than this share of the list price." className="w-full max-w-sm">
        <Input type="number" min={5} max={95} value={v} onChange={(e) => setV(e.target.value)} required />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        Save guard
      </Button>
    </form>
  );
}

export type PreorderVariantOption = { id: string; name: string };

/** Add / edit a variant's pre-order. */
export function PreorderForm({ variants, initial }: { variants: PreorderVariantOption[]; initial?: { variantId: string; active: boolean; shipDate: Date; cap: number | null; note: string | null } }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [f, setF] = useState({
    variantId: initial?.variantId ?? "",
    active: initial?.active ?? true,
    shipDate: toLocalInput(initial?.shipDate).slice(0, 10),
    cap: initial?.cap != null ? String(initial.cap) : "",
    note: initial?.note ?? "",
  });
  return (
    <form
      className="grid gap-6 p-5 sm:grid-cols-2 lg:grid-cols-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            savePreorder({
              variantId: f.variantId,
              active: f.active,
              // Noon UTC keeps the date stable in every timezone.
              shipDate: f.shipDate ? `${f.shipDate}T12:00:00.000Z` : "",
              cap: f.cap.trim() ? Math.round(Number(f.cap)) : null,
              note: f.note,
            }),
          { onSuccess: () => router.push("/admin/promotions?tab=preorders") },
        );
      }}
    >
      <Field label="Variant" className="sm:col-span-2">
        <Select value={f.variantId} onChange={(e) => setF({ ...f, variantId: e.target.value })} required disabled={Boolean(initial)}>
          <option value="">Choose…</option>
          {variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Expected ship date">
        <Input type="date" value={f.shipDate} onChange={(e) => setF({ ...f, shipDate: e.target.value })} required />
      </Field>
      <Field label="Cap" hint="Blank = unlimited">
        <Input type="number" min={1} value={f.cap} onChange={(e) => setF({ ...f, cap: e.target.value })} />
      </Field>
      <label className="flex items-center gap-3 self-end pb-3 text-sm">
        <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="size-4 accent-[var(--gold)]" />
        Taking pre-orders
      </label>
      <Field label="Internal note" className="sm:col-span-2 lg:col-span-4">
        <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={200} placeholder="New batch from Kannauj" />
      </Field>
      <div className="flex items-end justify-end gap-3">
        <Button type="button" size="sm" variant="ghost" onClick={() => router.push("/admin/promotions?tab=preorders")}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}

export function ReleasePreorderButton({ variantId, waiting }: { variantId: string; waiting: number }) {
  const { pending, run } = useAdminAction();
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <button type="button" disabled={pending || !waiting} onClick={() => run(() => releasePreorderStock({ variantId, endPreorder: false }))} className="text-xs uppercase tracking-[0.18em] text-muted hover:text-gold disabled:opacity-40">
        Release stock
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm("Release waiting pre-orders and stop taking new ones?")) run(() => releasePreorderStock({ variantId, endPreorder: true }));
        }}
        className="text-xs uppercase tracking-[0.18em] text-muted hover:text-gold disabled:opacity-40"
      >
        Release & end
      </button>
    </div>
  );
}
