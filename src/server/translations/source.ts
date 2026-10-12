import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "../db";
import { FIELD_SPECS, TRANSLATION_LOCALES, isEmptyValue, type EntityType, type FieldMap, type FieldValue } from "@/lib/translations-shared";

/**
 * The English source of every translatable entity, read straight from the catalogue tables, plus a stable hash of
 * it. A translation remembers the hash it was made from, so editing the English marks it stale.
 */

export type SourceEntity = { type: EntityType; id: string; label: string; href: string | null; fields: FieldMap; hash: string };

/** sha256 of the English fields (sorted keys, empty fields dropped), first 16 hex chars. */
export function hashFields(fields: FieldMap) {
  const clean = Object.fromEntries(
    Object.keys(fields)
      .sort()
      .filter((k) => !isEmptyValue(fields[k]))
      .map((k) => [k, Array.isArray(fields[k]) ? (fields[k] as string[]).map((x) => x.trim()) : (fields[k] as string).trim()]),
  );
  return createHash("sha256").update(JSON.stringify(clean)).digest("hex").slice(0, 16);
}

const make = (type: EntityType, id: string, label: string, href: string | null, raw: Record<string, unknown>): SourceEntity => {
  const fields: FieldMap = {};
  for (const spec of FIELD_SPECS[type]) {
    const v = raw[spec.key] as FieldValue | null | undefined;
    if (v != null && !isEmptyValue(v)) fields[spec.key] = v;
  }
  return { type, id, label, href, fields, hash: hashFields(fields) };
};

export type SourceScope = { ids?: string[]; activeOnly?: boolean };

/** English sources for one entity type (optionally only some ids). Ordered for admin lists. */
export async function loadSources(type: EntityType, scope: SourceScope = {}): Promise<SourceEntity[]> {
  const idFilter = scope.ids ? { id: { in: scope.ids } } : {};
  switch (type) {
    case "product": {
      const rows = await db.product.findMany({
        where: { ...idFilter, ...(scope.activeOnly && { isActive: true }) },
        orderBy: { name: "asc" },
        select: { id: true, slug: true, name: true, subtitle: true, story: true, topNotes: true, heartNotes: true, baseNotes: true },
      });
      // Explicit SEO copy (Admin → product → Write with AI) is translated too; otherwise SEO is derived from the
      // localized subtitle and story, so there is nothing extra to translate.
      const copies = await db.productCopy
        .findMany({ where: { productId: { in: rows.map((r) => r.id) } }, select: { productId: true, seoTitle: true, seoDescription: true } })
        .catch(() => []);
      const seo = new Map(copies.map((c) => [c.productId, c]));
      return rows.map((p) => make("product", p.id, p.name, `/product/${p.slug}`, { ...p, seoTitle: seo.get(p.id)?.seoTitle, seoDescription: seo.get(p.id)?.seoDescription }));
    }
    case "category": {
      const rows = await db.category.findMany({ where: idFilter, orderBy: { position: "asc" }, select: { id: true, slug: true, name: true, tagline: true, description: true } });
      return rows.map((c) => make("category", c.id, c.name, `/shop/${c.slug}`, c));
    }
    case "collection": {
      const rows = await db.collection.findMany({ where: idFilter, orderBy: { position: "asc" }, select: { id: true, slug: true, name: true, description: true } });
      return rows.map((c) => make("collection", c.id, c.name, `/collections/${c.slug}`, c));
    }
    case "journal": {
      const rows = await db.journalPost.findMany({
        where: { ...idFilter, ...(scope.activeOnly && { published: true }) },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        select: { id: true, slug: true, title: true, excerpt: true, body: true, published: true },
      });
      return rows.map((j) => make("journal", j.id, j.title, j.published ? `/journal/${j.slug}` : null, j));
    }
  }
}

export async function loadSource(type: EntityType, id: string) {
  return (await loadSources(type, { ids: [id] }))[0] ?? null;
}

// ─────────────────────────────── Settings ───────────────────────────────

export const SETTINGS_KEY = "translations:settings";

export const translationSettingsSchema = z.object({
  /** Queue and translate automatically (English edits + the daily cron). Off = only the admin buttons. */
  auto: z.boolean().default(true),
  /** Locales that get catalogue translations. */
  locales: z.array(z.enum(TRANSLATION_LOCALES as [string, ...string[]])).default([...TRANSLATION_LOCALES]),
  /** Publish AI translations straight away (otherwise they wait as AI drafts for review). Never for a failed glossary check. */
  autoPublish: z.boolean().default(false),
  /** Monthly translation budget in USD on top of the global AI cap; 0 = only the global cap applies. */
  monthlyCapUsd: z.coerce.number().min(0).max(10_000).default(10),
  /** Most (entity, locale) pairs one run translates — keeps the daily cron short. */
  batchSize: z.coerce.number().int().min(1).max(500).default(80),
});
export type TranslationSettings = z.infer<typeof translationSettingsSchema>;

export async function getTranslationSettings(): Promise<TranslationSettings> {
  const row = await db.setting.findUnique({ where: { key: SETTINGS_KEY } }).catch(() => null);
  const parsed = translationSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : translationSettingsSchema.parse({});
}

export async function saveTranslationSettings(next: z.input<typeof translationSettingsSchema>) {
  const value = translationSettingsSchema.parse(next);
  await db.setting.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, value }, update: { value } });
  return value;
}
