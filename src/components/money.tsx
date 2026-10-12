"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { currencies, type Currency } from "@/config/brand";
import { formatMoney, setFxTable, type FxTable } from "@/lib/money";
import { setRegionNow } from "@/lib/region-runtime";
import { DEFAULT_REGION } from "@/lib/region-shared";
import { cn } from "@/lib/utils";

/** Region facts the browser needs (src/server/region.ts → clientRegion). */
export type ClientRegion = {
  country: string;
  timezone: string;
  baseCurrency: Currency;
  displayCurrency: Currency;
  enabledCurrencies: Currency[];
  phoneCode: string;
  taxLabel: string;
  locale: string;
};

const defaultRegion: ClientRegion = {
  country: DEFAULT_REGION.country,
  timezone: DEFAULT_REGION.timezone,
  baseCurrency: DEFAULT_REGION.baseCurrency,
  displayCurrency: DEFAULT_REGION.displayCurrency,
  enabledCurrencies: DEFAULT_REGION.enabledCurrencies,
  phoneCode: DEFAULT_REGION.phoneCode,
  taxLabel: DEFAULT_REGION.taxLabel,
  locale: DEFAULT_REGION.locale,
};

const CurrencyContext = createContext<Currency>(DEFAULT_REGION.displayCurrency);
const RegionContext = createContext<ClientRegion>(defaultRegion);

export function CurrencyProvider({ currency, fx, region, children }: { currency: Currency; fx?: FxTable; region?: ClientRegion; children: ReactNode }) {
  // Same snapshot the server rendered with, installed before any child formats a price (idempotent).
  if (fx) setFxTable(fx);
  if (region) setRegionNow(region);
  return (
    <RegionContext.Provider value={region ?? defaultRegion}>
      <CurrencyContext.Provider value={currency}>{children}</CurrencyContext.Provider>
    </RegionContext.Provider>
  );
}

/** The shopper's display currency. */
export const useCurrency = () => useContext(CurrencyContext);
/** Store region: base currency, time zone, phone code, tax label, locale. */
export const useRegion = () => useContext(RegionContext);
/** Symbol of the base currency, for admin money inputs ("Price Rs"). */
export const useBaseSymbol = () => currencies[useContext(RegionContext).baseCurrency].symbol;

export function useMoney() {
  const currency = useContext(CurrencyContext);
  return (minor: number) => formatMoney(minor, currency);
}

/** Price with optional strike-through compare-at. */
export function Price({ amount, compareAt, className }: { amount: number; compareAt?: number | null; className?: string }) {
  const money = useMoney();
  return (
    <span className={cn("inline-flex items-baseline gap-2 tabular-nums", className)}>
      <span>{money(amount)}</span>
      {compareAt && compareAt > amount ? <s className="text-subtle text-[0.85em]">{money(compareAt)}</s> : null}
    </span>
  );
}

/** Small "≈ converted, charged in X" note, shown when the display currency isn't the store's base currency. */
export function ConvertedNote({ chargeCurrency, className }: { chargeCurrency?: Currency; className?: string }) {
  const t = useTranslations("currency");
  const currency = useCurrency();
  const { baseCurrency } = useContext(RegionContext);
  if (currency === baseCurrency) return null;
  return (
    <p className={cn("text-xs text-subtle", className)} data-converted-note>
      {chargeCurrency && chargeCurrency !== currency ? t("convertedCharged", { base: baseCurrency, charged: chargeCurrency }) : t("converted", { base: baseCurrency })}
    </p>
  );
}
