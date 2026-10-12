import "server-only";
import { cache } from "react";
import type { z } from "zod";
import { isCurrency, type Currency } from "@/config/brand";
import { canDo } from "@/lib/permissions";
import { setFxTable, type FxTable } from "@/lib/money";
import { setRegionNow } from "@/lib/region-runtime";
import { DEFAULT_REGION, fallbackRate, regionSchema, roundingFor, type Region, type RegionInput } from "@/lib/region-shared";
import { db } from "./db";
import { audit } from "./audit";

/*
 * Store region (Admin → Settings → Region & currency): country, time zone, base / display currencies, phone code,
 * tax label and formatting locale. Stored in Setting "region"; the zod defaults are the original India behaviour, so
 * nothing changes until the owner saves something. Exchange rates: src/server/fx.ts. Base-currency changes go through
 * the conversion wizard (src/server/currency-conversion.ts), never through this form.
 */

export const REGION_KEY = "region";

// A short process cache on top of React's per-request cache: crons, emails and server actions read the region too.
const TTL_MS = 30_000;
let memo: { at: number; region: Region; fx: FxTable } | null = null;

export function invalidateRegion() {
  memo = null;
}

async function loadRegion(): Promise<Region> {
  const row = await db.setting.findUnique({ where: { key: REGION_KEY } }).catch(() => null);
  const parsed = regionSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : DEFAULT_REGION;
}

/** Effective exchange-rate table for the region's base: manual pins win over fetched rates; fallbacks fill gaps. */
export async function buildFxTable(region: Region): Promise<FxTable> {
  const rows = await db.exchangeRate.findMany({ where: { base: region.baseCurrency } }).catch(() => []);
  const byQuote = new Map(rows.map((r) => [r.quote, r]));
  const rates: FxTable["rates"] = {};
  for (const code of region.enabledCurrencies) {
    if (!isCurrency(code)) continue;
    const row = byQuote.get(code);
    const rate = code === region.baseCurrency ? 1 : (row?.manualRate ?? row?.rate ?? fallbackRate(region.baseCurrency, code));
    rates[code] = { rate, rounding: roundingFor(region, code) };
  }
  return { base: region.baseCurrency, rates };
}

async function fresh() {
  if (memo && Date.now() - memo.at < TTL_MS) return memo;
  const region = await loadRegion();
  const fx = await buildFxTable(region);
  memo = { at: Date.now(), region, fx };
  // Every formatMoney() in this process now uses the store's base currency and live rates.
  setFxTable(fx);
  setRegionNow(region);
  return memo;
}

/** Store region settings (cached per request, refreshed every 30 s). */
export const getRegion = cache(async (): Promise<Region> => (await fresh()).region);

/** The live exchange-rate table (base + enabled currencies with rate and rounding). */
export const getFxTable = cache(async (): Promise<FxTable> => (await fresh()).fx);

/** Loads the region + rates and installs them for formatMoney(). Called at boot and by long-running jobs. */
export async function primeMoney() {
  await fresh();
}

/** IANA time zone the store reports, buckets days and prints dates in. */
export async function storeTimezone() {
  return (await getRegion()).timezone;
}

/** Base currency every stored amount is in. */
export async function baseCurrency(): Promise<Currency> {
  return (await getRegion()).baseCurrency;
}

/** Date formatter in the store's time zone and locale. */
export async function storeDateFormat(opts: Intl.DateTimeFormatOptions) {
  const r = await getRegion();
  const f = new Intl.DateTimeFormat(r.locale, { ...opts, timeZone: r.timezone });
  return (d: Date) => f.format(d);
}

/** What the browser needs (no secrets): region facts and the rate table. */
export type ClientRegion = Pick<Region, "country" | "timezone" | "baseCurrency" | "displayCurrency" | "enabledCurrencies" | "phoneCode" | "taxLabel" | "locale">;
export async function clientRegion(): Promise<{ region: ClientRegion; fx: FxTable }> {
  const { region, fx } = await fresh();
  const { country, timezone, baseCurrency, displayCurrency, enabledCurrencies, phoneCode, taxLabel, locale } = region;
  return { region: { country, timezone, baseCurrency, displayCurrency, enabledCurrencies, phoneCode, taxLabel, locale }, fx };
}

export class RegionPermissionError extends Error {
  constructor(message = "You don’t have permission to do that.") {
    super(message);
  }
}

type Actor = { id: string; permissions: readonly string[] };

/**
 * Saves the region form (settings.manage, audited). The base currency can't change here — that re-prices the whole
 * catalogue and goes through the conversion wizard. `taxRatePercent` also updates the store's default tax rate.
 */
export async function saveRegion(actor: Actor, input: RegionInput & { taxRatePercent?: number }) {
  if (!canDo(actor.permissions, "settings.manage")) throw new RegionPermissionError();
  const { taxRatePercent, ...rest } = input;
  const current = await loadRegion();
  const value = regionSchema.parse({ ...rest, baseCurrency: current.baseCurrency });
  if (rest.baseCurrency && rest.baseCurrency !== current.baseCurrency) throw new Error("Change the base currency with the conversion wizard (Admin → Currencies).");
  await db.setting.upsert({ where: { key: REGION_KEY }, update: { value }, create: { key: REGION_KEY, value } });
  if (taxRatePercent !== undefined) {
    const { storeSettingsSchema } = await import("./settings");
    const row = await db.setting.findUnique({ where: { key: "store" } });
    const store = storeSettingsSchema.parse({ ...((row?.value as object) ?? {}), taxRatePercent });
    await db.setting.upsert({ where: { key: "store" }, update: { value: store }, create: { key: "store", value: store } });
  }
  await audit(actor.id, "region.update", "Setting", REGION_KEY, { ...value, ...(taxRatePercent !== undefined ? { taxRatePercent } : {}) } as z.infer<typeof regionSchema> & object);
  invalidateRegion();
  await primeMoney();
  return value;
}

/** Writes the region directly (wizard / tests). No permission check — callers do that. */
export async function writeRegion(value: Region) {
  const v = regionSchema.parse(value);
  await db.setting.upsert({ where: { key: REGION_KEY }, update: { value: v }, create: { key: REGION_KEY, value: v } });
  invalidateRegion();
  await primeMoney();
  return v;
}
