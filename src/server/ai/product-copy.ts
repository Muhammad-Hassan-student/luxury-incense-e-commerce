import "server-only";
import { cache } from "react";
import { db } from "../db";
import { fieldAttrs, type LocalizedMeta } from "@/lib/translations-shared";
import { getLocalized, localizedSeoFields } from "../translations/localize";

/** SEO + Arabic copy saved from the product form (see ProductCopy). Missing table/row → null, never an error. */
export const getProductCopy = cache(async (productId: string) => db.productCopy.findUnique({ where: { productId } }).catch(() => null));

type ProductText = { id: string; name: string; subtitle: string; story: string } & LocalizedMeta;

/**
 * Storefront copy for the shopper's locale (published translations over English, field by field — see
 * src/server/translations; Arabic saved here before translations existed still counts) plus `lang`/`dir` per field.
 * Rows from `getProduct` are already localized and pass straight through.
 */
export async function localizedProductCopy(p: ProductText, locale: string) {
  const l = p._loc || locale === "en" ? p : await getLocalized("product", { id: p.id, name: p.name, subtitle: p.subtitle, story: p.story }, locale);
  const attrs = { name: fieldAttrs(l, "name", locale), subtitle: fieldAttrs(l, "subtitle", locale), story: fieldAttrs(l, "story", locale) };
  return { name: l.name, subtitle: l.subtitle, story: l.story, attrs, lang: attrs.story.lang ?? attrs.subtitle.lang };
}

/** Title/description for <head>: translated SEO copy → saved English SEO copy (English only) → the localized product text. */
export async function productSeo(p: ProductText, locale = "en") {
  const copy = await getProductCopy(p.id);
  if (locale !== "en") {
    const t = await localizedSeoFields(p.id, locale);
    const l = await localizedProductCopy(p, locale);
    return { title: t.seoTitle || l.name, description: t.seoDescription || `${l.subtitle}. ${l.story}`.slice(0, 160) };
  }
  return { title: copy?.seoTitle || p.name, description: copy?.seoDescription || `${p.subtitle}. ${p.story}`.slice(0, 160) };
}
