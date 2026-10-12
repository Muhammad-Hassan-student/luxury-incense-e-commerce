import "server-only";
import { CURRENCY_CODES, isCurrency, type Currency } from "@/config/brand";
import { canDo } from "@/lib/permissions";
import { fallbackRate, ROUNDINGS, roundingFor, type Rounding } from "@/lib/region-shared";
import { db } from "./db";
import { audit } from "./audit";
import { getRegion, invalidateRegion, primeMoney, RegionPermissionError, writeRegion } from "./region";

/*
 * Exchange rates (Admin → Currencies). Daily cron "fx" pulls the free, key-less open.er-api.com feed for the base
 * currency. A failed fetch keeps the last good rates; rates older than STALE_DAYS raise a banner in admin.
 * A manual rate pins a currency (wins over the feed until cleared). Display price = base × rate, rounded per currency.
 */

export const FX_SOURCE_URL = "https://open.er-api.com/v6/latest/";
export const STALE_DAYS = 3;
const STATUS_KEY = "fx-status";

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

let fetcher: FetchLike | null = null;
/** Tests inject a fake fetch; null restores the real one. */
export const setFxFetcher = (f: FetchLike | null) => {
  fetcher = f;
};

/** Rates for 1 `base` in every currency we support. Throws on network / payload problems. */
export async function fetchRates(base: Currency): Promise<Partial<Record<Currency, number>>> {
  const f: FetchLike = fetcher ?? ((url, init) => fetch(url, { ...init, cache: "no-store" }));
  const res = await f(`${FX_SOURCE_URL}${base}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Rate feed answered ${res.status}`);
  const body = (await res.json()) as { result?: string; rates?: Record<string, unknown>; "error-type"?: string };
  if (body?.result !== "success" || !body.rates || typeof body.rates !== "object") throw new Error(`Rate feed error: ${body?.["error-type"] ?? "unexpected payload"}`);
  const out: Partial<Record<Currency, number>> = {};
  for (const code of CURRENCY_CODES) {
    const v = body.rates[code];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[code] = v;
  }
  if (!out[base]) out[base] = 1;
  return out;
}

export type FxStatus = { lastAttemptAt: string | null; lastSuccessAt: string | null; lastError: string | null };

async function readStatus(): Promise<FxStatus> {
  const row = await db.setting.findUnique({ where: { key: STATUS_KEY } });
  const v = (row?.value ?? {}) as Partial<FxStatus>;
  return { lastAttemptAt: v.lastAttemptAt ?? null, lastSuccessAt: v.lastSuccessAt ?? null, lastError: v.lastError ?? null };
}
async function writeStatus(s: FxStatus) {
  await db.setting.upsert({ where: { key: STATUS_KEY }, update: { value: s }, create: { key: STATUS_KEY, value: s } });
}

/** Fetches fresh rates for the base currency and stores them. Never throws: failures keep the last good rates. */
export async function refreshRates(opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const region = await getRegion();
  const base = region.baseCurrency;
  const status = await readStatus();
  try {
    const rates = await fetchRates(base);
    let updated = 0;
    for (const [quote, rate] of Object.entries(rates) as [Currency, number][]) {
      if (quote === base) continue;
      const existing = await db.exchangeRate.findUnique({ where: { base_quote: { base, quote } } });
      await db.exchangeRate.upsert({
        where: { base_quote: { base, quote } },
        update: { rate, fetchedAt: now, source: existing?.manualRate != null ? "manual" : "auto" },
        create: { base, quote, rate, fetchedAt: now, source: "auto" },
      });
      updated++;
    }
    await writeStatus({ lastAttemptAt: now.toISOString(), lastSuccessAt: now.toISOString(), lastError: null });
    invalidateRegion();
    await primeMoney();
    return { ok: true as const, base, updated };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await writeStatus({ ...status, lastAttemptAt: now.toISOString(), lastError: error });
    console.error("[fx] refresh failed — keeping last rates:", error);
    return { ok: false as const, base, error };
  }
}

export type CurrencyRow = {
  code: Currency;
  enabled: boolean;
  isBase: boolean;
  isDisplayDefault: boolean;
  rounding: Rounding;
  /** Rate in effect (1 base = rate) */
  rate: number;
  autoRate: number | null;
  manualRate: number | null;
  source: "auto" | "manual" | "fallback" | "base";
  fetchedAt: Date | null;
  stale: boolean;
};

