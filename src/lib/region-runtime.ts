import type { Currency } from "@/config/brand";
import { DEFAULT_REGION } from "./region-shared";

/*
 * The store region for synchronous helpers (date formatters, phone defaults). Like the exchange-rate table in
 * src/lib/money.ts it lives on globalThis: the server installs it from the database (src/server/region.ts — at boot,
 * per request through the root layout, and at the start of each cron job); the browser gets it from CurrencyProvider.
 */

export type RegionNow = { country: string; timezone: string; locale: string; phoneCode: string; taxLabel: string; baseCurrency: Currency };

const store = globalThis as unknown as { __maisonRegion?: RegionNow };

const DEFAULTS: RegionNow = {
  country: DEFAULT_REGION.country,
  timezone: DEFAULT_REGION.timezone,
  locale: DEFAULT_REGION.locale,
  phoneCode: DEFAULT_REGION.phoneCode,
  taxLabel: DEFAULT_REGION.taxLabel,
  baseCurrency: DEFAULT_REGION.baseCurrency,
};

export const regionNow = (): RegionNow => store.__maisonRegion ?? DEFAULTS;

export function setRegionNow(r: RegionNow) {
  store.__maisonRegion = { country: r.country, timezone: r.timezone, locale: r.locale, phoneCode: r.phoneCode, taxLabel: r.taxLabel, baseCurrency: r.baseCurrency };
}

/** The store time zone (sync). */
export const storeTz = () => regionNow().timezone;
