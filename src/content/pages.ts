import { brand } from "@/config/brand";

export type PageKey = "about" | "shippingReturns" | "privacy" | "terms";

/**
 * Static content pages, by URL slug. The copy lives in the `pages` messages namespace (messages/<locale>.json,
 * under `pages.<key>`: eyebrow, title, description and a Markdown body rendered with the journal's subset).
 */
export const pages: Record<string, { key: PageKey }> = {
  about: { key: "about" },
  "shipping-returns": { key: "shippingReturns" },
  privacy: { key: "privacy" },
  terms: { key: "terms" },
};

/** Values the page copy interpolates ({brand}, {email}, {loyalty}). */
export const pageValues = { brand: brand.name, email: brand.email, loyalty: brand.loyalty.name };
