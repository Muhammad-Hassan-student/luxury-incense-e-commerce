"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { previewPromotion, savePromotion, type PreviewResult } from "@/actions/admin-promotions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { formatMoney, baseSymbol } from "@/lib/money";
import { toLocalInput, toMajor, toMinor } from "@/lib/admin-shared";
import { PROMOTION_TYPE_LABEL, PROMOTION_TYPES, type PromotionTypeKey } from "@/lib/promotions";
import { cn } from "@/lib/utils";
import { useAdminAction } from "../use-admin-action";

export type PromoCatalog = {
  products: { id: string; name: string; categoryId: string; variants: { id: string; label: string; price: number }[] }[];
  categories: { id: string; name: string }[];
};

export type PromotionFormInitial = {
  id: string;
  name: string;
  badge: string | null;
  type: PromotionTypeKey;
  config: Record<string, unknown>;
  productIds: string[];
  categoryIds: string[];
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  priority: number;
  stackable: boolean;
  allowCoupon: boolean;
  includeTrade: boolean;
  includeSubscriptions: boolean;
};

const toIso = (local: string) => (local ? new Date(local).toISOString() : "");
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const rupees = (minor: unknown) => String(toMajor(num(minor)));

type Tier = { threshold: string; percent: string };
type BundleItem = { productId: string; quantity: string };

function initialConfig(i?: PromotionFormInitial) {
  const c = i?.config ?? {};
  const t = i?.type;
  return {
    saleKind: (t === "FLASH_SALE" && c.kind === "FIXED" ? "FIXED" : "PERCENT") as "PERCENT" | "FIXED",
    saleValue: t === "FLASH_SALE" ? (c.kind === "FIXED" ? rupees(c.value) : String(num(c.value, 20))) : "20",
    buyQty: String(t === "BUY_X_GET_Y" ? num(c.buyQty, 2) : 2),
    getQty: String(t === "BUY_X_GET_Y" ? num(c.getQty, 1) : 1),
    getPercentOff: String(t === "BUY_X_GET_Y" ? num(c.getPercentOff, 100) : 100),
    getProductIds: t === "BUY_X_GET_Y" && Array.isArray(c.getProductIds) ? (c.getProductIds as string[]) : [],
    maxApplications: (t === "BUY_X_GET_Y" || t === "MULTI_BUY") && typeof c.maxApplications === "number" ? String(c.maxApplications) : "",
    multiQty: String(t === "MULTI_BUY" ? num(c.quantity, 3) : 3),
    multiPrice: t === "MULTI_BUY" ? rupees(c.price) : "",
    bundleItems: (t === "FIXED_BUNDLE" && Array.isArray(c.items) ? (c.items as { productId: string; quantity: number }[]).map((x) => ({ productId: x.productId, quantity: String(x.quantity) })) : []) as BundleItem[],
    bundlePrice: t === "FIXED_BUNDLE" ? rupees(c.price) : "",
    tiers: (t === "TIERED" && Array.isArray(c.tiers)
      ? (c.tiers as { threshold: number; percent: number }[]).map((x) => ({ threshold: rupees(x.threshold), percent: String(x.percent) }))
      : [
          { threshold: "2000", percent: "10" },
          { threshold: "4000", percent: "15" },
        ]) as Tier[],
  };
}

function buildConfig(type: PromotionTypeKey, c: ReturnType<typeof initialConfig>) {
  const int = (s: string) => Math.round(Number(s || 0));
  const maxApps = c.maxApplications.trim() ? int(c.maxApplications) : null;
  switch (type) {
    case "FLASH_SALE":
      return { kind: c.saleKind, value: c.saleKind === "PERCENT" ? int(c.saleValue) : toMinor(Number(c.saleValue || 0)) };
    case "BUY_X_GET_Y":
      return { buyQty: int(c.buyQty), getQty: int(c.getQty), getPercentOff: int(c.getPercentOff), getProductIds: c.getProductIds, maxApplications: maxApps };
    case "MULTI_BUY":
      return { quantity: int(c.multiQty), price: toMinor(Number(c.multiPrice || 0)), maxApplications: maxApps };
    case "FIXED_BUNDLE":
      return { items: c.bundleItems.filter((x) => x.productId).map((x) => ({ productId: x.productId, quantity: int(x.quantity) || 1 })), price: toMinor(Number(c.bundlePrice || 0)) };
    case "TIERED":
      return { tiers: c.tiers.map((x) => ({ threshold: toMinor(Number(x.threshold || 0)), percent: int(x.percent) })) };
  }
}

