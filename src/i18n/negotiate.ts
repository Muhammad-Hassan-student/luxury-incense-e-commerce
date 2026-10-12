import { defaultLocale, isLocale, type Locale } from "./locales";

export type LanguageRange = { tag: string; q: number };

/** Parses an `Accept-Language` header into ranges, best first. Malformed parts are skipped, `*` is ignored. */
export function parseAcceptLanguage(header: string | null | undefined): LanguageRange[] {
  if (!header) return [];
  const out: (LanguageRange & { i: number })[] = [];
  header.split(",").forEach((part, i) => {
    const [rawTag, ...params] = part.trim().split(";");
    const tag = rawTag?.trim().toLowerCase();
    if (!tag || tag === "*" || !/^[a-z]{1,8}(-[a-z0-9]{1,8})*$/.test(tag)) return;
    let q = 1;
    for (const p of params) {
      if (!/^\s*q\s*=/i.test(p)) continue;
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p);
      q = m ? Number(m[1]) : NaN;
    }
    if (!Number.isFinite(q) || q <= 0 || q > 1) return;
    out.push({ tag, q, i });
  });
  // Stable: equal weights keep the browser's order.
  return out.sort((a, b) => b.q - a.q || a.i - b.i).map(({ tag, q }) => ({ tag, q }));
}

/** Maps one language tag to a store locale: "fr-CA" → fr, "zh-Hans-CN"/"zh-CN"/"zh-SG" → zh. Traditional Chinese is not served. */
export function matchTag(tag: string): Locale | null {
  const parts = tag.toLowerCase().split("-");
  const lang = parts[0]!;
  if (lang === "zh") {
    const rest = parts.slice(1);
    if (rest.includes("hant") || rest.some((p) => p === "tw" || p === "hk" || p === "mo")) return null;
    return "zh";
  }
  return isLocale(lang) ? lang : null;
}

/** Countries whose shoppers are likely to prefer a locale *if their browser also lists it* (tie-breaker only). */
const COUNTRY_HINT: Record<string, Locale> = {
  PK: "ur",
  IN: "hi",
  AE: "ar", SA: "ar", QA: "ar", KW: "ar", BH: "ar", OM: "ar", EG: "ar", JO: "ar",
  FR: "fr", BE: "fr", CH: "fr",
  ES: "es", MX: "es", AR: "es", CO: "es",
  DE: "de", AT: "de",
  TR: "tr",
  CN: "zh", SG: "zh",
};

/**
 * Picks the store locale for a first visit.
 * 1. The highest-weighted browser language we serve wins.
 * 2. Country (e.g. `x-vercel-ip-country`) is only a tie-breaker: if the browser *also* lists the country's language
 *    (weight ≥ 0.5), it is preferred (PK + "en-US,en;q=0.9,ur;q=0.8" → ur; PK + "en-US,en" → en).
 * 3. Otherwise English.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined, country?: string | null): Locale {
  const ranges = parseAcceptLanguage(acceptLanguage);
  const matches: { locale: Locale; q: number }[] = [];
  for (const r of ranges) {
    const locale = matchTag(r.tag);
    if (locale && !matches.some((m) => m.locale === locale)) matches.push({ locale, q: r.q });
  }
  if (!matches.length) return defaultLocale;
  const hint = country ? COUNTRY_HINT[country.toUpperCase()] : undefined;
  if (hint) {
    const hinted = matches.find((m) => m.locale === hint);
    // Browsers send "en-US,en;q=0.9,ur;q=0.8" for an Urdu speaker with an English UI — still a real signal.
    if (hinted && hinted.q >= 0.5) return hinted.locale;
  }
  return matches[0]!.locale;
}
