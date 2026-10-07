"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import {
  addPoLine,
  cancelPo,
  createPo,
  createPoFromSuggestions,
  markPoOrdered,
  receivePo,
  removePoItem,
  savePoDetails,
  searchVariants,
  updatePoItem,
} from "@/actions/admin-purchasing";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Table, Td, Th } from "@/components/admin/ui";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { toMajor } from "@/lib/admin-shared";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { VariantOption } from "./types";

const toDateInput = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");

// ─────────────────────────────── Create ───────────────────────────────

export function PoCreateForm({ suppliers, defaultSupplierId }: { suppliers: { id: string; name: string; leadTimeDays: number }[]; defaultSupplierId?: string }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [supplierId, setSupplierId] = useState(defaultSupplierId ?? suppliers[0]?.id ?? "");
  const lead = suppliers.find((s) => s.id === supplierId)?.leadTimeDays ?? 14;
  const [expectedAt, setExpectedAt] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <form
      className="grid gap-6 p-5 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createPo({ supplierId, expectedAt, notes }), { onSuccess: (r) => r.id && router.push(`/admin/purchasing/${r.id}`) });
      }}
    >
      <Field label="Supplier">
        <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Expected delivery" hint={`Supplier lead time: ${lead} days`}>
        <Input type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
      </Field>
      <Field label="Notes for the supplier" className="sm:col-span-2">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      </Field>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending || !supplierId}>
          Create draft
        </Button>
      </div>
    </form>
  );
}

export function ReorderDraftButton({ supplierId, supplierName }: { supplierId: string; supplierName: string }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  return (
    <Button
      type="button"
      size="sm"
      disabled={pending}
      aria-label={`Create draft PO for ${supplierName}`}
      onClick={() => run(() => createPoFromSuggestions({ supplierId }), { onSuccess: (r) => r.id && router.push(`/admin/purchasing/${r.id}`) })}
    >
      {pending ? "Creating…" : "Create draft PO"}
    </Button>
  );
}

// ─────────────────────────────── Draft lines ───────────────────────────────

export type DraftLineItem = { id: string; sku: string; product: string; label: string; quantity: number; unitCost: number };

function DraftLineRow({ item }: { item: DraftLineItem }) {
  const { pending, run } = useAdminAction();
  const [qty, setQty] = useState(String(item.quantity));
  const [cost, setCost] = useState(String(toMajor(item.unitCost)));
  const dirty = Number(qty) !== item.quantity || Math.round(Number(cost) * 100) !== item.unitCost;
  const valid = Number.isInteger(Number(qty)) && Number(qty) >= 1 && cost.trim() !== "" && Number(cost) >= 0;

  return (
    <tr>
      <Td>
        {item.product} <span className="text-xs text-subtle">{item.label}</span>
        <span className="block font-mono text-xs text-subtle">{item.sku}</span>
      </Td>
      <Td className="w-28">
        <label>
          <span className="sr-only">Quantity of {item.sku}</span>
          <Input type="number" min={1} step={1} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} className="py-1.5 text-right tabular-nums" />
        </label>
      </Td>
      <Td className="w-32">
        <label>
          <span className="sr-only">Unit cost in rupees for {item.sku}</span>
          <Input type="number" min={0} step={0.01} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} className="py-1.5 text-right tabular-nums" />
        </label>
      </Td>
      <Td className="text-right tabular-nums">{valid ? formatMoney(Math.round(Number(cost) * 100) * Number(qty)) : "—"}</Td>
      <Td className="whitespace-nowrap text-right">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 px-3"
          disabled={!dirty || !valid || pending}
          onClick={() => run(() => updatePoItem({ itemId: item.id, quantity: Number(qty), unitCost: Number(cost) }))}
        >
          Save
        </Button>
        <Button type="button" size="icon" variant="ghost" className="ml-1 size-8" disabled={pending} aria-label={`Remove ${item.sku}`} onClick={() => run(() => removePoItem({ itemId: item.id }))}>
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </Td>
    </tr>
  );
}

export function DraftLines({ items }: { items: DraftLineItem[] }) {
  if (!items.length) return <p className="px-5 py-8 text-center text-sm text-muted">No lines yet. Search for a variant below to add one.</p>;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Variant</Th>
          <Th className="text-right">Qty</Th>
          <Th className="text-right">Unit cost ₹</Th>
          <Th className="text-right">Line total</Th>
          <Th className="sr-only">Actions</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((i) => (
          <DraftLineRow key={`${i.id}-${i.quantity}-${i.unitCost}`} item={i} />
        ))}
      </tbody>
    </Table>
  );
}

