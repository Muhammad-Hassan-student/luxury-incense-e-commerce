"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Model3D, ScentFamily } from "@/generated/prisma/enums";
import { saveProduct, type ProductInput } from "@/actions/admin-catalog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { splitList, toMajor } from "@/lib/admin-shared";
import { cn } from "@/lib/utils";
import { notify, useAdminAction } from "./use-admin-action";

export type ProductFormInitial = {
  id: string;
  name: string;
  slug: string;
  subtitle: string;
  story: string;
  categoryId: string;
  family: ScentFamily;
  intensity: number;
  model: Model3D;
  palette: string[];
  topNotes: string[];
  heartNotes: string[];
  baseNotes: string[];
  moods: string[];
  timeOfDay: string[];
  burnTime: string | null;
  origin: string | null;
  isFeatured: boolean;
  isBestseller: boolean;
  isActive: boolean;
  variants: { id: string; sku: string; label: string; price: number; compareAtPrice: number | null; weightGrams: number; stock: number; reserved: number }[];
};

type VariantRow = { key: string; id?: string; sku: string; label: string; price: string; compareAtPrice: string; weightGrams: string; stock?: number; reserved?: number };

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** Labels for the procedural 3D models (see src/components/three/models.tsx). */
const modelLabels: Record<Model3D, string> = {
  INCENSE: "Incense sticks",
  DHOOP: "Dhoop cones",
  CANDLE: "Candle",
  OIL: "Oil / attar bottle",
  BAKHOOR: "Bakhoor burner",
  GIFTBOX: "Gift box",
  CARD: "Gift card",
  COIL: "Mosquito coil",
  PERFUME: "Perfume flacon (atomiser)",
  OUD: "Oud wood & oil dropper",
};
let keySeq = 0;
const newKey = () => `new-${++keySeq}`;

function Group({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cn("border border-line bg-bg-elev", className)}>
      <legend className="sr-only">{title}</legend>
      <p className="eyebrow border-b border-line px-5 py-3">{title}</p>
      <div className="grid gap-6 p-5 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm text-fg">
      <input type="checkbox" className="size-4 accent-[var(--gold)]" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      {label}
    </label>
  );
}

