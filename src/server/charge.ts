import "server-only";
import { currencies, isCurrency, type Currency } from "@/config/brand";
import { convertMinor, type Region, type Rounding } from "@/lib/region-shared";
import type { FxTable } from "@/lib/money";

/*
 * Which currency an order is charged in.
 *   • Stripe can charge any currency we list → the shopper's display currency, at exactly the rounded total they saw
 *     (base payable × rate, rounded per currency — the same maths as formatMoney). Rate + rounding are frozen on the
 *     order (Order.chargeCurrency / chargeAmount / fxRate / fxRounding) so emails, invoices and refunds match.
 *   • Razorpay is set up for INR only → offered only while the base currency is INR, and charges the base.
 *   • Cash on delivery, trade invoices, subscription renewals and gift-card-only orders → the base currency.
 * Order amounts (subtotal, items, tax…) always stay in the base currency, so reports and stock maths are unaffected.
 */

export type ChargePlan = { currency: Currency; amount: number; rate: number; rounding: Rounding } | null;

/** Currencies each provider may charge in (null = any we support). */
export const PROVIDER_CURRENCIES: Record<"STRIPE" | "RAZORPAY" | "COD" | "INVOICE", readonly Currency[] | null> = {
  STRIPE: null,
  // Razorpay charges the base currency only (and is offered only while that is INR — razorpayAvailable).
  RAZORPAY: [],
  COD: [],
  INVOICE: [],
};

/** Razorpay only charges INR here: hide it at checkout when the base (= charge) currency isn't INR. */
export const razorpayAvailable = (region: Pick<Region, "baseCurrency">) => region.baseCurrency === "INR";

/**
 * The foreign-currency charge for an order, or null to charge the base currency. `display` is the shopper's
 * currency (cookie); `payable` is in base minor units.
 */
export function planCharge(opts: { provider: string; display: string | null | undefined; payable: number; fx: FxTable; region: Pick<Region, "enabledCurrencies"> }): ChargePlan {
  const { provider, display, payable, fx, region } = opts;
  if (!display || !isCurrency(display) || display === fx.base || payable <= 0) return null;
  if (!region.enabledCurrencies.includes(display)) return null;
  const allowed = PROVIDER_CURRENCIES[provider as keyof typeof PROVIDER_CURRENCIES];
  if (allowed === undefined || (allowed !== null && !allowed.includes(display))) return null;
  const entry = fx.rates[display];
  if (!entry || !(entry.rate > 0)) return null;
  return { currency: display, amount: convertMinor(payable, entry.rate, entry.rounding), rate: entry.rate, rounding: entry.rounding };
}

/** Our hundredths → the provider's minor units (Stripe: thousandths for KWD/BHD/OMR, last digit 0). */
export function toProviderUnits(minor: number, currency: string) {
  const exp = isCurrency(currency) ? currencies[currency].exponent : 2;
  return exp === 3 ? Math.round(minor) * 10 : Math.round(minor);
}

/** A part of a base-currency amount, in the charge currency (proportional, so a full refund is exactly the charge). */
export function chargePortion(baseAmount: number, basePayable: number, chargeAmount: number) {
  if (basePayable <= 0) return 0;
  if (baseAmount >= basePayable) return chargeAmount;
  return Math.round((baseAmount * chargeAmount) / basePayable);
}
