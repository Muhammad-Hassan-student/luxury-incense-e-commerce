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
  /** Currency all prices are stored in (minor units). */
  baseCurrency: "INR" as const,
  /** Loyalty: points earned per 100 minor-unit-majors spent, and value of 1 point in minor units. */
  loyalty: { earnPer100: 5, pointValue: 100, name: "Embers" },
  freeShippingOver: 250000,
  reservationMinutes: 30,
};

export const currencies = {
  INR: { symbol: "₹", locale: "en-IN", rate: 1 },
  PKR: { symbol: "Rs", locale: "en-PK", rate: 3.35 },
  AED: { symbol: "AED ", locale: "en-AE", rate: 0.044 },
  USD: { symbol: "$", locale: "en-US", rate: 0.012 },
  GBP: { symbol: "£", locale: "en-GB", rate: 0.0095 },
} as const;
export type Currency = keyof typeof currencies;
