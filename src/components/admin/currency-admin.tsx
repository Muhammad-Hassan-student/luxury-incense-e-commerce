"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { applyConversionAction, currencyOptionsAction, pinRateAction, previewConversionAction, refreshRatesAction, undoConversionAction } from "@/actions/admin-region";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { currencies, CURRENCY_CODES, type Currency } from "@/config/brand";
import { formatAmount } from "@/lib/money";
import { regionNow } from "@/lib/region-runtime";
import { convertMinor, ROUNDING_LABEL, ROUNDINGS, type Rounding } from "@/lib/region-shared";
import type { ConversionPlan } from "@/server/currency-conversion";
import { cn } from "@/lib/utils";
import { notify, useAdminAction } from "./use-admin-action";

export type CurrencyRowView = {
  code: Currency;
  enabled: boolean;
  isBase: boolean;
  isDisplayDefault: boolean;
  rounding: Rounding;
  rate: number;
  autoRate: number | null;
  manualRate: number | null;
  source: "auto" | "manual" | "fallback" | "base";
  fetchedAt: string | null;
  stale: boolean;
};

const when = (iso: string) => new Date(iso).toLocaleString(regionNow().locale, { dateStyle: "medium", timeStyle: "short", timeZone: regionNow().timezone });
const fmtRate = (r: number) => (r >= 100 ? r.toFixed(2) : r >= 1 ? r.toFixed(4) : r.toPrecision(4));

export function RefreshRatesButton() {
  const { pending, run } = useAdminAction();
  return (
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => refreshRatesAction())} data-refresh-rates>
      <RefreshCw className={cn("size-3.5", pending && "animate-spin")} aria-hidden /> Refresh now
    </Button>
  );
}

function RateRow({ row, base, sample }: { row: CurrencyRowView; base: Currency; sample: number }) {
  const { pending, run } = useAdminAction();
  const [pin, setPin] = useState(row.manualRate != null ? String(row.manualRate) : "");
  const example = row.isBase ? null : formatAmount(convertMinor(sample, row.rate, row.rounding), row.code);
  return (
    <tr className={cn("border-b border-line align-middle", !row.enabled && "opacity-60")} data-currency-row={row.code}>
      <td className="px-4 py-3 text-sm">
        <span aria-hidden className="me-2">{currencies[row.code].flag}</span>
        <span className="font-medium">{row.code}</span>
        <span className="block text-xs text-muted">{currencies[row.code].name}</span>
      </td>
      <td className="px-4 py-3">
        {row.isBase ? (
          <span className="text-xs text-gold">Base</span>
        ) : (
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={row.enabled}
              disabled={pending || row.isDisplayDefault}
              onChange={(e) => run(() => currencyOptionsAction({ code: row.code, enabled: e.target.checked }))}
              className="size-4 accent-[var(--gold)]"
              aria-label={`Offer ${row.code} to shoppers`}
            />
            {row.isDisplayDefault ? "Default" : row.enabled ? "On" : "Off"}
          </label>
        )}
      </td>
      <td className="px-4 py-3 text-sm tabular-nums">
        {row.isBase ? "1" : fmtRate(row.rate)}
        {!row.isBase && (
          <span className={cn("block text-xs", row.source === "manual" ? "text-gold" : row.stale ? "text-ember" : "text-subtle")}>
            {row.source === "manual" ? `Pinned (live ${row.autoRate != null ? fmtRate(row.autoRate) : "—"})` : row.source === "fallback" ? "Built-in estimate" : row.stale ? "Stale" : "Live"}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-muted">{row.isBase ? "—" : row.fetchedAt ? when(row.fetchedAt) : "Never"}</td>
      <td className="px-4 py-3">
        {!row.isBase && (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = Number(pin);
              if (!pin.trim()) return run(() => pinRateAction({ code: row.code, rate: null }));
              if (!(v > 0)) return notify.error("Enter a positive rate, or clear it to follow the live rate.");
              run(() => pinRateAction({ code: row.code, rate: v }));
            }}
          >
            <Input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="decimal" placeholder="Live" aria-label={`Manual ${row.code} rate`} className="h-9 w-28 text-sm" />
            <Button type="submit" size="sm" variant="ghost" disabled={pending}>
              {pin.trim() ? "Pin" : row.manualRate != null ? "Unpin" : "Save"}
            </Button>
          </form>
        )}
      </td>
      <td className="px-4 py-3">
        {row.isBase ? (
          <span className="text-xs text-subtle">Never rounded</span>
        ) : (
          <Select value={row.rounding} disabled={pending} onChange={(e) => run(() => currencyOptionsAction({ code: row.code, rounding: e.target.value }))} aria-label={`${row.code} rounding`} className="h-9 text-xs">
            {ROUNDINGS.map((r) => (
              <option key={r} value={r} className="bg-bg">
                {ROUNDING_LABEL[r]}
              </option>
            ))}
          </Select>
        )}
      </td>
      <td className="px-4 py-3 text-right text-sm tabular-nums">{example ?? formatAmount(sample, base)}</td>
    </tr>
  );
}