/** Search-as-you-type variant picker; picking one pre-fills unit cost from the variant's cost price. */
export function PoLineAdder({ poId, supplierId }: { poId: string; supplierId: string }) {
  const { pending, run } = useAdminAction();
  const listId = useId();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<VariantOption[]>([]);
  const [picked, setPicked] = useState<VariantOption | null>(null);
  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState("");

  useEffect(() => {
    if (picked) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await searchVariants({ q, supplierId });
        if (live) setResults(r);
      } catch {
        if (live) setResults([]);
      }
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, supplierId, picked]);

  function pick(v: VariantOption) {
    setPicked(v);
    setCost(v.costPrice === null ? "" : String(toMajor(v.costPrice)));
    setQty("1");
  }

  return (
    <div className="space-y-4 p-5">
      {picked ? (
        <form
          className="grid gap-4 sm:grid-cols-[1fr_7rem_9rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => addPoLine({ poId, variantId: picked.id, quantity: Number(qty), unitCost: cost.trim() === "" ? null : Number(cost) }), {
              onSuccess: () => {
                setPicked(null);
                setQ("");
              },
            });
          }}
        >
          <div>
            <p className="eyebrow !text-muted">Variant</p>
            <p className="py-3 text-sm">
              {picked.product} <span className="text-subtle">{picked.label}</span> <span className="font-mono text-xs text-subtle">{picked.sku}</span>
              <button type="button" className="ml-3 text-xs uppercase tracking-[0.18em] text-muted hover:text-gold" onClick={() => setPicked(null)}>
                Change
              </button>
            </p>
          </div>
          <Field label="Quantity">
            <Input type="number" min={1} step={1} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} required autoFocus />
          </Field>
          <Field label="Unit cost ₹" hint={picked.costPrice === null ? "No cost on file" : undefined}>
            <Input type="number" min={0} step={0.01} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" />
          </Field>
          <Button type="submit" size="sm" disabled={pending || !(Number(qty) >= 1)}>
            Add line
          </Button>
        </form>
      ) : (
        <>
          <label className="block">
            <span className="eyebrow !text-muted">Add a variant</span>
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search product, SKU or scan a barcode"
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls={listId}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (results[0]) pick(results[0]);
                }
              }}
            />
          </label>
          <ul id={listId} role="listbox" aria-label="Matching variants" className="max-h-72 divide-y divide-line overflow-y-auto border border-line">
            {results.map((v) => (
              <li key={v.id} role="option" aria-selected={false}>
                <button type="button" onClick={() => pick(v)} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm hover:bg-gold/5 focus:bg-gold/5 focus:outline-none">
                  <span>
                    {v.product} <span className="text-subtle">{v.label}</span>
                    <span className="block font-mono text-xs text-subtle">{v.sku}</span>
                  </span>
                  <span className="text-right text-xs text-muted">
                    {v.supplierId === supplierId ? <span className="block text-gold">Preferred</span> : null}
                    {v.stock} in stock · {v.costPrice === null ? "no cost" : formatMoney(v.costPrice)}
                  </span>
                </button>
              </li>
            ))}
            {!results.length ? <li className="px-4 py-3 text-sm text-muted">{q ? "No matches." : "Type to search."}</li> : null}
          </ul>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────── Details & status ───────────────────────────────

export function PoDetailsForm({ poId, notes, expectedAt, readOnly }: { poId: string; notes: string | null; expectedAt: Date | null; readOnly: boolean }) {
  const { pending, run } = useAdminAction();
  const [f, setF] = useState({ notes: notes ?? "", expectedAt: toDateInput(expectedAt) });
  return (
    <form
      className="grid gap-6 p-5 sm:grid-cols-[12rem_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => savePoDetails({ poId, ...f }));
      }}
    >
      <Field label="Expected delivery">
        <Input type="date" value={f.expectedAt} disabled={readOnly} onChange={(e) => setF((p) => ({ ...p, expectedAt: e.target.value }))} />
      </Field>
      <Field label="Notes">
        <Textarea value={f.notes} disabled={readOnly} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} maxLength={2000} className="min-h-12" />
      </Field>
      {!readOnly ? (
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Save
        </Button>
      ) : null}
    </form>
  );
}

