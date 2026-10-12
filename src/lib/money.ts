import { currencies, isCurrency, type Currency } from "@/config/brand";
import { convertMinor, DEFAULT_ROUNDING, fallbackRate, type Rounding } from "./region-shared";

/*
 * Money formatting. Every stored amount is integer minor units (hundredths) of the store's base currency.
 *
 * The exchange-rate table is process-wide: the server primes it from the database (src/server/region.ts —
 * instrumentation at boot, then refreshed by the root layout), and the browser receives the same snapshot through
 * <CurrencyProvider>. Base and rates are store-wide settings, not per-request data, so sharing them is safe.
 */

export type FxEntry = { rate: number; rounding: Rounding };
export type FxTable = { base: Currency; rates: Partial<Record<Currency, FxEntry>> };

function fallbackTable(base: Currency = "INR"): FxTable {
  const rates: FxTable["rates"] = {};
  for (const code of Object.keys(currencies) as Currency[]) rates[code] = { rate: code === base ? 1 : fallbackRate(base, code), rounding: DEFAULT_ROUNDING[code] };
  return { base, rates };
}

// Kept on globalThis: Next bundles this module separately for server components, SSR, route handlers and
// instrumentation, and all of them must see the same table.
const store = globalThis as unknown as { __maisonFx?: FxTable };
const tableNow = () => (store.__maisonFx ??= fallbackTable());

/** Replaces the process-wide rate table (server: src/server/region.ts; browser: CurrencyProvider). */
export function setFxTable(t: FxTable) {
  store.__maisonFx = t;
}
export const currentFxTable = () => tableNow();
export const baseCurrency = () => tableNow().base;

/** A base amount in another currency (minor units of that currency), rounded by its rule. Null = no rate. */
export function toCurrencyMinor(minor: number, currency: string, t: FxTable = tableNow()): number | null {
  if (currency === t.base) return minor;
  const e = isCurrency(currency) ? t.rates[currency] : undefined;
  return e ? convertMinor(minor, e.rate, e.rounding) : null;
}

/** Formats minor units that are already in `currency` (no conversion). */
export function formatAmount(minor: number, currency: string, opts: { legacy?: boolean; fixed?: boolean } = {}) {
  const meta = isCurrency(currency) ? currencies[currency] : null;
  const major = minor / 100;
  const fractional = Math.round(minor) % 100 !== 0;
  // Base-currency amounts keep the store's original style: no paise from 1,000 up.
  // Invoices (`fixed`) always print two decimals.
  const digits = opts.fixed ? 2 : !fractional || (opts.legacy && Math.abs(major) >= 1000) ? 0 : 2;
  try {
    return new Intl.NumberFormat(meta?.locale ?? "en-US", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(major);
  } catch {
    return `${currency} ${major.toFixed(digits)}`;
  }
}

/** Format integer minor units of the base currency, converted to a display currency (base when omitted or unknown). */
export function formatMoney(minor: number, currency?: string) {
  const t = tableNow();
  const code = currency ?? t.base;
  const converted = toCurrencyMinor(minor, code, t);
  if (converted === null || code === t.base) return formatAmount(minor, t.base, { legacy: true });
  return formatAmount(converted, code);
}

/** What an order recorded about its money: `currency` = base it was priced in; `charge*` when the card was charged in another. */
export type OrderMoneyInfo = { currency: string; chargeCurrency?: string | null; chargeAmount?: number | null; fxRate?: number | null; fxRounding?: string | null };

/** The currency the customer was actually charged in. */
export const chargedCurrency = (o: OrderMoneyInfo) => (o.chargeCurrency && o.fxRate ? o.chargeCurrency : o.currency);

/**
 * Formats an order amount (minor units of the order's own base currency) in the currency the customer was charged,
 * using the rate and rounding frozen on the order — the same figures they saw at checkout. Historical orders keep
 * their own currency even after the store's base currency changes.
 */
export function formatOrderMoney(minor: number, o: OrderMoneyInfo, opts: { fixed?: boolean } = {}) {
  if (o.chargeCurrency && o.fxRate && o.chargeCurrency !== o.currency) {
    return formatAmount(convertMinor(minor, o.fxRate, (o.fxRounding as Rounding) || "exact"), o.chargeCurrency, opts);
  }
  return formatAmount(minor, o.currency, { legacy: true, ...opts });
}

/** An order's payable total exactly as charged (the frozen charge amount when charged in another currency). */
export function formatOrderCharge(payable: number, o: OrderMoneyInfo, opts: { fixed?: boolean } = {}) {
  if (o.chargeCurrency && o.chargeAmount != null && o.chargeCurrency !== o.currency) return formatAmount(o.chargeAmount, o.chargeCurrency, opts);
  return formatOrderMoney(payable, o, opts);
}

/** A formatter bound to one order. */
export const orderMoney = (o: OrderMoneyInfo) => (minor: number) => formatOrderMoney(minor, o);

/** Symbol of the store's base currency (for admin money inputs: "Price Rs"). */
export const baseSymbol = () => currencies[tableNow().base].symbol;
