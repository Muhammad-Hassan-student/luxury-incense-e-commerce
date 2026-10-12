import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { LOCALE_COOKIE } from "@/i18n/locales";
import { FIELD_SPECS, isEmptyValue, isTranslationLocale, type EntityType, type FieldMap, type LocalizedMeta } from "@/lib/translations-shared";

/**
 * Storefront read path. One query per (locale, entity type) loads every PUBLISHED translation, cached across
 * requests under the `content-translations` tag (saves and the translate cron invalidate it), then merged over the
 * English rows field by field: an empty or missing translated field always shows the English.
 */

export const TRANSLATIONS_TAG = "content-translations";

/** The shopper's content locale from the NEXT_LOCALE cookie; English outside a request (scripts, cron). */
export const contentLocale = cache(async (): Promise<string> => {
  try {
    const v = (await cookies()).get(LOCALE_COOKIE)?.value;
    return isTranslationLocale(v) ? v : "en";
  } catch {
    return "en";
  }
});

type PublishedMap = Record<string, FieldMap>;

async function loadPublished(locale: string, type: EntityType): Promise<PublishedMap> {
  const out: PublishedMap = {};
  // Arabic copy saved before translations existed (Admin → product → Write with AI → Arabic) still counts.
  if (type === "product" && locale === "ar") {
    const legacy = await db.productCopy.findMany({ where: { OR: [{ nameAr: { not: null } }, { subtitleAr: { not: null } }, { storyAr: { not: null } }] } }).catch(() => []);
    for (const c of legacy) {
      const f: FieldMap = {};
      if (c.nameAr) f.name = c.nameAr;
      if (c.subtitleAr) f.subtitle = c.subtitleAr;
      if (c.storyAr) f.story = c.storyAr;
      out[c.productId] = f;
    }
  }
  const rows = await db.contentTranslation.findMany({ where: { locale, entityType: type, published: { not: Prisma.DbNull } }, select: { entityId: true, published: true } });
  for (const r of rows) out[r.entityId] = { ...out[r.entityId], ...(r.published as FieldMap) };
  // Product cards only carry the category's slug — index categories by slug as well.
  if (type === "category" && rows.length) {
    const cats = await db.category.findMany({ where: { id: { in: rows.map((r) => r.entityId) } }, select: { id: true, slug: true } });
    for (const c of cats) if (out[c.id]) out[`slug:${c.slug}`] = out[c.id];
  }
  return out;
}

const cachedPublished = unstable_cache(loadPublished, ["content-translations-v1"], { tags: [TRANSLATIONS_TAG], revalidate: 600 });

/** Published translations for one locale and type (per-request memo over the cross-request cache). */
export const publishedTranslations = cache(async (locale: string, type: EntityType): Promise<PublishedMap> => {
  if (!isTranslationLocale(locale)) return {};
  try {
    return await cachedPublished(locale, type);
  } catch {
    // Outside Next (scripts) there is no incremental cache — read directly.
    return loadPublished(locale, type).catch(() => ({}));
  }
});

/** Invalidate the storefront after a translation is published or English changes. Safe outside a request. */
export function invalidateTranslations() {
  try {
    revalidateTag(TRANSLATIONS_TAG, { expire: 0 });
    revalidatePath("/", "layout");
  } catch {
    // not in a request (scripts / tests)
  }
}

/** Overlay translated fields onto an English row. Only keys the row (or spec) knows are applied. */
export function applyFields<T extends object>(row: T, fields: FieldMap | undefined, locale: string, allowExtra: string[] = []): T & LocalizedMeta {
  if (!fields) return row as T & LocalizedMeta;
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  const loc: Record<string, string> = { ...(row as LocalizedMeta)._loc };
  for (const [k, v] of Object.entries(fields)) {
    if (!(k in row) && !allowExtra.includes(k)) continue;
    if (isEmptyValue(v)) continue;
    out[k] = Array.isArray(v) ? v.filter((x) => x.trim()) : v;
    loc[k] = locale;
  }
  if (Object.keys(loc).length) out._loc = loc;
  return out as T & LocalizedMeta;
}

const resolveLocale = async (locale?: string) => locale ?? (await contentLocale());

/** One entity merged with its published translation (per-field English fallback). */
export async function getLocalized<T extends { id: string }>(type: EntityType, entity: T, locale?: string): Promise<T & LocalizedMeta> {
  const l = await resolveLocale(locale);
  if (l === "en") return entity;
  return applyFields(entity, (await publishedTranslations(l, type))[entity.id], l);
}

export async function localizeMany<T extends { id: string }>(type: EntityType, rows: T[], locale?: string): Promise<(T & LocalizedMeta)[]> {
  const l = await resolveLocale(locale);
  if (l === "en" || !rows.length) return rows;
  const map = await publishedTranslations(l, type);
  return rows.map((r) => applyFields(r, map[r.id], l));
}

type CategoryRef = { slug: string; name: string } & Record<string, unknown>;
type ProductLike = { id: string; category?: CategoryRef | null } & Record<string, unknown>;

/** Products (cards or full rows) incl. their nested category name — two cached lookups for the whole list. */
export async function localizeProducts<T extends ProductLike>(rows: T[], locale?: string): Promise<(T & LocalizedMeta)[]> {
  const l = await resolveLocale(locale);
  if (l === "en" || !rows.length) return rows;
  const [products, categories] = await Promise.all([publishedTranslations(l, "product"), publishedTranslations(l, "category")]);
  return rows.map((r) => {
    const p = applyFields(r, products[r.id], l);
    if (r.category) {
      const c = categories[(r.category as { id?: string }).id ?? ""] ?? categories[`slug:${r.category.slug}`];
      if (c) (p as ProductLike).category = applyFields(r.category, c, l);
    }
    return p;
  });
}

export async function localizeProduct<T extends ProductLike>(row: T, locale?: string): Promise<T & LocalizedMeta> {
  return (await localizeProducts([row], locale))[0];
}

/** SEO title/description for a product in the shopper's locale: translated SEO copy → translated name/subtitle/story → English. */
export async function localizedSeoFields(productId: string, locale?: string): Promise<{ seoTitle?: string; seoDescription?: string }> {
  const l = await resolveLocale(locale);
  if (l === "en") return {};
  const f = (await publishedTranslations(l, "product"))[productId];
  return { seoTitle: typeof f?.seoTitle === "string" ? f.seoTitle : undefined, seoDescription: typeof f?.seoDescription === "string" ? f.seoDescription : undefined };
}

/** Translatable keys per type (for callers that want to know what may be localized). */
export const translatableKeys = (type: EntityType) => FIELD_SPECS[type].map((s) => s.key);

/** Product ids whose published translation (name, subtitle, story, notes) contains the search term. */
export async function translatedProductMatches(term: string, locale?: string): Promise<string[]> {
  const l = await resolveLocale(locale);
  if (l === "en") return [];
  const needle = term.toLocaleLowerCase(l);
  const map = await publishedTranslations(l, "product");
  return Object.entries(map)
    .filter(([, f]) => Object.values(f).some((v) => (Array.isArray(v) ? v.join(" ") : v).toLocaleLowerCase(l).includes(needle)))
    .map(([id]) => id);
}