export function ProductForm({
  initial,
  categories,
  canEdit,
}: {
  initial?: ProductFormInitial;
  categories: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [slugTouched, setSlugTouched] = useState(Boolean(initial));

  const [f, setF] = useState({
    name: initial?.name ?? "",
    slug: initial?.slug ?? "",
    subtitle: initial?.subtitle ?? "",
    story: initial?.story ?? "",
    categoryId: initial?.categoryId ?? categories[0]?.id ?? "",
    family: initial?.family ?? ("WOODY" as ScentFamily),
    intensity: String(initial?.intensity ?? 3),
    model: initial?.model ?? ("INCENSE" as Model3D),
    palette0: initial?.palette[0] ?? "#b8945a",
    palette1: initial?.palette[1] ?? "#2a1d14",
    topNotes: initial?.topNotes.join(", ") ?? "",
    heartNotes: initial?.heartNotes.join(", ") ?? "",
    baseNotes: initial?.baseNotes.join(", ") ?? "",
    moods: initial?.moods.join(", ") ?? "",
    timeOfDay: initial?.timeOfDay.join(", ") ?? "",
    burnTime: initial?.burnTime ?? "",
    origin: initial?.origin ?? "",
    isFeatured: initial?.isFeatured ?? false,
    isBestseller: initial?.isBestseller ?? false,
    isActive: initial?.isActive ?? true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((prev) => ({ ...prev, [k]: v }));

  const [variants, setVariants] = useState<VariantRow[]>(
    initial?.variants.length
      ? initial.variants.map((v) => ({
          key: v.id,
          id: v.id,
          sku: v.sku,
          label: v.label,
          price: String(toMajor(v.price)),
          compareAtPrice: v.compareAtPrice === null ? "" : String(toMajor(v.compareAtPrice)),
          weightGrams: String(v.weightGrams),
          stock: v.stock,
          reserved: v.reserved,
        }))
      : [{ key: newKey(), sku: "", label: "", price: "", compareAtPrice: "", weightGrams: "100" }],
  );
  const setVariant = (key: string, patch: Partial<VariantRow>) => setVariants((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function submit() {
    const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
    for (const v of variants) {
      if (Number.isNaN(num(v.price))) return notify.error(`Enter a price for ${v.sku || "each variant"}.`);
    }
    const payload: ProductInput = {
      id: initial?.id,
      name: f.name,
      slug: f.slug,
      subtitle: f.subtitle,
      story: f.story,
      categoryId: f.categoryId,
      family: f.family,
      intensity: Number(f.intensity),
      model: f.model,
      palette: [f.palette0, f.palette1],
      topNotes: splitList(f.topNotes),
      heartNotes: splitList(f.heartNotes),
      baseNotes: splitList(f.baseNotes),
      moods: splitList(f.moods).map((m) => m.toLowerCase()),
      timeOfDay: splitList(f.timeOfDay).map((m) => m.toLowerCase()),
      burnTime: f.burnTime.trim() || null,
      origin: f.origin.trim() || null,
      isFeatured: f.isFeatured,
      isBestseller: f.isBestseller,
      isActive: f.isActive,
      variants: variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        label: v.label,
        price: num(v.price),
        compareAtPrice: v.compareAtPrice.trim() === "" ? null : num(v.compareAtPrice),
        weightGrams: v.weightGrams.trim() === "" ? 0 : Math.round(num(v.weightGrams)),
      })),
    };
    run(() => saveProduct(payload), {
      onSuccess: (res) => {
        if (!initial && res.id) router.push(`/admin/products/${res.id}`);
      },
    });
  }

  const ro = !canEdit;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-8"
    >
      {ro ? <p className="border border-line px-5 py-3 text-sm text-muted">Read-only — managers can edit products.</p> : null}

      <fieldset disabled={ro} className="space-y-8">
        <Group title="Identity">
          <Field label="Name">
            <Input
              value={f.name}
              required
              maxLength={120}
              onChange={(e) => {
                set("name", e.target.value);
                if (!slugTouched) set("slug", slugify(e.target.value));
              }}
            />
          </Field>
          <Field label="Slug" hint="Used in the product URL">
            <Input
              value={f.slug}
              required
              maxLength={120}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              onChange={(e) => {
                setSlugTouched(true);
                set("slug", e.target.value);
              }}
            />
          </Field>
          <Field label="Subtitle" className="sm:col-span-2">
            <Input value={f.subtitle} maxLength={200} onChange={(e) => set("subtitle", e.target.value)} />
          </Field>
          <Field label="Story" className="sm:col-span-2">
            <Textarea value={f.story} maxLength={10_000} className="min-h-36" onChange={(e) => set("story", e.target.value)} />
          </Field>
        </Group>

        <Group title="Classification">
          <Field label="Category">
            <Select value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)} required>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Scent family">
            <Select value={f.family} onChange={(e) => set("family", e.target.value as ScentFamily)}>
              {Object.values(ScentFamily).map((v) => (
                <option key={v} value={v}>
                  {titleCase(v)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Intensity · ${f.intensity} of 5`}>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={f.intensity}
              onChange={(e) => set("intensity", e.target.value)}
              className="mt-4 w-full accent-[var(--gold)]"
            />
          </Field>
          <Field label="3D model">
            <Select value={f.model} onChange={(e) => set("model", e.target.value as Model3D)}>
              {Object.values(Model3D).map((v) => (
                <option key={v} value={v}>
                  {modelLabels[v]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <span className="eyebrow !text-muted">Palette</span>
            <div className="mt-3 flex flex-wrap items-center gap-6">
              {(["palette0", "palette1"] as const).map((k, i) => (
                <label key={k} className="flex items-center gap-3 text-sm text-muted">
                  <input type="color" value={f[k]} onChange={(e) => set(k, e.target.value)} className="h-9 w-12 cursor-pointer border border-line-strong bg-transparent p-0.5" />
                  <span className="font-mono text-xs">{f[k]}</span>
                  <span className="sr-only">{i === 0 ? "Primary colour" : "Secondary colour"}</span>
                  <span aria-hidden>{i === 0 ? "Primary" : "Secondary"}</span>
                </label>
              ))}
              <span className="h-9 w-24 border border-line" style={{ background: `linear-gradient(135deg, ${f.palette0}, ${f.palette1})` }} aria-hidden />
            </div>
          </div>
        </Group>

        <Group title="Notes & ritual">
          <Field label="Top notes" hint="Comma-separated">
            <Input value={f.topNotes} onChange={(e) => set("topNotes", e.target.value)} />
          </Field>
          <Field label="Heart notes" hint="Comma-separated">
            <Input value={f.heartNotes} onChange={(e) => set("heartNotes", e.target.value)} />
          </Field>
          <Field label="Base notes" hint="Comma-separated">
            <Input value={f.baseNotes} onChange={(e) => set("baseNotes", e.target.value)} />
          </Field>
          <Field label="Moods" hint="calm, focus, romance, celebration, sleep…">
            <Input value={f.moods} onChange={(e) => set("moods", e.target.value)} />
          </Field>
          <Field label="Time of day" hint="morning, evening, night">
            <Input value={f.timeOfDay} onChange={(e) => set("timeOfDay", e.target.value)} />
          </Field>
          <Field label="Burn time" hint='e.g. "45 min per stick"'>
            <Input value={f.burnTime} maxLength={100} onChange={(e) => set("burnTime", e.target.value)} />
          </Field>
          <Field label="Origin">
            <Input value={f.origin} maxLength={100} onChange={(e) => set("origin", e.target.value)} />
          </Field>
        </Group>

        <Group title="Merchandising">
          <div className="flex flex-wrap gap-8 sm:col-span-2">
            <Check label="Live in store" checked={f.isActive} onChange={(v) => set("isActive", v)} />
            <Check label="Featured" checked={f.isFeatured} onChange={(v) => set("isFeatured", v)} />
            <Check label="Bestseller" checked={f.isBestseller} onChange={(v) => set("isBestseller", v)} />
          </div>
        </Group>

        <fieldset className="border border-line bg-bg-elev">
          <legend className="sr-only">Variants</legend>
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <p className="eyebrow">Variants</p>
            {canEdit ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setVariants((rows) => [...rows, { key: newKey(), sku: "", label: "", price: "", compareAtPrice: "", weightGrams: "100" }])}
              >
                <Plus className="size-3.5" aria-hidden /> Add variant
              </Button>
            ) : null}
          </div>
          <p className="px-5 pt-4 text-xs text-subtle">Prices in rupees. Stock is managed on the Inventory page.</p>
          <ul className="divide-y divide-line">
            {variants.map((v, i) => (
              <li key={v.key} className="grid gap-4 px-5 py-5 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_0.8fr_0.8fr_0.6fr_auto] lg:items-end">
                <Field label={`SKU ${i + 1}`}>
                  <Input value={v.sku} required maxLength={60} onChange={(e) => setVariant(v.key, { sku: e.target.value.toUpperCase() })} className="font-mono" />
                </Field>
                <Field label="Label">
                  <Input value={v.label} required maxLength={60} placeholder="40 sticks" onChange={(e) => setVariant(v.key, { label: e.target.value })} />
                </Field>
                <Field label="Price ₹">
                  <Input value={v.price} required inputMode="decimal" type="number" min={0} step="0.01" onChange={(e) => setVariant(v.key, { price: e.target.value })} />
                </Field>
                <Field label="Compare at ₹">
                  <Input value={v.compareAtPrice} inputMode="decimal" type="number" min={0} step="0.01" onChange={(e) => setVariant(v.key, { compareAtPrice: e.target.value })} />
                </Field>
                <Field label="Weight g">
                  <Input value={v.weightGrams} inputMode="numeric" type="number" min={0} step={1} onChange={(e) => setVariant(v.key, { weightGrams: e.target.value })} />
                </Field>
                <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-1">
                  {v.stock !== undefined ? (
                    <span className="whitespace-nowrap text-xs text-subtle">
                      {v.stock - (v.reserved ?? 0)} avail.
                    </span>
                  ) : null}
                  {canEdit ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove variant ${v.sku || i + 1}`}
                      disabled={variants.length === 1}
                      onClick={() => setVariants((rows) => rows.filter((r) => r.key !== v.key))}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </fieldset>
      </fieldset>

      {canEdit ? (
        <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t border-line bg-bg/95 px-4 py-4 backdrop-blur sm:mx-0 sm:px-0">
          {initial ? <p className="mr-auto text-xs text-subtle">Removing a variant deletes it; past orders keep their snapshot.</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : initial ? "Save product" : "Create product"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
