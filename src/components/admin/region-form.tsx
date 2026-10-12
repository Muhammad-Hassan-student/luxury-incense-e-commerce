"use client";

import { useState } from "react";
import Link from "next/link";
import { saveRegionSettings } from "@/actions/admin-region";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { currencies, CURRENCY_CODES, type Currency } from "@/config/brand";
import { COUNTRY_PRESETS } from "@/lib/region-shared";
import { cn } from "@/lib/utils";
import { useAdminAction } from "./use-admin-action";

export type RegionFormValue = {
  country: string;
  timezone: string;
  baseCurrency: Currency;
  displayCurrency: Currency;
  enabledCurrencies: Currency[];
  phoneCode: string;
  taxLabel: string;
  taxRatePercent: number;
  locale: string;
};

/** Admin → Settings → Region & currency. Picking a country fills in its usual time zone, currency, phone code and tax. */
export function RegionForm({ initial, zones }: { initial: RegionFormValue; /** IANA zones (from the server, so SSR and browser agree) */ zones: string[] }) {
  const { pending, run } = useAdminAction();
  const [f, setF] = useState({ ...initial, taxRatePercent: String(initial.taxRatePercent) });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const countries = Object.entries(COUNTRY_PRESETS).sort((a, b) => a[1].name.localeCompare(b[1].name));

  const pickCountry = (code: string) => {
    const p = COUNTRY_PRESETS[code];
    if (!p) return set("country", code);
    setF((s) => ({
      ...s,
      country: code,
      timezone: p.timezone,
      phoneCode: p.phone,
      taxLabel: p.taxLabel,
      taxRatePercent: String(p.taxRate),
      locale: p.locale,
      enabledCurrencies: s.enabledCurrencies.includes(p.currency) ? s.enabledCurrencies : [...s.enabledCurrencies, p.currency],
      displayCurrency: p.currency,
    }));
  };
  const toggle = (c: Currency) =>
    setF((s) => {
      if (c === s.baseCurrency || c === s.displayCurrency) return s;
      return { ...s, enabledCurrencies: s.enabledCurrencies.includes(c) ? s.enabledCurrencies.filter((x) => x !== c) : [...s.enabledCurrencies, c] };
    });
  const preset = COUNTRY_PRESETS[f.country];
  const baseMismatch = preset && preset.currency !== f.baseCurrency;

  return (
    <form
      className="grid gap-6 p-5 sm:grid-cols-2 lg:grid-cols-3"
      data-region-form
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          saveRegionSettings({
            country: f.country,
            timezone: f.timezone,
            displayCurrency: f.displayCurrency,
            enabledCurrencies: f.enabledCurrencies,
            phoneCode: f.phoneCode,
            taxLabel: f.taxLabel,
            taxRatePercent: Number(f.taxRatePercent),
            locale: f.locale,
          }),
        );
      }}
    >
      <Field label="Country" hint="Fills in the usual time zone, currency, phone code and tax">
        <Select value={f.country} onChange={(e) => pickCountry(e.target.value)} name="country">
          {!preset && <option value={f.country}>{f.country}</option>}
          {countries.map(([code, p]) => (
            <option key={code} value={code} className="bg-bg">
              {p.name} ({code})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Time zone" hint="Type to search. Reports, day boundaries and printed dates use it">
        <Input list="mo-tz-list" value={f.timezone} onChange={(e) => set("timezone", e.target.value)} name="timezone" required autoComplete="off" />
        <datalist id="mo-tz-list">
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      </Field>
      <Field label="Base currency" hint="All prices are stored in it">
        <div className="flex h-11 items-center justify-between gap-3 border-b border-line text-sm">
          <span>
            {currencies[f.baseCurrency].flag} {f.baseCurrency} · {currencies[f.baseCurrency].name}
          </span>
          <Link href="/admin/currencies#base" className="text-xs text-gold underline-offset-4 hover:underline">
            Change…
          </Link>
        </div>
      </Field>
      <Field label="Default display currency" hint="Shown to visitors we can’t place by country">
        <Select value={f.displayCurrency} onChange={(e) => set("displayCurrency", e.target.value as Currency)} name="displayCurrency">
          {f.enabledCurrencies.map((c) => (
            <option key={c} value={c} className="bg-bg">
              {c} — {currencies[c].name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Default phone country code" hint="For numbers typed without +code">
        <Input value={f.phoneCode} onChange={(e) => set("phoneCode", e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" name="phoneCode" required />
      </Field>
      <Field label="Date & number locale" hint="e.g. en-PK, en-IN, en-AE">
        <Input value={f.locale} onChange={(e) => set("locale", e.target.value)} name="locale" required />
      </Field>
      <Field label="Tax label" hint="Printed on invoices and the checkout, e.g. Sales tax, VAT, GST">
        <Input value={f.taxLabel} onChange={(e) => set("taxLabel", e.target.value)} maxLength={30} name="taxLabel" required />
      </Field>
      <Field label="Default tax rate %">
        <Input type="number" min={0} max={50} step={0.01} value={f.taxRatePercent} onChange={(e) => set("taxRatePercent", e.target.value)} name="taxRatePercent" required />
      </Field>

      <fieldset className="sm:col-span-2 lg:col-span-3">
        <legend className="eyebrow mb-3">Currencies shoppers can choose</legend>
        <div className="flex flex-wrap gap-2">
          {CURRENCY_CODES.map((c) => {
            const on = f.enabledCurrencies.includes(c);
            const locked = c === f.baseCurrency || c === f.displayCurrency;
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggle(c)}
                aria-pressed={on}
                disabled={locked}
                title={locked ? "The base and default display currencies are always on" : currencies[c].name}
                className={cn("border px-3 py-1.5 text-xs transition-colors", on ? "border-gold text-gold" : "border-line text-muted hover:border-line-strong", locked && "cursor-default")}
              >
                <span aria-hidden>{currencies[c].flag}</span> {c}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-subtle">Rates, rounding and manual overrides: <Link href="/admin/currencies" className="text-gold underline-offset-4 hover:underline">Currencies</Link>.</p>
      </fieldset>

      {(f.country !== "IN" || baseMismatch) && (
        <div className="space-y-1 border border-line bg-bg p-4 text-xs text-muted sm:col-span-2 lg:col-span-3" data-region-notes>
          {f.country !== "IN" && (
            <>
              <p>India-only features switch off outside India: GST tax documents and GSTR-1/Tally exports (invoices become simple tax invoices with your tax label), Shiprocket courier booking, and Razorpay (it charges INR only — it is offered only while the base currency is INR).</p>
            </>
          )}
          {baseMismatch && (
            <p className="text-gold">
              {preset.name} usually prices in {preset.currency}. Your base currency is still {f.baseCurrency} — convert it with the <Link href="/admin/currencies#base" className="underline underline-offset-4">base-currency wizard</Link> (owner only).
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end sm:col-span-2 lg:col-span-3">
        <Button type="submit" size="sm" disabled={pending}>
          Save region
        </Button>
      </div>
    </form>
  );
}
