"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ScanLine } from "lucide-react";
import { discardStockTake, finishStockTake, saveStockTakeCounts, startStockTake } from "@/actions/admin-stocktake";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { notify, useAdminAction } from "@/components/admin/use-admin-action";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

// ─────────────────────────────── Create ───────────────────────────────

export function StockTakeCreateForm({ categories, suppliers }: { categories: { id: string; name: string }[]; suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const today = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date());
  const [f, setF] = useState({ name: `Stocktake ${today}`, note: "", scope: "all" as "all" | "category" | "supplier", categoryId: categories[0]?.id ?? "", supplierId: suppliers[0]?.id ?? "" });

  return (
    <form
      className="grid gap-6 p-5 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            startStockTake({
              name: f.name,
              note: f.note,
              scope: f.scope,
              categoryId: f.scope === "category" ? f.categoryId : undefined,
              supplierId: f.scope === "supplier" ? f.supplierId : undefined,
            }),
          { onSuccess: (r) => r.id && router.push(`/admin/stocktakes/${r.id}`) },
        );
      }}
    >
      <Field label="Name">
        <Input value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} required minLength={2} maxLength={120} />
      </Field>
      <Field label="Count">
        <Select value={f.scope} onChange={(e) => setF((p) => ({ ...p, scope: e.target.value as typeof f.scope }))}>
          <option value="all">All variants</option>
          <option value="category" disabled={!categories.length}>
            One category
          </option>
          <option value="supplier" disabled={!suppliers.length}>
            One supplier
          </option>
        </Select>
      </Field>
      {f.scope === "category" ? (
        <Field label="Category">
          <Select value={f.categoryId} onChange={(e) => setF((p) => ({ ...p, categoryId: e.target.value }))}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : f.scope === "supplier" ? (
        <Field label="Supplier">
          <Select value={f.supplierId} onChange={(e) => setF((p) => ({ ...p, supplierId: e.target.value }))}>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <div className="hidden lg:block" />
      )}
      <Field label="Note (optional)">
        <Input value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} maxLength={1000} placeholder="e.g. Quarter-end, back store room" />
      </Field>
      <div className="flex items-end justify-end sm:col-span-2 lg:col-span-4">
        <Button type="submit" size="sm" disabled={pending}>
          Snapshot &amp; start counting
        </Button>
      </div>
    </form>
  );
}

// ─────────────────────────────── Count entry ───────────────────────────────

export type CountLine = {
  id: string;
  sku: string;
  barcode: string | null;
  product: string;
  label: string;
  expected: number;
  counted: number | null;
  current: number;
  costPrice: number | null;
};

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Tablet-friendly count sheet. The scan box takes a barcode or SKU (scanners type + Enter) and jumps to that line;
 * counts save on blur and with the Save button. Read-only once completed or cancelled.
 */
