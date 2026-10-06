import "server-only";
import { cookies } from "next/headers";
import { currencies, type Currency, brand } from "@/config/brand";

export type Theme = "nuit" | "ivoire";

/** Theme lives in a cookie so the server renders the right palette on first paint (no inline script). */
export async function getTheme(): Promise<Theme> {
  return (await cookies()).get("mo-theme")?.value === "ivoire" ? "ivoire" : "nuit";
}

export async function getCurrency(): Promise<Currency> {
  const c = (await cookies()).get("mo_currency")?.value;
  return c && c in currencies ? (c as Currency) : brand.baseCurrency;
}
