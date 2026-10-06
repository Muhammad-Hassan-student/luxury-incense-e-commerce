import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

export const locales = ["en", "ar"] as const;
export type Locale = (typeof locales)[number];

// Cookie-based locale (no URL prefix). Store chrome is translated; catalog copy stays in English.
export default getRequestConfig(async () => {
  const value = (await cookies()).get("NEXT_LOCALE")?.value;
  const locale: Locale = value === "ar" ? "ar" : "en";
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default };
});
