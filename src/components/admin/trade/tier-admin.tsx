"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteTier, saveTier, setTierPrice } from "@/actions/admin-trade";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { toMajor } from "@/lib/admin-shared";

export type TierInitial = { id: string; name: string; description: string | null; discountPercent: number; minOrderValue: number };

export function TierForm({ initial, onDone }: { initial?: TierInitial; onDone?: string }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [f, setF] = useState({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    discountPercent: initial ? String(initial.discountPercent) : "",
    minOrderValue: initial ? String(toMajor(initial.minOrderValue)) : "0",
  });
  return (
    <form
      className="grid gap-6 p-5 sm:grid-cols-2 lg:grid-cols-[1fr_2fr_8rem_10rem_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            saveTier({
              id: initial?.id,
              name: f.name,
              description: f.description,
              discountPercent: Number(f.discountPercent || 0),
              minOrderValue: Number(f.minOrderValue || 0),
            }),
          { onSuccess: () => router.push(onDone ?? "/admin/trade/tiers") },
        );
      }}
    >
      <Field label="Name">
        <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={60} disabled={pending} />
      </Field>
      <Field label="Description">
        <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={300} disabled={pending} placeholder="Boutiques ordering monthly" />
      </Field>
      <Field label="Discount %">
        <Input type="number" min={0} max={90} step={1} value={f.discountPercent} onChange={(e) => setF({ ...f, discountPercent: e.target.value })} required disabled={pending} />
      </Field>
      <Field label="Minimum order ₹">
        <Input type="number" min={0} step={1} value={f.minOrderValue} onChange={(e) => setF({ ...f, minOrderValue: e.target.value })} disabled={pending} />
      </Field>
      <div className="flex items-end justify-end gap-3">
        <Button type="button" size="sm" variant="ghost" onClick={() => router.push("/admin/trade/tiers")}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {initial ? "Save" : "Create"}
        </Button>
      </div>
    </form>
  );
}

export function DeleteTierButton({ id, name }: { id: string; name: string }) {
  const { pending, run } = useAdminAction();
  const [confirm, setConfirm] = useState(false);
  return confirm ? (
    <span className="inline-flex items-center gap-3">
      <button type="button" className="text-xs uppercase tracking-[0.18em] text-ember hover:underline" disabled={pending} onClick={() => run(() => deleteTier({ id }))}>
        Delete {name}?
      </button>
      <button type="button" className="text-xs uppercase tracking-[0.18em] text-muted" onClick={() => setConfirm(false)}>
        No
      </button>
    </span>
  ) : (
    <button type="button" className="text-xs uppercase tracking-[0.18em] text-muted hover:text-ember" onClick={() => setConfirm(true)}>
      Delete
    </button>
  );
}

/** Inline per-variant override for a tier. Blank = tier discount applies. */
export function TierPriceCell({ tierId, variantId, label, override, computed, canEdit }: { tierId: string; variantId: string; label: string; override: number | null; computed: number; canEdit: boolean }) {
  const { pending, run } = useAdminAction();
  const initial = override != null ? String(toMajor(override)) : "";
  const [value, setValue] = useState(initial);
  if (!canEdit) return <span className="tabular-nums">{override != null ? `₹${toMajor(override)}` : "—"}</span>;
  const dirty = value.trim() !== initial;
  return (
    <form
      className="flex items-center justify-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setTierPrice({ tierId, variantId, price: value.trim() === "" ? null : Number(value) }));
      }}
    >
      <label className="sr-only" htmlFor={`tp-${variantId}`}>
        Override price for {label} (₹)
      </label>
      <input
        id={`tp-${variantId}`}
        type="number"
        min={0}
        step={0.01}
        inputMode="decimal"
        value={value}
        placeholder={String(toMajor(computed))}
        onChange={(e) => setValue(e.target.value)}
        disabled={pending}
        className="h-8 w-28 border-0 border-b border-line-strong bg-transparent text-right text-sm tabular-nums text-fg placeholder:text-subtle focus:border-gold focus:outline-none"
      />
      <button type="submit" disabled={!dirty || pending} className="text-[0.625rem] uppercase tracking-[0.18em] text-gold disabled:invisible">
        {value.trim() === "" ? "Clear" : "Set"}
      </button>
    </form>
  );
}
