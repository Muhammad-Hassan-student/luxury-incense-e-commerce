/**
 * Every storefront language in one place. Client-safe (no server imports).
 *
 * The locale lives in the `NEXT_LOCALE` cookie — there are no URL prefixes, so every route keeps its address in
 * every language. First visits are negotiated from `Accept-Language` in src/proxy.ts (see ./negotiate.ts).
 */
export type FontKey = "latin" | "arabic" | "nastaliq" | "devanagari" | "sc";

export type LocaleInfo = {
  code: string;
  /** Name in its own language — what the switcher shows. */
  native: string;
  /** English name, for admin screens and aria descriptions. */
  english: string;
  dir: "ltr" | "rtl";
  /** BCP 47 tag handed to `Intl` (dates, numbers, plurals). */
  intl: string;
  /** Which script font the root layout switches on (see src/app/layout.tsx). */
  font: FontKey;
  /** hreflang value used in alternate links. */
  hreflang: string;
};

export const LOCALES = [
  { code: "en", native: "English", english: "English", dir: "ltr", intl: "en-IN", font: "latin", hreflang: "en" },
  { code: "ur", native: "اردو", english: "Urdu", dir: "rtl", intl: "ur-PK", font: "nastaliq", hreflang: "ur" },
  { code: "ar", native: "العربية", english: "Arabic", dir: "rtl", intl: "ar", font: "arabic", hreflang: "ar" },
  { code: "hi", native: "हिन्दी", english: "Hindi", dir: "ltr", intl: "hi-IN", font: "devanagari", hreflang: "hi" },
  { code: "fr", native: "Français", english: "French", dir: "ltr", intl: "fr-FR", font: "latin", hreflang: "fr" },
  { code: "es", native: "Español", english: "Spanish", dir: "ltr", intl: "es-ES", font: "latin", hreflang: "es" },
  { code: "de", native: "Deutsch", english: "German", dir: "ltr", intl: "de-DE", font: "latin", hreflang: "de" },
  { code: "tr", native: "Türkçe", english: "Turkish", dir: "ltr", intl: "tr-TR", font: "latin", hreflang: "tr" },
  { code: "zh", native: "简体中文", english: "Chinese (Simplified)", dir: "ltr", intl: "zh-CN", font: "sc", hreflang: "zh-Hans" },
] as const satisfies readonly LocaleInfo[];

export type Locale = (typeof LOCALES)[number]["code"];

export const locales = LOCALES.map((l) => l.code) as Locale[];
export const defaultLocale: Locale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";
/** One year — the choice (or first-visit guess) is remembered. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as string[]).includes(value);
}

export function localeInfo(code: string | undefined | null): LocaleInfo {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0];
}

export const isRtl = (code: string | undefined | null) => localeInfo(code).dir === "rtl";

/** The `Intl` tag for a locale code ("en" → "en-IN"); unknown codes fall back to English. */
export const intlLocale = (code: string | undefined | null) => localeInfo(code).intl;