export function PoStatusActions({ poId, number, canOrder, canCancel }: { poId: string; number: string; canOrder: boolean; canCancel: boolean }) {
  const { pending, run } = useAdminAction();
  return (
    <>
      {canOrder ? (
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Mark ${number} as ordered? Its lines will be locked.`)) run(() => markPoOrdered({ poId }));
          }}
        >
          Mark as ordered
        </Button>
      ) : null}
      {canCancel ? (
        <Button
          type="button"
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Cancel ${number}? This can't be undone.`)) run(() => cancelPo({ poId }));
          }}
        >
          Cancel PO
        </Button>
      ) : null}
    </>
  );
}

// ─────────────────────────────── Receiving ───────────────────────────────

export type ReceiveItem = { id: string; sku: string; product: string; label: string; quantity: number; received: number; unitCost: number };

export function PoReceiveForm({ poId, items }: { poId: string; items: ReceiveItem[] }) {
  const { pending, run } = useAdminAction();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [over, setOver] = useState(false);
  const outstanding = (i: ReceiveItem) => Math.max(0, i.quantity - i.received);
  const n = (id: string) => Number(qty[id] || 0);
  const invalid = items.filter((i) => {
    const v = n(i.id);
    return !Number.isInteger(v) || v < 0 || (!over && v > outstanding(i));
  });
  const total = items.reduce((t, i) => t + (Number.isInteger(n(i.id)) ? n(i.id) : 0), 0);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid.length || !total) return;
        run(() => receivePo({ poId, overReceive: over, lines: items.map((i) => ({ itemId: i.id, quantity: n(i.id) })).filter((l) => l.quantity > 0) }), { onSuccess: () => setQty({}) });
      }}
    >
      <Table>
        <thead>
          <tr>
            <Th>Variant</Th>
            <Th className="text-right">Ordered</Th>
            <Th className="text-right">Received</Th>
            <Th className="text-right">Outstanding</Th>
            <Th className="text-right">Receive now</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const bad = invalid.includes(i);
            return (
              <tr key={i.id}>
                <Td>
                  {i.product} <span className="text-xs text-subtle">{i.label}</span>
                  <span className="block font-mono text-xs text-subtle">{i.sku}</span>
                </Td>
                <Td className="text-right tabular-nums">{i.quantity}</Td>
                <Td className="text-right tabular-nums text-muted">{i.received}</Td>
                <Td className={cn("text-right tabular-nums", outstanding(i) ? "text-gold" : "text-subtle")}>{outstanding(i)}</Td>
                <Td className="w-40">
                  <div className="flex items-center gap-2">
                    <label className="flex-1">
                      <span className="sr-only">Units of {i.sku} received now</span>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        value={qty[i.id] ?? ""}
                        placeholder="0"
                        aria-invalid={bad || undefined}
                        onChange={(e) => setQty((p) => ({ ...p, [i.id]: e.target.value }))}
                        className="py-1.5 text-right tabular-nums"
                      />
                    </label>
                    {outstanding(i) ? (
                      <button type="button" className="text-[0.625rem] uppercase tracking-[0.18em] text-muted hover:text-gold" onClick={() => setQty((p) => ({ ...p, [i.id]: String(outstanding(i)) }))} aria-label={`Receive all ${outstanding(i)} outstanding of ${i.sku}`}>
                        All
                      </button>
                    ) : null}
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <label className="flex items-center gap-3 text-sm text-muted">
          <input type="checkbox" checked={over} onChange={(e) => setOver(e.target.checked)} className="size-4 accent-[var(--gold)]" />
          Over-receive (accept more than ordered)
        </label>
        <div className="flex items-center gap-3">
          <Button type="button" size="sm" variant="ghost" onClick={() => setQty(Object.fromEntries(items.map((i) => [i.id, String(outstanding(i))])))}>
            Fill all outstanding
          </Button>
          <Button type="submit" size="sm" disabled={pending || !total || invalid.length > 0}>
            {pending ? "Receiving…" : `Receive ${total} unit${total === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
      {invalid.length && !over ? <p className="px-5 pb-4 text-xs text-ember">More than outstanding on {invalid.length} line{invalid.length === 1 ? "" : "s"}. Tick over-receive if that&rsquo;s intended.</p> : null}
    </form>
  );
}
