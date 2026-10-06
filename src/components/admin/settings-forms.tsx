"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { deleteShippingRate, saveShippingRate, saveStoreSettings } from "@/actions/admin-settings";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { splitList, toMajor, toMinor } from "@/lib/admin-shared";
import { useAdminAction } from "./use-admin-action";

export type StoreSettingsValue = {
  announcement: string;
  taxRatePercent: number;
  taxInclusive: boolean;
  lowStockThreshold: number;
  giftWrapFee: number;
};

export function StoreSettingsForm({ initial }: { initial: StoreSettingsValue }) {
  const { pending, run } = useAdminAction();
  const [f, setF] = useState({
    announcement: initial.announcement,
    taxRatePercent: String(initial.taxRatePercent),
    taxInclusive: initial.taxInclusive,
    lowStockThreshold: String(initial.lowStockThreshold),
    giftWrapFee: String(toMajor(initial.giftWrapFee)),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  return (
    <form
      className="grid gap-6 p-5 sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          saveStoreSettings({
            announcement: f.announcement,
            taxRatePercent: Number(f.taxRatePercent),
            taxInclusive: f.taxInclusive,
            lowStockThreshold: Number(f.lowStockThreshold),
            giftWrapFee: toMinor(Number(f.giftWrapFee)),
          }),
        );
      }}
    >
      <Field label="Announcement bar" hint="Shown above the storefront header. Leave blank to hide." className="sm:col-span-2 lg:col-span-3">
        <Textarea value={f.announcement} onChange={(e) => set("announcement", e.target.value)} maxLength={300} className="min-h-14" />
      </Field>
      <Field label="Tax rate %">
        <Input type="number" min={0} max={50} step={0.01} required value={f.taxRatePercent} onChange={(e) => set("taxRatePercent", e.target.value)} />
      </Field>
      <Field label="Low-stock threshold" hint="Available units at or below this are flagged">
        <Input type="number" min={0} step={1} required value={f.lowStockThreshold} onChange={(e) => set("lowStockThreshold", e.target.value)} />
      </Field>
      <Field label="Gift wrap fee ₹">
        <Input type="number" min={0} step={0.01} required value={f.giftWrapFee} onChange={(e) => set("giftWrapFee", e.target.value)} />
      </Field>
      <label className="flex items-center gap-3 text-sm sm:col-span-2">
        <input type="checkbox" checked={f.taxInclusive} onChange={(e) => set("taxInclusive", e.target.checked)} className="size-4 accent-[var(--gold)]" />
        Prices include tax
      </label>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          Save settings
        </Button>
      </div>
    </form>
  );
}

export type RateRow = { id: string; name: string; countries: string[]; price: number; freeOver: number | null; etaDays: string; position: number };

function RateForm({ rate, onDone }: { rate?: RateRow; onDone?: () => void }) {
  const { pending, run } = useAdminAction();
  const [f, setF] = useState({
    name: rate?.name ?? "",
    countries: rate?.countries.join(", ") ?? "",
    price: rate ? String(toMajor(rate.price)) : "",
    freeOver: rate?.freeOver != null ? String(toMajor(rate.freeOver)) : "",
    etaDays: rate?.etaDays ?? "",
    position: String(rate?.position ?? 0),
  });
  const set = <K extends keyof typeof f>(k: K, v: string) => setF((p) => ({ ...p, [k]: v }));
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <form
      className="grid items-end gap-4 px-5 py-5 sm:grid-cols-3 lg:grid-cols-[1.2fr_1fr_0.7fr_0.8fr_0.7fr_0.5fr_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            saveShippingRate({
              id: rate?.id,
              name: f.name,
              countries: splitList(f.countries),
              price: Number(f.price || 0),
              freeOver: f.freeOver.trim() ? Number(f.freeOver) : null,
              etaDays: f.etaDays,
              position: Number(f.position || 0),
            }),
          { onSuccess: onDone },
        );
      }}
    >
      <Field label="Name">
        <Input value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={80} />
      </Field>
      <Field label="Countries" hint="IN, AE — or * for rest of world">
        <Input value={f.countries} onChange={(e) => set("countries", e.target.value.toUpperCase())} required />
      </Field>
      <Field label="Price ₹">
        <Input type="number" min={0} step={0.01} value={f.price} onChange={(e) => set("price", e.target.value)} required />
      </Field>
      <Field label="Free over ₹" hint="Blank = never">
        <Input type="number" min={0} step={0.01} value={f.freeOver} onChange={(e) => set("freeOver", e.target.value)} />
      </Field>
      <Field label="ETA" hint='e.g. "3–5 days"'>
        <Input value={f.etaDays} onChange={(e) => set("etaDays", e.target.value)} required maxLength={40} />
      </Field>
      <Field label="Order">
        <Input type="number" min={0} step={1} value={f.position} onChange={(e) => set("position", e.target.value)} />
      </Field>
      <div className="flex items-center gap-2 pb-1">
        <Button type="submit" size="sm" variant={rate ? "outline" : "primary"} disabled={pending}>
          {rate ? "Save" : (
            <>
              <Plus className="size-3.5" aria-hidden /> Add
            </>
          )}
        </Button>
        {rate ? (
          confirmDelete ? (
            <>
              <Button type="button" size="sm" variant="danger" disabled={pending} onClick={() => run(() => deleteShippingRate({ id: rate.id }))}>
                Confirm
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button type="button" size="icon" variant="ghost" aria-label={`Delete ${rate.name}`} onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" aria-hidden />
            </Button>
          )
        ) : null}
      </div>
    </form>
  );
}

export function ShippingRates({ rates }: { rates: RateRow[] }) {
  const [adding, setAdding] = useState(0);
  return (
    <div className="divide-y divide-line">
      {rates.map((r) => (
        <RateForm key={`${r.id}-${r.name}-${r.price}-${r.position}-${r.countries.join()}-${r.freeOver}-${r.etaDays}`} rate={r} />
      ))}
      <div className="bg-bg">
        <p className="eyebrow px-5 pt-5">Add a rate</p>
        <RateForm key={adding} onDone={() => setAdding((n) => n + 1)} />
      </div>
    </div>
  );
}
