/** Single place to rename / rebrand the store. */
export const brand = {
  name: "Maison Oud",
  monogram: "MO",
  tagline: "The art of slow fragrance",
  description:
    "Hand-rolled incense, aged oud, bakhoor and candles — composed in small batches for rituals worth slowing down for.",
  email: "concierge@maisonoud.example",
  whatsapp: "+910000000000",
  instagram: "https://instagram.com/",
  /** Loyalty: points earned per 100 minor-unit-majors spent, and value of 1 point in minor units. */
  loyalty: { earnPer100: 5, pointValue: 100, name: "Embers" },
  reservationMinutes: 30,
};

/**
 * Currencies the store can show and (via Stripe) charge in. Metadata only — live rates live in the ExchangeRate table
 * (src/server/fx.ts), and the base currency, enabled list and rounding live in the "region" setting (src/server/region.ts).
 * `exponent` is the provider's minor-unit exponent (Stripe uses 3 for KWD/BHD/OMR); internally every amount is
 * hundredths of the major unit.
 */
export const currencies = {
  PKR: { symbol: "Rs", name: "Pakistani rupee", locale: "en-PK", flag: "🇵🇰", exponent: 2 },
  INR: { symbol: "₹", name: "Indian rupee", locale: "en-IN", flag: "🇮🇳", exponent: 2 },
  AED: { symbol: "AED", name: "UAE dirham", locale: "en-AE", flag: "🇦🇪", exponent: 2 },
  SAR: { symbol: "SAR", name: "Saudi riyal", locale: "en-SA", flag: "🇸🇦", exponent: 2 },
  QAR: { symbol: "QAR", name: "Qatari riyal", locale: "en-QA", flag: "🇶🇦", exponent: 2 },
  KWD: { symbol: "KWD", name: "Kuwaiti dinar", locale: "en-KW", flag: "🇰🇼", exponent: 3 },
  OMR: { symbol: "OMR", name: "Omani rial", locale: "en-OM", flag: "🇴🇲", exponent: 3 },
  BHD: { symbol: "BHD", name: "Bahraini dinar", locale: "en-BH", flag: "🇧🇭", exponent: 3 },
  USD: { symbol: "$", name: "US dollar", locale: "en-US", flag: "🇺🇸", exponent: 2 },
  GBP: { symbol: "£", name: "British pound", locale: "en-GB", flag: "🇬🇧", exponent: 2 },
  EUR: { symbol: "€", name: "Euro", locale: "en-IE", flag: "🇪🇺", exponent: 2 },
  CAD: { symbol: "CA$", name: "Canadian dollar", locale: "en-CA", flag: "🇨🇦", exponent: 2 },
  AUD: { symbol: "A$", name: "Australian dollar", locale: "en-AU", flag: "🇦🇺", exponent: 2 },
  SGD: { symbol: "S$", name: "Singapore dollar", locale: "en-SG", flag: "🇸🇬", exponent: 2 },
  MYR: { symbol: "RM", name: "Malaysian ringgit", locale: "en-MY", flag: "🇲🇾", exponent: 2 },
  TRY: { symbol: "₺", name: "Turkish lira", locale: "tr-TR", flag: "🇹🇷", exponent: 2 },
  CNY: { symbol: "¥", name: "Chinese yuan", locale: "zh-CN", flag: "🇨🇳", exponent: 2 },
} as const;
export type Currency = keyof typeof currencies;
export const CURRENCY_CODES = Object.keys(currencies) as Currency[];
export const isCurrency = (c: unknown): c is Currency => typeof c === "string" && Object.prototype.hasOwnProperty.call(currencies, c);
