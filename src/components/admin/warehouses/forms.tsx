"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { advanceTransfer, createStockTransfer, makeDefaultWarehouse, saveLocationReorderPoint, saveTransferLines, saveWarehouse, searchTransferVariants, type TransferVariantOption } from "@/actions/admin-warehouses";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Table, Td, Th } from "@/components/admin/ui";
import { useAdminAction } from "@/components/admin/use-admin-action";

// ─────────────────────────────── Warehouse ───────────────────────────────

export type WarehouseValue = { id?: string; code: string; name: string; address: string; city: string; state: string; pincode: string; priority: number; pickupLocation: string; active: boolean };

export function WarehouseForm({ initial, isDefault = false }: { initial?: WarehouseValue; isDefault?: boolean }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [f, setF] = useState<WarehouseValue>(initial ?? { code: "", name: "", address: "", city: "", state: "", pincode: "", priority: 100, pickupLocation: "", active: true });
  const set = <K extends keyof WarehouseValue>(k: K, v: WarehouseValue[K]) => setF((p) => ({ ...p, [k]: v }));

  return (
    <form
      className="grid gap-x-6 gap-y-5 p-5 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveWarehouse(f), {
          onSuccess: (r) => {
            if (!initial && r.id) router.push(`/admin/warehouses/${r.id}`);
            else router.refresh();
          },
        });
      }}
    >
      <Field label="Code" hint="Short, e.g. MAIN, DEL, BOM">
        <Input value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase())} required minLength={2} maxLength={12} className="font-mono" />
      </Field>
      <Field label="Name">
        <Input value={f.name} onChange={(e) => set("name", e.target.value)} required minLength={2} maxLength={80} />
      </Field>
      <Field label="Pincode" hint="Used to pick the nearest warehouse">
        <Input value={f.pincode} onChange={(e) => set("pincode", e.target.value)} inputMode="numeric" maxLength={6} pattern="\d{6}" />
      </Field>
      <Field label="Priority" hint="Lower ships first when equally close">
        <Input type="number" min={0} max={1000} step={1} value={f.priority} onChange={(e) => set("priority", Number(e.target.value || 0))} />
      </Field>
      <Field label="Address" className="sm:col-span-2">
        <Input value={f.address} onChange={(e) => set("address", e.target.value)} maxLength={200} />
      </Field>
      <Field label="City">
        <Input value={f.city} onChange={(e) => set("city", e.target.value)} maxLength={60} />
      </Field>
      <Field label="State">
        <Input value={f.state} onChange={(e) => set("state", e.target.value)} maxLength={60} />
      </Field>
      <Field label="Courier pickup location" hint="Exactly as named in Shiprocket → Pickup addresses" className="sm:col-span-2">
        <Input value={f.pickupLocation} onChange={(e) => set("pickupLocation", e.target.value)} maxLength={80} placeholder="Blank = the Integrations default" />
      </Field>
      {initial ? (
        <label className="flex items-center gap-3 self-end pb-3 text-sm text-muted sm:col-span-2">
          <input type="checkbox" checked={f.active} disabled={isDefault} onChange={(e) => set("active", e.target.checked)} className="size-4 accent-[var(--gold)]" />
          Active {isDefault ? "(the default warehouse is always active)" : "— only an empty warehouse can be deactivated"}
        </label>
      ) : null}
      <div className="flex items-end justify-end sm:col-span-2 lg:col-span-4">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : initial ? "Save warehouse" : "Add warehouse"}
        </Button>
      </div>
    </form>
  );
}

export function MakeDefaultButton({ id, code }: { id: string; code: string }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        if (window.confirm(`Make ${code} the default? Stock received or returned without a location will go here.`)) run(() => makeDefaultWarehouse({ id }), { onSuccess: () => router.refresh() });
      }}
    >
      Make default
    </Button>
  );
}

export function LocationReorderPoint({ warehouseId, variantId, sku, value, placeholder }: { warehouseId: string; variantId: string; sku: string; value: number | null; placeholder: number }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [v, setV] = useState(value === null ? "" : String(value));
  const dirty = v !== (value === null ? "" : String(value));
  const valid = v.trim() === "" || /^\d+$/.test(v.trim());
  return (
    <form
      className="flex items-center justify-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!dirty || !valid) return;
        run(() => saveLocationReorderPoint({ warehouseId, variantId, reorderPoint: v.trim() === "" ? null : Number(v) }), { onSuccess: () => router.refresh() });
      }}
    >
      <label className="w-20">
        <span className="sr-only">Low-stock level for {sku} here</span>
        <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={String(placeholder)} inputMode="numeric" aria-invalid={!valid || undefined} className="py-1 text-right tabular-nums" />
      </label>
      <Button type="submit" size="sm" variant="ghost" disabled={pending || !dirty || !valid} className="px-2">
        Set
      </Button>
    </form>
  );
}

// ─────────────────────────────── Transfers ───────────────────────────────

type Line = { variantId: string; sku: string; product: string; label: string; quantity: number; available?: number };