export function CurrencyTable({ rows, base, sample }: { rows: CurrencyRowView[]; base: Currency; sample: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] text-left">
        <thead>
          <tr className="border-b border-line-strong text-[0.625rem] uppercase tracking-[0.2em] text-muted">
            <th className="px-4 py-3 font-normal">Currency</th>
            <th className="px-4 py-3 font-normal">Shoppers</th>
            <th className="px-4 py-3 font-normal">1 {base} =</th>
            <th className="px-4 py-3 font-normal">Updated</th>
            <th className="px-4 py-3 font-normal">Manual rate</th>
            <th className="px-4 py-3 font-normal">Rounding</th>
            <th className="px-4 py-3 text-right font-normal">{formatAmount(sample, base)} shows as</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <RateRow key={`${r.code}-${r.rate}-${r.rounding}-${r.enabled}-${r.manualRate}`} row={r} base={base} sample={sample} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────── Base-currency wizard ───────────────────────────────

export function BaseCurrencyWizard({ base, rates, defaultRounding, undo }: { base: Currency; rates: Partial<Record<Currency, number>>; defaultRounding: Partial<Record<Currency, Rounding>>; undo: { from: string; to: string; at: string; changes: number } | null }) {
  const options = CURRENCY_CODES.filter((c) => c !== base);
  const [to, setTo] = useState<Currency>(options[0]);
  const [rate, setRate] = useState(String(rates[options[0]] ?? ""));
  const [rounding, setRounding] = useState<Rounding>(defaultRounding[options[0]] ?? "exact");
  const [plan, setPlan] = useState<ConversionPlan | null>(null);
  const [confirm, setConfirm] = useState("");
  const [previewing, startPreview] = useTransition();
  const { pending, run } = useAdminAction();

  const choose = (c: Currency) => {
    setTo(c);
    setRate(String(rates[c] ?? ""));
    setRounding(defaultRounding[c] ?? "exact");
    setPlan(null);
    setConfirm("");
  };
  const preview = () =>
    startPreview(async () => {
      const r = await previewConversionAction({ to, rate: Number(rate) || undefined, rounding });
      if (!r.ok) {
        notify.error(r.error);
        return;
      }
      setPlan(r.plan);
      setConfirm("");
    });
  const fmt = (minor: number | null, code: string) => (minor === null ? "—" : formatAmount(minor, code));
  const shown = plan?.changes.slice(0, 400) ?? [];

  return (
    <div className="space-y-6 p-5" data-base-wizard>
      <p className="text-sm text-muted">
        Every price is stored in <strong className="text-fg">{base}</strong>. Changing the base converts the whole catalogue and every fixed amount — variant prices, shipping rates, coupons, gift card balances, the free-shipping threshold, trade tiers and promotions — at one rate. Orders, invoices and payouts keep the currency they were made in. A snapshot is saved first, so the last conversion can be undone.
      </p>
      <div className="grid gap-6 sm:grid-cols-3">
        <Field label="New base currency">
          <Select value={to} onChange={(e) => choose(e.target.value as Currency)} name="to">
            {options.map((c) => (
              <option key={c} value={c} className="bg-bg">
                {currencies[c].flag} {c} — {currencies[c].name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Rate: 1 ${base} =`} hint="Current rate (manual pins win). You can adjust it">
          <Input value={rate} onChange={(e) => { setRate(e.target.value); setPlan(null); }} inputMode="decimal" name="rate" />
        </Field>
        <Field label="Rounding for prices" hint="Costs and gift card balances convert exactly">
          <Select value={rounding} onChange={(e) => { setRounding(e.target.value as Rounding); setPlan(null); }} name="rounding">
            {ROUNDINGS.map((r) => (
              <option key={r} value={r} className="bg-bg">
                {ROUNDING_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Button type="button" size="sm" variant="outline" disabled={previewing || !(Number(rate) > 0)} onClick={preview} data-preview>
        {previewing ? "Building preview…" : "Preview conversion"}
      </Button>

      {plan && (
        <div className="space-y-4">
          <p className="text-sm">
            {plan.changes.length} amounts will change from {plan.from} to {plan.to} at 1 {plan.from} = {plan.rate} {plan.to} ({ROUNDING_LABEL[plan.rounding]}).
          </p>
          <div className="max-h-[28rem] overflow-auto border border-line" data-lenis-prevent>
            <table className="w-full text-left text-sm" data-preview-table>
              <thead className="sticky top-0 bg-bg-elev">
                <tr className="text-[0.625rem] uppercase tracking-[0.2em] text-muted">
                  <th className="px-4 py-2 font-normal">What</th>
                  <th className="px-4 py-2 text-right font-normal">Now ({plan.from})</th>
                  <th className="px-4 py-2 text-right font-normal">After ({plan.to})</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-4 py-2">{c.label}</td>
                    {c.kind === "promotion" ? (
                      <td colSpan={2} className="px-4 py-2 text-right text-xs text-muted">
                        Fixed amounts converted
                      </td>
                    ) : (
                      <>
                        <td className="px-4 py-2 text-right tabular-nums text-muted">{fmt(c.from, plan.from)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmt(c.to, plan.to)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {plan.changes.length > shown.length && <p className="px-4 py-2 text-xs text-subtle">…and {plan.changes.length - shown.length} more.</p>}
          </div>
          <form
            className="flex flex-wrap items-end gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => applyConversionAction({ to: plan.to, rate: plan.rate, rounding: plan.rounding, confirm }), { onSuccess: () => setPlan(null) });
            }}
          >
            <Field label={`Type ${plan.to} to confirm`}>
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value.toUpperCase())} autoComplete="off" name="confirm" className="w-40" />
            </Field>
            <Button type="submit" size="sm" variant="danger" disabled={pending || confirm !== plan.to} data-apply>
              Convert to {plan.to}
            </Button>
          </form>
        </div>
      )}

      {undo && (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5 text-sm" data-undo>
          <span className="text-muted">
            Last conversion: {undo.from} → {undo.to} on {when(undo.at)} ({undo.changes} amounts).
          </span>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => undoConversionAction())}>
            Undo last conversion
          </Button>
        </div>
      )}
    </div>
  );
}