/** Searchable checkbox list (products or categories). */
function PickList({ label, options, value, onChange, hint }: { label: string; options: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void; hint?: string }) {
  const [q, setQ] = useState("");
  const shown = options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <fieldset className="min-w-0">
      <legend className="eyebrow !text-muted">
        {label} {value.length ? <span className="text-gold">· {value.length}</span> : null}
      </legend>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label={`Search ${label.toLowerCase()}`} />
      <div className="mt-2 max-h-48 overflow-y-auto border border-line">
        {shown.map((o) => (
          <label key={o.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-bg-soft">
            <input type="checkbox" className="size-4 shrink-0 accent-[var(--gold)]" checked={value.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))} />
            <span className="min-w-0 truncate">{o.name}</span>
          </label>
        ))}
        {!shown.length ? <p className="px-3 py-3 text-xs text-subtle">No matches.</p> : null}
      </div>
      {hint ? <p className="mt-1 text-xs text-subtle">{hint}</p> : null}
    </fieldset>
  );
}

function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--gold)]" />
      <span>
        {label}
        {hint ? <span className="block text-xs text-subtle">{hint}</span> : null}
      </span>
    </label>
  );
}

export function PromotionForm({ initial, catalog }: { initial?: PromotionFormInitial; catalog: PromoCatalog }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [f, setF] = useState({
    name: initial?.name ?? "",
    badge: initial?.badge ?? "",
    type: initial?.type ?? ("FLASH_SALE" as PromotionTypeKey),
    productIds: initial?.productIds ?? [],
    categoryIds: initial?.categoryIds ?? [],
    startsAt: toLocalInput(initial?.startsAt),
    endsAt: toLocalInput(initial?.endsAt),
    isActive: initial?.isActive ?? true,
    priority: String(initial?.priority ?? 100),
    stackable: initial?.stackable ?? true,
    allowCoupon: initial?.allowCoupon ?? true,
    includeTrade: initial?.includeTrade ?? false,
    includeSubscriptions: initial?.includeSubscriptions ?? false,
  });
  const [c, setC] = useState(() => initialConfig(initial));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const setCfg = <K extends keyof typeof c>(k: K, v: (typeof c)[K]) => setC((p) => ({ ...p, [k]: v }));
  const productOptions = useMemo(() => catalog.products.map((p) => ({ id: p.id, name: p.name })), [catalog.products]);
  const variantOptions = useMemo(() => catalog.products.flatMap((p) => p.variants.map((v) => ({ id: v.id, name: `${p.name} · ${v.label} (${formatMoney(v.price)})` }))), [catalog.products]);
  // Bundles name their own pieces; every other type can be limited to products / categories.
  const targeted = f.type !== "FIXED_BUNDLE";

  const config = buildConfig(f.type, c);
  const draft = {
    name: f.name || "Draft",
    badge: f.badge,
    type: f.type,
    config,
    productIds: f.productIds,
    categoryIds: f.categoryIds,
    priority: Number(f.priority || 0),
    stackable: f.stackable,
    allowCoupon: f.allowCoupon,
    includeTrade: f.includeTrade,
    includeSubscriptions: f.includeSubscriptions,
  };

  // ── Live preview on a sample bag ──
  const [sample, setSample] = useState(() => catalog.products.slice(0, 3).map((p) => ({ variantId: p.variants[0]?.id ?? "", quantity: 1 })).filter((s) => s.variantId));
  const [withLive, setWithLive] = useState(true);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, startPreview] = useTransition();
  const key = JSON.stringify({ draft, sample, withLive });
  useEffect(() => {
    if (!sample.length) return;
    const id = setTimeout(() => {
      startPreview(async () => {
        try {
          setPreview(await previewPromotion({ draft, editingId: initial?.id ?? null, sample, withLive }));
        } catch {
          setPreview({ ok: false, error: "Preview unavailable." });
        }
      });
    }, 350);
    return () => clearTimeout(id);
    // `key` captures draft + sample + withLive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const submit = () =>
    run(
      () =>
        savePromotion({
          id: initial?.id,
          ...draft,
          name: f.name,
          startsAt: toIso(f.startsAt),
          endsAt: toIso(f.endsAt),
          isActive: f.isActive,
        }),
      { onSuccess: () => router.push("/admin/promotions") },
    );

  return (
    <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <form
        className="grid min-w-0 gap-6 p-5 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Name">
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} required minLength={2} maxLength={80} placeholder="Diwali flash sale" />
        </Field>
        <Field label="Shopper label" hint="Shown on badges and in the bag (optional)">
          <Input value={f.badge} onChange={(e) => set("badge", e.target.value)} maxLength={40} placeholder="Diwali sale" />
        </Field>
        <Field label="Type">
          <Select value={f.type} onChange={(e) => set("type", e.target.value as PromotionTypeKey)} data-promo-type>
            {PROMOTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROMOTION_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" hint="Lower runs first within its stage">
          <Input type="number" min={0} max={1000} value={f.priority} onChange={(e) => set("priority", e.target.value)} />
        </Field>

        {/* ── Offer ── */}
        <div className="grid gap-6 border-t border-line pt-6 sm:col-span-2 sm:grid-cols-2 lg:grid-cols-4">
          {f.type === "FLASH_SALE" ? (
            <>
              <Field label="Discount">
                <Select value={c.saleKind} onChange={(e) => setCfg("saleKind", e.target.value as "PERCENT" | "FIXED")}>
                  <option value="PERCENT">Percent off</option>
                  <option value="FIXED">Amount off each</option>
                </Select>
              </Field>
              <Field label={c.saleKind === "PERCENT" ? "Percent" : `Amount ${baseSymbol()}`}>
                <Input type="number" min={1} max={c.saleKind === "PERCENT" ? 90 : undefined} step={c.saleKind === "PERCENT" ? 1 : 0.01} value={c.saleValue} onChange={(e) => setCfg("saleValue", e.target.value)} required />
              </Field>
            </>
          ) : null}
          {f.type === "BUY_X_GET_Y" ? (
            <>
              <Field label="Buy">
                <Input type="number" min={1} max={10} value={c.buyQty} onChange={(e) => setCfg("buyQty", e.target.value)} />
              </Field>
              <Field label="Get">
                <Input type="number" min={1} max={10} value={c.getQty} onChange={(e) => setCfg("getQty", e.target.value)} />
              </Field>
              <Field label="Get % off" hint="100 = free">
                <Input type="number" min={1} max={100} value={c.getPercentOff} onChange={(e) => setCfg("getPercentOff", e.target.value)} />
              </Field>
              <Field label="Max per order" hint="Blank = unlimited">
                <Input type="number" min={1} max={50} value={c.maxApplications} onChange={(e) => setCfg("maxApplications", e.target.value)} />
              </Field>
              <div className="sm:col-span-2 lg:col-span-4">
                <PickList label="Free / discounted pieces" options={productOptions} value={c.getProductIds} onChange={(v) => setCfg("getProductIds", v)} hint="Leave empty to discount from the same eligible pieces (classic BOGO)." />
              </div>
            </>
          ) : null}
          {f.type === "MULTI_BUY" ? (
            <>
              <Field label="Any">
                <Input type="number" min={2} max={10} value={c.multiQty} onChange={(e) => setCfg("multiQty", e.target.value)} />
              </Field>
              <Field label={`For ${baseSymbol()}`}>
                <Input type="number" min={1} step={0.01} value={c.multiPrice} onChange={(e) => setCfg("multiPrice", e.target.value)} required />
              </Field>
              <Field label="Max per order" hint="Blank = unlimited">
                <Input type="number" min={1} max={50} value={c.maxApplications} onChange={(e) => setCfg("maxApplications", e.target.value)} />
              </Field>
            </>
          ) : null}
          {f.type === "FIXED_BUNDLE" ? (
            <div className="space-y-3 sm:col-span-2 lg:col-span-4">
              <p className="eyebrow !text-muted">Pieces in the bundle</p>
              {c.bundleItems.map((it, i) => (
                <div key={i} className="flex items-end gap-3">
                  <Select
                    className="min-w-0 flex-1"
                    aria-label={`Bundle piece ${i + 1}`}
                    value={it.productId}
                    onChange={(e) => setCfg("bundleItems", c.bundleItems.map((x, j) => (j === i ? { ...x, productId: e.target.value } : x)))}
                  >
                    <option value="">Choose a product…</option>
                    {productOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  <Input type="number" min={1} max={5} className="w-16" aria-label="Quantity" value={it.quantity} onChange={(e) => setCfg("bundleItems", c.bundleItems.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                  <button type="button" onClick={() => setCfg("bundleItems", c.bundleItems.filter((_, j) => j !== i))} className="grid size-10 shrink-0 place-items-center text-subtle hover:text-ember" aria-label="Remove piece">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap items-end gap-6">
                <Button type="button" size="sm" variant="outline" onClick={() => setCfg("bundleItems", [...c.bundleItems, { productId: "", quantity: "1" }])}>
                  <Plus className="size-3.5" aria-hidden /> Add piece
                </Button>
                <Field label={`Bundle price ${baseSymbol()}`} className="w-40">
                  <Input type="number" min={1} step={0.01} value={c.bundlePrice} onChange={(e) => setCfg("bundlePrice", e.target.value)} required />
                </Field>
              </div>
            </div>
          ) : null}
          {f.type === "TIERED" ? (
            <div className="space-y-3 sm:col-span-2 lg:col-span-4">
              <p className="eyebrow !text-muted">Tiers (spend {baseSymbol()} → % off)</p>
              {c.tiers.map((t, i) => (
                <div key={i} className="flex items-end gap-3">
                  <Input type="number" min={1} step={0.01} className="min-w-0 flex-1" aria-label={`Tier ${i + 1} threshold ${baseSymbol()}`} value={t.threshold} onChange={(e) => setCfg("tiers", c.tiers.map((x, j) => (j === i ? { ...x, threshold: e.target.value } : x)))} />
                  <span className="pb-3 text-sm text-muted">→</span>
                  <Input type="number" min={1} max={90} className="w-20" aria-label={`Tier ${i + 1} percent`} value={t.percent} onChange={(e) => setCfg("tiers", c.tiers.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))} />
                  <span className="pb-3 text-sm text-muted">%</span>
                  <button type="button" onClick={() => setCfg("tiers", c.tiers.filter((_, j) => j !== i))} className="grid size-10 shrink-0 place-items-center text-subtle hover:text-ember" aria-label="Remove tier" disabled={c.tiers.length <= 1}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" onClick={() => setCfg("tiers", [...c.tiers, { threshold: "", percent: "" }])} disabled={c.tiers.length >= 6}>
                <Plus className="size-3.5" aria-hidden /> Add tier
              </Button>
            </div>
          ) : null}
        </div>

        {targeted ? (
          <div className="grid gap-6 border-t border-line pt-6 sm:col-span-2 sm:grid-cols-2">
            <PickList label="Categories" options={catalog.categories} value={f.categoryIds} onChange={(v) => set("categoryIds", v)} />
            <PickList label={f.type === "BUY_X_GET_Y" ? "Products (buy side)" : "Products"} options={productOptions} value={f.productIds} onChange={(v) => set("productIds", v)} hint="Nothing chosen = every eligible product." />
          </div>
        ) : null}

        <div className="grid gap-6 border-t border-line pt-6 sm:col-span-2 sm:grid-cols-2">
          <Field label="Starts" hint="Blank = immediately (store time is the server’s)">
            <Input type="datetime-local" value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
          </Field>
          <Field label="Ends" hint="Blank = until paused">
            <Input type="datetime-local" value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
          </Field>
          <Check label="Active" checked={f.isActive} onChange={(v) => set("isActive", v)} hint="Pausing stops it immediately, whatever the window." />
          <Check label="Stacks with other promotions" checked={f.stackable} onChange={(v) => set("stackable", v)} hint="Off = skips pieces already discounted, and blocks later offers on the pieces it uses." />
          <Check label="Coupon codes can be combined" checked={f.allowCoupon} onChange={(v) => set("allowCoupon", v)} />
          <Check label="Trade accounts get it too" checked={f.includeTrade} onChange={(v) => set("includeTrade", v)} />
          <Check label="Applies to Subscribe & Save lines" checked={f.includeSubscriptions} onChange={(v) => set("includeSubscriptions", v)} />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 sm:col-span-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => router.push("/admin/promotions")}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {initial ? "Save promotion" : "Create promotion"}
          </Button>
        </div>
      </form>

      {/* ── Live preview ── */}
      <aside className="min-w-0 border-t border-line p-5 xl:border-s xl:border-t-0" aria-label="Live preview" data-promo-preview>
        <div className="flex items-center justify-between gap-3">
          <h3 className="eyebrow">Live preview</h3>
          {previewing ? <span className="text-xs text-subtle">Updating…</span> : null}
        </div>
        <p className="mt-1 text-xs text-subtle">A sample bag priced as if this promotion were live now.</p>
        <div className="mt-4 space-y-2">
          {sample.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select className="min-w-0 flex-1 !py-2 text-xs" aria-label={`Sample piece ${i + 1}`} value={s.variantId} onChange={(e) => setSample(sample.map((x, j) => (j === i ? { ...x, variantId: e.target.value } : x)))}>
                {variantOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
              <Input type="number" min={1} max={10} className="w-12 !py-2 text-xs" aria-label="Quantity" value={s.quantity} onChange={(e) => setSample(sample.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, Math.min(10, Number(e.target.value) || 1)) } : x)))} />
              <button type="button" className="grid size-8 shrink-0 place-items-center text-subtle hover:text-ember" aria-label="Remove sample piece" onClick={() => setSample(sample.filter((_, j) => j !== i))} disabled={sample.length <= 1}>
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <Button type="button" size="sm" variant="ghost" className="!px-0" onClick={() => variantOptions[0] && setSample([...sample, { variantId: variantOptions[0].id, quantity: 1 }])} disabled={sample.length >= 12}>
              <Plus className="size-3.5" aria-hidden /> Add piece
            </Button>
            <Check label="With other live promotions" checked={withLive} onChange={setWithLive} />
          </div>
        </div>

        {preview && !preview.ok ? <p className="mt-4 text-xs text-ember">{preview.error}</p> : null}
        {preview && preview.ok ? (
          <div className={cn("mt-4 space-y-3 text-sm", previewing && "opacity-60")}>
            <ul className="divide-y divide-line border-y border-line">
              {preview.result.lines.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 py-2 text-xs">
                  <span className="min-w-0">
                    <span className="block truncate">{l.name}</span>
                    <span className="text-subtle">× {l.quantity}{l.sale ? ` · ${l.sale.badge || l.sale.name}` : ""}</span>
                  </span>
                  <span className="shrink-0 text-end tabular-nums">
                    {formatMoney(l.unitPrice * l.quantity)}
                    {l.unitPrice < l.listPrice ? <s className="ms-1 block text-subtle">{formatMoney(l.listPrice * l.quantity)}</s> : null}
                  </span>
                </li>
              ))}
            </ul>
            {preview.result.applied.length ? (
              <ul className="space-y-1 text-xs">
                {preview.result.applied.map((a) => (
                  <li key={a.promotionId} className="flex justify-between gap-3 text-gold">
                    <span className="min-w-0 truncate">{a.name}</span>
                    <span className="tabular-nums">−{formatMoney(a.discount)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">Nothing applies to this bag yet.</p>
            )}
            {preview.result.nudges.length ? (
              <ul className="space-y-1 text-xs text-muted">
                {preview.result.nudges.map((n, i) => (
                  <li key={i}>
                    ✦{" "}
                    {n.kind === "TIERED"
                      ? `Spend ${formatMoney(n.remaining)} more for ${n.percent}% off`
                      : n.kind === "MULTI_BUY"
                        ? `Add ${n.addQty} more — any ${n.quantity} for ${formatMoney(n.price)}`
                        : n.kind === "FIXED_BUNDLE"
                          ? `Add ${n.missing.map((m) => preview.names[m.productId] ?? "a piece").join(", ")} to complete the set`
                          : n.getProductIds.length
                            ? `Add ${n.getProductIds.map((id) => preview.names[id] ?? "the gift").join(" or ")} to get it ${n.percentOff >= 100 ? "free" : `${n.percentOff}% off`}`
                            : `Add ${n.addQty} more to get ${n.getQty} ${n.percentOff >= 100 ? "free" : `at ${n.percentOff}% off`}`}
                  </li>
                ))}
              </ul>
            ) : null}
            <dl className="space-y-1 border-t border-line pt-3 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted">List price</dt>
                <dd className="tabular-nums">{formatMoney(preview.result.listSubtotal)}</dd>
              </div>
              {preview.result.saleSavings ? (
                <div className="flex justify-between text-gold">
                  <dt>Sale savings</dt>
                  <dd className="tabular-nums">−{formatMoney(preview.result.saleSavings)}</dd>
                </div>
              ) : null}
              {preview.result.promoDiscount ? (
                <div className="flex justify-between text-gold">
                  <dt>Bundles & tiers</dt>
                  <dd className="tabular-nums">−{formatMoney(preview.result.promoDiscount)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-line pt-2 text-sm">
                <dt>Before coupon</dt>
                <dd className="tabular-nums">{formatMoney(preview.total)}</dd>
              </div>
              <p className="pt-1 text-subtle">
                Guard: at most {preview.maxDiscountPercent}% off ({formatMoney(preview.result.maxDiscount)}); a coupon could still take {formatMoney(preview.result.couponCap)}.
                {preview.result.couponBlockedBy ? ` Coupons are refused (${preview.result.couponBlockedBy}).` : ""}
              </p>
            </dl>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
