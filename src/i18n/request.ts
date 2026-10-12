import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { isLocale, LOCALE_COOKIE, type Locale } from "./locales";
import { negotiateLocale } from "./negotiate";

export { locales, type Locale } from "./locales";

/**
 * Cookie-based locale (no URL prefix). The proxy sets the cookie on a first visit from Accept-Language and honours
 * `?lang=xx` links (hreflang targets); until the cookie round-trips we negotiate the same way here.
 * Store chrome is translated; catalogue copy comes from the database (ProductTranslation where present).
 */
export default getRequestConfig(async () => {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  let locale: Locale;
  if (isLocale(value)) locale = value;
  else {
    const h = await headers();
    locale = negotiateLocale(h.get("accept-language"), h.get("x-vercel-ip-country"));
  }
  const messages = (await import(`../../messages/${locale}.json`)).default;
  if (locale === "en") return { locale, messages };
  // Any key not yet translated falls back to English instead of showing its id.
  const en = (await import("../../messages/en.json")).default;
  return { locale, messages: deepMerge(en, messages) };
});

type Tree = { [k: string]: string | Tree };
function deepMerge(base: Tree, over: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = typeof v === "object" && v && typeof b === "object" && b ? deepMerge(b, v) : v;
  }
  return out;
}
