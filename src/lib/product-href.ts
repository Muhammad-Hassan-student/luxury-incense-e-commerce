/** Products with their own purchase flow live outside /product/[slug]. */
export function productHref(slug: string) {
  if (slug === "build-your-coffret") return "/gifts/coffret";
  if (slug === "gift-card") return "/gifts/gift-card";
  return `/product/${slug}`;
}

/** Products that can't be quick-added from a card (they need choices first). */
export const needsConfiguration = (slug: string) => slug === "build-your-coffret" || slug === "gift-card";