/** Everything the currencies page shows, plus whether the feed is stale. */
export async function currencyOverview(now = new Date()) {
  const region = await getRegion();
  const rows = await db.exchangeRate.findMany({ where: { base: region.baseCurrency } });
  const byQuote = new Map(rows.map((r) => [r.quote, r]));
  const status = await readStatus();
  const staleBefore = now.getTime() - STALE_DAYS * 86_400_000;
  const list: CurrencyRow[] = CURRENCY_CODES.map((code) => {
    const r = byQuote.get(code);
    const isBase = code === region.baseCurrency;
    const fetchedAt = r?.fetchedAt ?? null;
    return {
      code,
      enabled: region.enabledCurrencies.includes(code),
      isBase,
      isDisplayDefault: code === region.displayCurrency,
      rounding: roundingFor(region, code),
      rate: isBase ? 1 : (r?.manualRate ?? r?.rate ?? fallbackRate(region.baseCurrency, code)),
      autoRate: r?.rate ?? null,
      manualRate: r?.manualRate ?? null,
      source: isBase ? "base" : r?.manualRate != null ? "manual" : r ? "auto" : "fallback",
      fetchedAt,
      stale: !isBase && r?.manualRate == null && (!fetchedAt || fetchedAt.getTime() < staleBefore),
    };
  });
  const lastSuccess = status.lastSuccessAt ? new Date(status.lastSuccessAt) : null;
  const newest = rows.reduce<Date | null>((d, r) => (!d || r.fetchedAt > d ? r.fetchedAt : d), null);
  const freshest = lastSuccess && newest ? (lastSuccess > newest ? lastSuccess : newest) : (lastSuccess ?? newest);
  const stale = list.some((c) => c.enabled && c.stale);
  return { region, list, status, lastUpdated: freshest, stale };
}

/** Rates stale for more than STALE_DAYS on an enabled currency (admin dashboard / banner). */
export async function ratesAreStale(now = new Date()) {
  return (await currencyOverview(now)).stale;
}

type Actor = { id: string; permissions: readonly string[] };
const guard = (actor: Actor) => {
  if (!canDo(actor.permissions, "settings.manage")) throw new RegionPermissionError();
};

/** Pins (or with null, un-pins) the rate for one currency against the base. */
export async function pinRate(actor: Actor, quote: string, manualRate: number | null, now = new Date()) {
  guard(actor);
  if (!isCurrency(quote)) throw new Error("Unsupported currency.");
  if (manualRate !== null && (!Number.isFinite(manualRate) || manualRate <= 0 || manualRate > 1_000_000)) throw new Error("Enter a positive rate.");
  const { baseCurrency: base } = await getRegion();
  if (quote === base) throw new Error("The base currency is always 1.");
  const existing = await db.exchangeRate.findUnique({ where: { base_quote: { base, quote } } });
  await db.exchangeRate.upsert({
    where: { base_quote: { base, quote } },
    update: { manualRate, source: manualRate != null ? "manual" : "auto" },
    create: { base, quote, rate: manualRate ?? fallbackRate(base, quote), manualRate, source: manualRate != null ? "manual" : "auto", fetchedAt: manualRate != null ? now : new Date(0) },
  });
  await audit(actor.id, manualRate != null ? "fx.pin" : "fx.unpin", "ExchangeRate", `${base}/${quote}`, { base, quote, manualRate, previous: existing?.manualRate ?? null, auto: existing?.rate ?? null });
  invalidateRegion();
  await primeMoney();
}

/** Turns a currency on/off for shoppers and sets its rounding rule. The base and default display currency stay on. */
export async function setCurrencyOptions(actor: Actor, code: string, opts: { enabled?: boolean; rounding?: Rounding }) {
  guard(actor);
  if (!isCurrency(code)) throw new Error("Unsupported currency.");
  if (opts.rounding && !ROUNDINGS.includes(opts.rounding)) throw new Error("Unknown rounding rule.");
  const region = await getRegion();
  if (opts.enabled === false && (code === region.baseCurrency || code === region.displayCurrency)) throw new Error("The base and default display currencies can’t be switched off.");
  const enabled = opts.enabled === undefined ? region.enabledCurrencies : opts.enabled ? [...new Set([...region.enabledCurrencies, code])] : region.enabledCurrencies.filter((c) => c !== code);
  const rounding = opts.rounding ? { ...region.rounding, [code]: opts.rounding } : region.rounding;
  await writeRegion({ ...region, enabledCurrencies: enabled, rounding });
  await audit(actor.id, "fx.currency", "Setting", code, { code, ...opts });
}

/** "Refresh now" (settings.manage). */
export async function refreshRatesNow(actor: Actor) {
  guard(actor);
  const r = await refreshRates();
  await audit(actor.id, "fx.refresh", "ExchangeRate", null, r.ok ? { base: r.base, updated: r.updated } : { base: r.base, error: r.error });
  return r;
}
