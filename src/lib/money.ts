import { brand, currencies, type Currency } from "@/config/brand";

/** Format integer minor units of the base currency, converted to a display currency. */
export function formatMoney(minor: number, currency: Currency = brand.baseCurrency) {
  const c = currencies[currency];
  const major = (minor / 100) * c.rate;
  return new Intl.NumberFormat(c.locale, {
    style: "currency",
    currency,
    maximumFractionDigits: major >= 1000 ? 0 : 2,
    minimumFractionDigits: 0,
  }).format(major);
}
