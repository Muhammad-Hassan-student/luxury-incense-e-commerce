/**
 * Translated catalogue content — client-safe types and field specs (no server imports).
 * Server side: src/server/translations/**. English is the source of truth; every other locale is a translation
 * layered over it field by field, so a missing or unpublished field always falls back to English.
 */
import { LOCALES, isRtl, type Locale } from "@/i18n/locales";

export const ENTITY_TYPES = ["product", "category", "collection", "journal"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const isEntityType = (v: unknown): v is EntityType => typeof v === "string" && (ENTITY_TYPES as readonly string[]).includes(v);

export type FieldSpec = {
  key: string;
  label: string;
  /** Long text gets a textarea. */
  long?: boolean;
  /** A list of short strings (scent notes). */
  list?: boolean;
  /** Markdown body (journal). */
  markdown?: boolean;
  /** Never sent to the AI — product names stay as written unless staff localise them by hand. */
  humanOnly?: boolean;
  max: number;
};

export const FIELD_SPECS: Record<EntityType, FieldSpec[]> = {
  product: [
    { key: "name", label: "Name", humanOnly: true, max: 120 },
    { key: "subtitle", label: "Subtitle", max: 300 },
    { key: "story", label: "Story", long: true, max: 10_000 },
    { key: "topNotes", label: "Top notes", list: true, max: 60 },
    { key: "heartNotes", label: "Heart notes", list: true, max: 60 },
    { key: "baseNotes", label: "Base notes", list: true, max: 60 },
    { key: "seoTitle", label: "SEO title", max: 90 },
    { key: "seoDescription", label: "SEO description", long: true, max: 220 },
  ],
  category: [
    { key: "name", label: "Name", max: 80 },
    { key: "tagline", label: "Tagline", max: 200 },
    { key: "description", label: "Description", long: true, max: 2000 },
  ],
  collection: [
    { key: "name", label: "Name", max: 120 },
    { key: "description", label: "Description", long: true, max: 2000 },
  ],
  journal: [
    { key: "title", label: "Title", max: 200 },
    { key: "excerpt", label: "Excerpt", long: true, max: 400 },
    { key: "body", label: "Body (markdown)", long: true, markdown: true, max: 30_000 },
  ],
};

export const ENTITY_LABELS: Record<EntityType, { one: string; many: string; permission: "catalog.edit" | "content.edit" }> = {
  product: { one: "Product", many: "Products", permission: "catalog.edit" },
  category: { one: "Category", many: "Categories", permission: "catalog.edit" },
  collection: { one: "Collection", many: "Collections", permission: "catalog.edit" },
  journal: { one: "Journal post", many: "Journal", permission: "content.edit" },
};

export type FieldValue = string | string[];
export type FieldMap = Record<string, FieldValue>;

/** Every locale except English can carry translations. */
export const TRANSLATION_LOCALES = LOCALES.filter((l) => l.code !== "en").map((l) => l.code) as Exclude<Locale, "en">[];
export type TranslationLocale = (typeof TRANSLATION_LOCALES)[number];
export const isTranslationLocale = (v: unknown): v is TranslationLocale => typeof v === "string" && (TRANSLATION_LOCALES as string[]).includes(v);

/** Badge shown in the admin for one (entity, locale). */
export type TranslationState = "published" | "ai_draft" | "draft" | "stale" | "queued" | "needs_translation" | "missing";

export const STATE_LABELS: Record<TranslationState, string> = {
  published: "Published",
  ai_draft: "AI draft",
  draft: "Draft",
  stale: "Stale",
  queued: "Queued",
  needs_translation: "Needs translation",
  missing: "Missing",
};

/** Badge tone and matrix dot per state (admin). */
export const STATE_TONE: Record<TranslationState, "gold" | "ember" | "muted"> = {
  published: "gold",
  ai_draft: "muted",
  draft: "muted",
  stale: "ember",
  queued: "muted",
  needs_translation: "ember",
  missing: "muted",
};

export const STATE_DOT: Record<TranslationState, string> = {
  published: "bg-gold",
  ai_draft: "bg-fg/60",
  draft: "bg-fg/60",
  stale: "bg-ember",
  queued: "bg-line-strong",
  needs_translation: "bg-ember",
  missing: "border border-line-strong",
};

/** Which locale each localized field actually came from (absent = English). */
export type LocalizedMeta = { _loc?: Record<string, string> };

/**
 * `lang` / `dir` for one field — spread onto the element that renders it. A translated field carries its locale's
 * language and direction; an English fallback on a non-English page is marked `lang="en"` only, so it keeps the
 * page's alignment (Latin runs inside right-to-left pages are ordered by the bidi algorithm).
 */
export function fieldAttrs(obj: LocalizedMeta | null | undefined, field: string, pageLocale?: string): { lang?: string; dir?: "rtl" | "ltr" } {
  const loc = obj?._loc?.[field];
  if (loc) return { lang: loc, dir: isRtl(loc) ? "rtl" : "ltr" };
  return pageLocale && pageLocale !== "en" ? { lang: "en" } : {};
}

export const isEmptyValue = (v: FieldValue | undefined | null) => (Array.isArray(v) ? v.filter((x) => x.trim()).length === 0 : !v || !v.trim());
