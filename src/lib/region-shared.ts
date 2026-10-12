// Region & currency: pure helpers shared by the server, the admin UI, the storefront and tests (no server imports).
// Server loading/saving lives in src/server/region.ts, live exchange rates in src/server/fx.ts.
import { z } from "zod";
import { CURRENCY_CODES, isCurrency, type Currency } from "@/config/brand";

// ─────────────────────────────── Rounding ───────────────────────────────

/**
 * How a converted display price is rounded (base-currency prices are never rounded):
 *   exact  → to the cent (2 dp)          whole → to a whole unit (.00)
 *   charm  → psychological .99 ending     n10 / n50 / n100 → nearest 10 / 50 / 100 units
 */
export const ROUNDINGS = ["exact", "whole", "charm", "n10", "n50", "n100"] as const;
export type Rounding = (typeof ROUNDINGS)[number];
export const ROUNDING_LABEL: Record<Rounding, string> = {
  exact: "Exact (0.01)",
  whole: "Whole units (.00)",
  charm: "Charm pricing (.99)",
  n10: "Nearest 10",
  n50: "Nearest 50",
  n100: "Nearest 100",
};

/** Sensible defaults per currency (the admin can change each). */
export const DEFAULT_ROUNDING: Record<Currency, Rounding> = {
  PKR: "n10", INR: "whole", AED: "whole", SAR: "whole", QAR: "whole", KWD: "exact", OMR: "exact", BHD: "exact",
  USD: "charm", GBP: "charm", EUR: "charm", CAD: "charm", AUD: "charm", SGD: "whole", MYR: "whole", TRY: "whole", CNY: "whole",
};

/** Rounds a major-unit amount by a rule. Zero stays zero; a positive amount never rounds down to zero. */
export function roundMajor(major: number, rule: Rounding): number {
  if (!Number.isFinite(major) || major === 0) return 0;
  const sign = major < 0 ? -1 : 1;
  const m = Math.abs(major);
  const cents = (x: number) => Math.round(x * 100) / 100;
  let out: number;
  switch (rule) {
    case "whole":
      out = Math.max(1, Math.round(m));
      break;
    case "charm":
      out = m < 1 ? cents(m) : cents(Math.ceil(cents(m)) - 0.01);
      break;
    case "n10":
    case "n50":
    case "n100": {
      const step = rule === "n10" ? 10 : rule === "n50" ? 50 : 100;
      out = m < step / 2 ? Math.max(1, Math.round(m)) : Math.round(m / step) * step;
      break;
    }
    default:
      out = cents(m);
  }
  return sign * out;
}

/** Converts integer minor units (hundredths) of one currency into another at `rate`, rounded by `rule`. */
export function convertMinor(minor: number, rate: number, rule: Rounding = "exact"): number {
  if (!minor) return 0;
  return Math.round(roundMajor((minor / 100) * rate, rule) * 100);
}

// ─────────────────────────────── Countries ───────────────────────────────

export type CountryPreset = { name: string; currency: Currency; timezone: string; phone: string; taxLabel: string; taxRate: number; locale: string };

/** Defaults the region form fills in when the owner picks a country. */
export const COUNTRY_PRESETS: Record<string, CountryPreset> = {
  PK: { name: "Pakistan", currency: "PKR", timezone: "Asia/Karachi", phone: "92", taxLabel: "Sales tax", taxRate: 18, locale: "en-PK" },
  IN: { name: "India", currency: "INR", timezone: "Asia/Kolkata", phone: "91", taxLabel: "GST", taxRate: 18, locale: "en-IN" },
  AE: { name: "United Arab Emirates", currency: "AED", timezone: "Asia/Dubai", phone: "971", taxLabel: "VAT", taxRate: 5, locale: "en-AE" },
  SA: { name: "Saudi Arabia", currency: "SAR", timezone: "Asia/Riyadh", phone: "966", taxLabel: "VAT", taxRate: 15, locale: "en-SA" },
  QA: { name: "Qatar", currency: "QAR", timezone: "Asia/Qatar", phone: "974", taxLabel: "Tax", taxRate: 0, locale: "en-QA" },
  KW: { name: "Kuwait", currency: "KWD", timezone: "Asia/Kuwait", phone: "965", taxLabel: "Tax", taxRate: 0, locale: "en-KW" },
  OM: { name: "Oman", currency: "OMR", timezone: "Asia/Muscat", phone: "968", taxLabel: "VAT", taxRate: 5, locale: "en-OM" },
  BH: { name: "Bahrain", currency: "BHD", timezone: "Asia/Bahrain", phone: "973", taxLabel: "VAT", taxRate: 10, locale: "en-BH" },
  US: { name: "United States", currency: "USD", timezone: "America/New_York", phone: "1", taxLabel: "Sales tax", taxRate: 0, locale: "en-US" },
  GB: { name: "United Kingdom", currency: "GBP", timezone: "Europe/London", phone: "44", taxLabel: "VAT", taxRate: 20, locale: "en-GB" },
  DE: { name: "Germany", currency: "EUR", timezone: "Europe/Berlin", phone: "49", taxLabel: "VAT", taxRate: 19, locale: "de-DE" },
  FR: { name: "France", currency: "EUR", timezone: "Europe/Paris", phone: "33", taxLabel: "VAT", taxRate: 20, locale: "fr-FR" },
  CA: { name: "Canada", currency: "CAD", timezone: "America/Toronto", phone: "1", taxLabel: "GST/HST", taxRate: 5, locale: "en-CA" },
  AU: { name: "Australia", currency: "AUD", timezone: "Australia/Sydney", phone: "61", taxLabel: "GST", taxRate: 10, locale: "en-AU" },
  SG: { name: "Singapore", currency: "SGD", timezone: "Asia/Singapore", phone: "65", taxLabel: "GST", taxRate: 9, locale: "en-SG" },
  MY: { name: "Malaysia", currency: "MYR", timezone: "Asia/Kuala_Lumpur", phone: "60", taxLabel: "SST", taxRate: 10, locale: "en-MY" },
  TR: { name: "Türkiye", currency: "TRY", timezone: "Europe/Istanbul", phone: "90", taxLabel: "VAT", taxRate: 20, locale: "tr-TR" },
  CN: { name: "China", currency: "CNY", timezone: "Asia/Shanghai", phone: "86", taxLabel: "VAT", taxRate: 13, locale: "zh-CN" },
};