function LineBuilder({ fromId, lines, setLines }: { fromId: string; lines: Line[]; setLines: (fn: (l: Line[]) => Line[]) => void }) {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<TransferVariantOption[]>([]);
  useEffect(() => {
    if (!fromId) return;
    let live = true;
    const t = setTimeout(async () => {
      const r = await searchTransferVariants({ q, warehouseId: fromId });
      if (live) setOptions(r);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, fromId]);

  return (
    <div className="grid gap-4">
      <label className="block">
        <span className="eyebrow !text-muted">Add a variant</span>
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product, SKU or scan a barcode" />
      </label>
      {options.length ? (
        <ul className="max-h-56 divide-y divide-line overflow-y-auto border border-line">
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                disabled={o.available <= 0 || lines.some((l) => l.variantId === o.id)}
                onClick={() => setLines((ls) => [...ls, { variantId: o.id, sku: o.sku, product: o.product, label: o.label, quantity: 1, available: o.available }])}
                className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-bg-soft disabled:opacity-40"
              >
                <span className="min-w-0 truncate">
                  {o.product} <span className="text-xs text-subtle">{o.label}</span>
                  <span className="block font-mono text-[0.6875rem] text-subtle">{o.sku}</span>
                </span>
                <span className="shrink-0 text-xs text-muted">{o.available} free</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {lines.length ? (
        <Table className="min-w-[420px]">
          <thead>
            <tr>
              <Th>Variant</Th>
              <Th className="text-right">Quantity</Th>
              <Th className="sr-only">Remove</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.variantId}>
                <Td>
                  {l.product} <span className="text-xs text-subtle">{l.label}</span>
                  <span className="block font-mono text-[0.6875rem] text-subtle">
                    {l.sku}
                    {l.available !== undefined ? ` · ${l.available} free at source` : ""}
                  </span>
                </Td>
                <Td className="w-28">
                  <label>
                    <span className="sr-only">Quantity of {l.sku}</span>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      value={l.quantity}
                      onChange={(e) => setLines((ls) => ls.map((x) => (x.variantId === l.variantId ? { ...x, quantity: Math.max(0, Math.floor(Number(e.target.value) || 0)) } : x)))}
                      className="py-1.5 text-right tabular-nums"
                    />
                  </label>
                </Td>
                <Td className="w-12 text-right">
                  <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.variantId !== l.variantId))} className="p-1 text-muted hover:text-ember" aria-label={`Remove ${l.sku}`}>
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
    </div>
  );
}

export function TransferCreateForm({ warehouses }: { warehouses: { id: string; code: string; name: string }[] }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [fromId, setFromId] = useState(warehouses[0]?.id ?? "");
  const [toId, setToId] = useState(warehouses[1]?.id ?? "");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const valid = fromId && toId && fromId !== toId && lines.length > 0 && lines.every((l) => l.quantity >= 1);

  return (
    <form
      className="grid gap-6 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        run(() => createStockTransfer({ fromId, toId, note, lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })) }), { onSuccess: (r) => r.id && router.push(`/admin/transfers/${r.id}`) });
      }}
    >
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="From">
          <Select
            value={fromId}
            onChange={(e) => {
              setFromId(e.target.value);
              setLines([]);
            }}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="To" error={fromId === toId ? "Pick a different warehouse" : undefined}>
          <Select value={toId} onChange={(e) => setToId(e.target.value)}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Diwali restock for Delhi" />
        </Field>
      </div>
      <LineBuilder fromId={fromId} lines={lines} setLines={setLines} />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending || !valid}>
          {pending ? "Saving…" : `Create draft${lines.length ? ` · ${lines.reduce((n, l) => n + l.quantity, 0)} units` : ""}`}
        </Button>
      </div>
    </form>
  );
}

export function TransferLinesEditor({ id, fromId, initial }: { id: string; fromId: string; initial: Line[] }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [lines, setLines] = useState<Line[]>(initial);
  const valid = lines.length > 0 && lines.every((l) => l.quantity >= 1);
  return (
    <div className="grid gap-4 p-5">
      <LineBuilder fromId={fromId} lines={lines} setLines={setLines} />
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" disabled={pending || !valid} onClick={() => run(() => saveTransferLines({ id, lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })) }), { onSuccess: () => router.refresh() })}>
          Save lines
        </Button>
      </div>
    </div>
  );
}

export function TransferSteps({ id, number, status }: { id: string; number: string; status: "DRAFT" | "IN_TRANSIT" | "RECEIVED" | "CANCELLED" }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const step = (s: "dispatch" | "receive" | "cancel") => run(() => advanceTransfer({ id, step: s }), { onSuccess: () => router.refresh() });
  if (status === "RECEIVED" || status === "CANCELLED") return null;
  return (
    <div className="flex flex-wrap gap-3">
      {status === "DRAFT" ? (
        <Button type="button" size="sm" disabled={pending} onClick={() => window.confirm(`Dispatch ${number}? The units leave the source warehouse now.`) && step("dispatch")}>
          Dispatch
        </Button>
      ) : (
        <Button type="button" size="sm" disabled={pending} onClick={() => window.confirm(`Mark ${number} received? The units become sellable at the destination.`) && step("receive")}>
          Mark received
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="danger"
        disabled={pending}
        onClick={() => window.confirm(status === "IN_TRANSIT" ? `Cancel ${number}? The units go back to the source warehouse.` : `Cancel draft ${number}?`) && step("cancel")}
      >
        Cancel
      </Button>
    </div>
  );
}
