import "server-only";
import { cache } from "react";
import { db } from "../db";

/** SEO + Arabic copy saved from the product form (see ProductCopy). Missing table/row → null, never an error. */
export const getProductCopy = cache(async (productId: string) => db.productCopy.findUnique({ where: { productId } }).catch(() => null));

/** Storefront copy for the shopper's locale: Arabic where staff saved a translation, English otherwise. */
export async function localizedProductCopy(p: { id: string; name: string; subtitle: string; story: string }, locale: string) {
  const copy = locale === "ar" ? await getProductCopy(p.id) : null;
  return {
    name: copy?.nameAr || p.name,
    subtitle: copy?.subtitleAr || p.subtitle,
    story: copy?.storyAr || p.story,
    lang: copy?.storyAr || copy?.nameAr ? ("ar" as const) : undefined,
  };
}

/** Title/description for <head>: saved SEO copy first, then the product's own text. */
export async function productSeo(p: { id: string; name: string; subtitle: string; story: string }) {
  const copy = await getProductCopy(p.id);
  return { title: copy?.seoTitle || p.name, description: copy?.seoDescription || `${p.subtitle}. ${p.story}`.slice(0, 160) };
}