const EURO_COUNTRIES = ["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"];

/** Country (ISO 3166-1 alpha-2) → its currency when we support it. */
export function currencyForCountry(country: string | null | undefined): Currency | null {
  const c = (country ?? "").toUpperCase();
  if (COUNTRY_PRESETS[c]) return COUNTRY_PRESETS[c].currency;
  if (EURO_COUNTRIES.includes(c)) return "EUR";
  return null;
}

/**
 * First-visit currency: the visitor's country (Vercel's `x-vercel-ip-country`), else the region of their first
 * Accept-Language tag with one (en-PK → PKR), limited to the currencies the store has switched on.
 */
export function detectCurrency(input: { country?: string | null; acceptLanguage?: string | null }, enabled: readonly string[]): Currency | null {
  const ok = (c: Currency | null) => (c && enabled.includes(c) ? c : null);
  const byIp = ok(currencyForCountry(input.country));
  if (byIp) return byIp;
  for (const part of (input.acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0].trim();
    const m = /^[a-z]{2,3}[-_]([A-Za-z]{2})\b/.exec(tag);
    if (m) return ok(currencyForCountry(m[1]));
  }
  return null;
}

// ─────────────────────────────── Region settings ───────────────────────────────

export const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const currencyCode = z.string().trim().toUpperCase().refine(isCurrency, "Unsupported currency") as unknown as z.ZodType<Currency, string>;

/** Setting "region". Every default equals the store's original (India) behaviour. */
export const regionSchema = z
  .object({
    country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Two-letter country code").default("IN"),
    timezone: z.string().trim().refine(isValidTimeZone, "Unknown time zone").default("Asia/Kolkata"),
    baseCurrency: currencyCode.default("INR"),
    displayCurrency: currencyCode.default("INR"),
    enabledCurrencies: z.array(currencyCode).max(CURRENCY_CODES.length).default(["INR", "PKR", "AED", "USD", "GBP"]),
    /** Default calling code (digits) for phone numbers typed without one. */
    phoneCode: z.string().trim().regex(/^\d{1,4}$/, "1–4 digits").default("91"),
    taxLabel: z.string().trim().min(1).max(30).default("GST"),
    /** Date/number formatting locale, e.g. en-IN, en-PK. */
    locale: z
      .string()
      .trim()
      .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "e.g. en-PK")
      .default("en-IN"),
    rounding: z.record(z.string(), z.enum(ROUNDINGS)).default({}),
  })
  .transform((r) => {
    // The base and display currencies are always on.
    const enabled = [...new Set([r.baseCurrency, ...r.enabledCurrencies])];
    return { ...r, enabledCurrencies: enabled, displayCurrency: enabled.includes(r.displayCurrency) ? r.displayCurrency : r.baseCurrency };
  });
export type Region = z.output<typeof regionSchema>;
export type RegionInput = z.input<typeof regionSchema>;
export const DEFAULT_REGION: Region = regionSchema.parse({});

export const roundingFor = (r: Pick<Region, "rounding">, c: string): Rounding => (r.rounding[c] as Rounding | undefined) ?? (isCurrency(c) ? DEFAULT_ROUNDING[c] : "exact");

/** India-only features (GST documents, GSTR-1, Shiprocket, Razorpay's INR checkout). */
export const isIndia = (r: Pick<Region, "country">) => r.country === "IN";

/** Phone placeholder / prefix for the region, e.g. "+92". */
export const phonePrefix = (r: Pick<Region, "phoneCode">) => `+${r.phoneCode}`;

/** All IANA zones the runtime knows (for the searchable select), with the configured one first if missing. */
export function timeZones(current?: string): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  const all = intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : Object.values(COUNTRY_PRESETS).map((p) => p.timezone);
  return current && !all.includes(current) ? [current, ...all] : all;
}

/** "YYYY-MM-DD" of an instant in a time zone. */
export const dayIn = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

// ─────────────────────────────── Fallback rates ───────────────────────────────

/** Used only until the first successful fetch (1 INR = …). Cross rates give any other base. */
export const FALLBACK_INR_RATES: Record<Currency, number> = {
  INR: 1, PKR: 3.35, AED: 0.0437, SAR: 0.0446, QAR: 0.0433, KWD: 0.00365, OMR: 0.00458, BHD: 0.00448,
  USD: 0.0119, GBP: 0.0089, EUR: 0.0102, CAD: 0.0164, AUD: 0.0179, SGD: 0.0153, MYR: 0.0502, TRY: 0.41, CNY: 0.0848,
};

export function fallbackRate(base: Currency, quote: Currency) {
  return FALLBACK_INR_RATES[quote] / FALLBACK_INR_RATES[base];
}
