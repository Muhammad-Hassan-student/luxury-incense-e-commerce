"use client";

import { useState } from "react";
import { setVariantTradeSettings } from "@/actions/admin-trade";
import { useAdminAction } from "@/components/admin/use-admin-action";

/** Inline editor for one variant's case size, trade minimum and trade availability. */
export function PackRowForm({ variantId, label, caseSize, tradeMinQty, tradeEnabled }: { variantId: string; label: string; caseSize: number; tradeMinQty: number; tradeEnabled: boolean }) {
  const { pending, run } = useAdminAction();
  const [f, setF] = useState({ caseSize: String(caseSize), tradeMinQty: String(tradeMinQty), tradeEnabled });
  const dirty = f.caseSize !== String(caseSize) || f.tradeMinQty !== String(tradeMinQty) || f.tradeEnabled !== tradeEnabled;
  const cs = Number(f.caseSize);
  const min = Number(f.tradeMinQty);
  const warn = Number.isInteger(cs) && cs > 0 && Number.isInteger(min) && min % cs !== 0 ? `Smallest orderable: ${Math.ceil(min / cs) * cs}` : null;
  const input = "h-8 w-20 border-0 border-b border-line-strong bg-transparent text-right text-sm tabular-nums text-fg focus:border-gold focus:outline-none";
  return (
    <form
      className="flex flex-wrap items-center justify-end gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setVariantTradeSettings({ variantId, caseSize: cs, tradeMinQty: min, tradeEnabled: f.tradeEnabled }));
      }}
    >
      <label className="flex items-center gap-2 text-xs text-muted">
        Case
        <input type="number" min={1} step={1} value={f.caseSize} onChange={(e) => setF({ ...f, caseSize: e.target.value })} disabled={pending} className={input} aria-label={`Case size for ${label}`} />
      </label>
      <label className="flex items-center gap-2 text-xs text-muted">
        Min
        <input type="number" min={1} step={1} value={f.tradeMinQty} onChange={(e) => setF({ ...f, tradeMinQty: e.target.value })} disabled={pending} className={input} aria-label={`Trade minimum for ${label}`} />
      </label>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={f.tradeEnabled} onChange={(e) => setF({ ...f, tradeEnabled: e.target.checked })} disabled={pending} className="size-4 accent-[var(--gold)]" />
        On trade
      </label>
      <button type="submit" disabled={!dirty || pending} className="w-12 text-[0.625rem] uppercase tracking-[0.18em] text-gold disabled:invisible">
        Save
      </button>
      {warn ? <span className="basis-full text-right text-[0.6875rem] text-subtle">{warn}</span> : null}
    </form>
  );
}
