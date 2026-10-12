import "server-only";
import { getLocale } from "next-intl/server";
import { intlLocale, localeInfo } from "./locales";

/** `Intl` tag of the request's locale, for formatting dates/numbers in server components and actions. */
export async function getIntlLocale() {
  return intlLocale(await getLocale());
}

export async function getLocaleInfo() {
  return localeInfo(await getLocale());
}
