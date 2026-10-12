import "server-only";
import { cookies, headers } from "next/headers";
import { isCurrency, type Currency } from "@/config/brand";
import { detectCurrency } from "@/lib/region-shared";
import { getRegion } from "./region";

export type Theme = "nuit" | "ivoire";

export const CURRENCY_COOKIE = "mo_currency";

/** Theme lives in a cookie so the server renders the right palette on first paint (no inline script). */
export async function getTheme(): Promise<Theme> {
  return (await cookies()).get("mo-theme")?.value === "ivoire" ? "ivoire" : "nuit";
}

/**
 * The shopper's display currency: their saved choice (cookie) when the store still offers it, else — on a first
 * visit — the currency of their country (Vercel's x-vercel-ip-country, then Accept-Language; src/proxy.ts saves it
 * in the cookie), else the store's default display currency.
 */
export async function getCurrency(): Promise<Currency> {
  const [jar, h, region] = await Promise.all([cookies(), headers(), getRegion()]);
  const c = jar.get(CURRENCY_COOKIE)?.value;
  if (c && isCurrency(c) && region.enabledCurrencies.includes(c)) return c;
  // No cookie yet, or the proxy's geo guess is a currency the store doesn't offer: same detection, enabled ones only.
  const detected = detectCurrency({ country: h.get("x-vercel-ip-country"), acceptLanguage: h.get("accept-language") }, region.enabledCurrencies);
  return detected ?? region.displayCurrency;
}