export function StockTakeCounter({ id, name, lines, readOnly }: { id: string; name: string; lines: CountLine[]; readOnly: boolean }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, l.counted === null ? "" : String(l.counted)])));
  const [saved, setSaved] = useState<Record<string, string>>(values);
  const [filter, setFilter] = useState("");
  const [scan, setScan] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [onlyUncounted, setOnlyUncounted] = useState(false);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const scanRef = useRef<HTMLInputElement>(null);

  const parse = (s: string) => (s.trim() === "" ? null : Number(s));
  const validCount = (s: string) => s.trim() === "" || (/^\d+$/.test(s.trim()) && Number(s) <= 1_000_000);
  const dirty = lines.filter((l) => values[l.id] !== saved[l.id]);
  const invalid = dirty.filter((l) => !validCount(values[l.id]));

  const shown = useMemo(() => {
    const q = norm(filter);
    return lines.filter((l) => {
      if (onlyUncounted && values[l.id].trim() !== "") return false;
      if (!q) return true;
      return [l.sku, l.barcode ?? "", l.product, l.label].some((s) => s.toLowerCase().includes(q));
    });
  }, [lines, filter, onlyUncounted, values]);

  const totals = useMemo(() => {
    let counted = 0;
    let units = 0;
    let value = 0;
    let uncosted = 0;
    for (const l of lines) {
      const v = values[l.id];
      if (v.trim() === "" || !validCount(v)) continue;
      counted++;
      const d = Number(v) - l.expected;
      units += d;
      if (d && l.costPrice === null) uncosted++;
      value += d * (l.costPrice ?? 0);
    }
    return { counted, units, value, uncosted };
  }, [lines, values]);

  function save(subset = dirty) {
    const ok = subset.filter((l) => validCount(values[l.id]));
    if (!ok.length) return;
    const snapshot = Object.fromEntries(ok.map((l) => [l.id, values[l.id]]));
    run(() => saveStockTakeCounts({ id, counts: ok.map((l) => ({ lineId: l.id, counted: parse(values[l.id]) })) }), {
      onSuccess: () => setSaved((p) => ({ ...p, ...snapshot })),
    });
  }

  function jump(code: string) {
    const q = norm(code);
    if (!q) return;
    const line = lines.find((l) => norm(l.barcode ?? "") === q || norm(l.sku) === q);
    if (!line) {
      notify.error(`No line for “${code.trim()}” in this stocktake.`);
      return;
    }
    setFilter("");
    setOnlyUncounted(false);
    setFlash(line.id);
    setScan("");
    // Wait for the (possibly) unfiltered list to render before focusing.
    requestAnimationFrame(() => {
      const el = inputs.current.get(line.id);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.focus();
      el?.select();
    });
  }

  function complete() {
    const counted = lines.filter((l) => saved[l.id].trim() !== "");
    const drift = counted.filter((l) => l.current !== l.expected).length;
    const warn = drift
      ? `

Stock has moved on ${drift} counted line${drift === 1 ? "" : "s"} since the snapshot (sales or receipts). The variance from the snapshot will be applied to current stock.`
      : "";
    if (!window.confirm(`Complete “${name}”? Variances on ${counted.length} counted line${counted.length === 1 ? "" : "s"} will be applied as stock adjustments. Uncounted lines are left alone.${warn}`)) return;
    run(() => finishStockTake({ id, acknowledgeDrift: drift > 0 }), { onSuccess: () => router.refresh() });
  }

  return (
    <div>
      {!readOnly ? (
        <div className="sticky top-0 z-10 grid gap-4 border-b border-line bg-bg-elev p-5 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="block">
            <span className="eyebrow flex items-center gap-2 !text-muted">
              <ScanLine className="size-3.5" aria-hidden /> Scan or type barcode / SKU, then Enter
            </span>
            <Input
              ref={scanRef}
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  jump(scan);
                }
              }}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
              className="py-4 font-mono text-lg"
              placeholder="8901234567890"
            />
          </label>
          <label className="block">
            <span className="eyebrow !text-muted">Filter lines</span>
            <Input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} className="py-4 text-lg" placeholder="Product, SKU…" />
          </label>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={onlyUncounted} onChange={(e) => setOnlyUncounted(e.target.checked)} className="size-5 accent-[var(--gold)]" />
              Uncounted only
            </label>
            <Button type="button" size="md" variant="outline" disabled={pending || !dirty.length || invalid.length > 0} onClick={() => save()}>
              {pending ? "Saving…" : dirty.length ? `Save ${dirty.length}` : "Saved"}
            </Button>
            <Button type="button" size="md" disabled={pending || dirty.length > 0 || !totals.counted} onClick={complete} title={dirty.length ? "Save counts first" : undefined}>
              Complete &amp; apply
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-px border-b border-line sm:grid-cols-3" aria-live="polite">
        <p className="px-5 py-4 text-sm text-muted">
          Counted <span className="tabular-nums text-fg">{totals.counted}</span> of {lines.length}
        </p>
        <p className="px-5 py-4 text-sm text-muted">
          Variance <span className={cn("tabular-nums", totals.units < 0 ? "text-ember" : totals.units > 0 ? "text-gold" : "text-fg")}>{totals.units > 0 ? `+${totals.units}` : totals.units}</span> units
        </p>
        <p className="px-5 py-4 text-sm text-muted">
          Value at cost <span className={cn("tabular-nums", totals.value < 0 ? "text-ember" : totals.value > 0 ? "text-gold" : "text-fg")}>{totals.value > 0 ? "+" : ""}{formatMoney(totals.value)}</span>
          {totals.uncosted ? <span className="block text-xs text-subtle">{totals.uncosted} variance line{totals.uncosted === 1 ? "" : "s"} without a cost</span> : null}
        </p>
      </div>

      <ul className="divide-y divide-line">
        {shown.map((l) => {
          const v = values[l.id];
          const ok = validCount(v);
          const variance = v.trim() !== "" && ok ? Number(v) - l.expected : null;
          const moved = l.current !== l.expected;
          return (
            <li key={l.id} className={cn("grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-4 transition-colors sm:grid-cols-[1fr_6rem_8rem_6rem]", flash === l.id && "bg-gold/10")}>
              <div className="min-w-0">
                <p className="truncate">
                  {l.product} <span className="text-sm text-subtle">{l.label}</span>
                </p>
                <p className="font-mono text-xs text-subtle">
                  {l.sku}
                  {l.barcode ? ` · ${l.barcode}` : ""}
                </p>
                {moved && !readOnly ? (
                  <p className="text-xs text-gold">
                    Stock moved since snapshot: {l.expected} → {l.current}
                  </p>
                ) : null}
              </div>
              <p className="hidden text-right text-sm text-muted sm:block">
                <span className="block text-[0.625rem] uppercase tracking-[0.2em] text-subtle">Expected</span>
                <span className="tabular-nums">{l.expected}</span>
              </p>
              <label className="block">
                <span className="sr-only">
                  Counted {l.product} {l.label} ({l.sku}), expected {l.expected}
                </span>
                <input
                  ref={(el) => {
                    if (el) inputs.current.set(l.id, el);
                    else inputs.current.delete(l.id);
                  }}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={v}
                  readOnly={readOnly}
                  aria-invalid={!ok || undefined}
                  placeholder="—"
                  onChange={(e) => setValues((p) => ({ ...p, [l.id]: e.target.value }))}
                  onBlur={() => {
                    if (!readOnly && values[l.id] !== saved[l.id] && validCount(values[l.id])) save([l]);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      scanRef.current?.focus();
                    }
                  }}
                  className={cn(
                    "h-14 w-full border border-line-strong bg-transparent px-3 text-right text-2xl tabular-nums text-fg focus:border-gold focus:outline-none aria-[invalid=true]:border-ember",
                    v !== saved[l.id] && "border-gold/60",
                  )}
                />
              </label>
              <p className={cn("col-span-2 text-right text-sm tabular-nums sm:col-span-1", variance === null ? "text-subtle" : variance < 0 ? "text-ember" : variance > 0 ? "text-gold" : "text-muted")}>
                <span className="mr-2 text-[0.625rem] uppercase tracking-[0.2em] text-subtle sm:block sm:mr-0">Variance</span>
                {variance === null ? "—" : variance > 0 ? `+${variance}` : variance}
              </p>
            </li>
          );
        })}
        {!shown.length ? <li className="px-5 py-10 text-center text-sm text-muted">No lines match.</li> : null}
      </ul>
    </div>
  );
}

// ─────────────────────────────── Cancel ───────────────────────────────

export function StockTakeCancel({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  return (
    <Button
      type="button"
      size="sm"
      variant="danger"
      disabled={pending}
      onClick={() => {
        if (window.confirm(`Cancel “${name}”? Counts are discarded and stock is not changed.`)) run(() => discardStockTake({ id }), { onSuccess: () => router.push("/admin/stocktakes") });
      }}
    >
      Cancel stocktake
    </Button>
  );
}
