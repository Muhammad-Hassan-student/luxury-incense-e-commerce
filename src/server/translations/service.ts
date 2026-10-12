import "server-only";
import { z } from "zod";
import type { ContentTranslation } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import type { Permission } from "@/lib/permissions";
import {
  ENTITY_LABELS,
  ENTITY_TYPES,
  FIELD_SPECS,
  TRANSLATION_LOCALES,
  isEmptyValue,
  isTranslationLocale,
  type EntityType,
  type FieldMap,
  type TranslationState,
} from "@/lib/translations-shared";
import { db } from "../db";
import { monthStart, resolveAiMode, type AiMode } from "../ai/config";
import { describeAiError, glossaryProblems, itemSize, PROTECTED_TERMS, translateBatch, type TranslateItem } from "./ai";
import { invalidateTranslations } from "./localize";
import { getTranslationSettings, loadSource, loadSources, type SourceEntity, type TranslationSettings } from "./source";

/**
 * Translation queue, AI runs and the admin operations. English stays the source of truth:
 * - an English edit (or the daily scan) queues every enabled locale whose translation is missing or stale;
 * - the queue is worked in small batches by the `translate` cron and the admin buttons, within the AI spend caps;
 * - AI output lands as an AI draft (or straight to published when auto-publish is on and the glossary check passes);
 * - staff can edit and publish any locale. AI never overwrites a translation a person wrote unless asked to.
 */

export type Actor = { id: string; permissions: readonly string[] };

export class TranslationDenied extends Error {
  constructor(public permission: Permission) {
    super(`Missing permission: ${permission}`);
  }
}

const permissionFor = (type: EntityType): Permission => ENTITY_LABELS[type].permission;
const canEdit = (actor: Actor, type: EntityType) => actor.permissions.includes(permissionFor(type));
function assertCan(actor: Actor, type: EntityType) {
  if (!canEdit(actor, type)) throw new TranslationDenied(permissionFor(type));
}

const asMap = (v: unknown): FieldMap => (v && typeof v === "object" && !Array.isArray(v) ? (v as FieldMap) : {});
const hasContent = (m: FieldMap) => Object.values(m).some((v) => !isEmptyValue(v));

/** Fields the AI translates for a source (drops human-only fields such as product names). */
export function aiFields(type: EntityType, fields: FieldMap): FieldMap {
  const human = new Set(FIELD_SPECS[type].filter((s) => s.humanOnly).map((s) => s.key));
  return Object.fromEntries(Object.entries(fields).filter(([k]) => !human.has(k)));
}

export const NOT_LIVE_REASON: Record<Exclude<AiMode, { live: true }>["reason"], string> = {
  no_key: "Needs translation — no Anthropic key yet (English is shown meanwhile).",
  disabled: "Needs translation — Claude is switched off in Admin → Integrations.",
  cap: "Needs translation — this month's AI budget is used up.",
};
const TRANSLATION_CAP_REASON = "Needs translation — this month's translation budget is used up.";

// ─────────────────────────────── State ───────────────────────────────

type Row = Pick<ContentTranslation, "status" | "source" | "fields" | "published" | "sourceHash" | "queuedAt" | "lastError">;

export function stateOf(row: Row | undefined | null, currentHash: string): TranslationState {
  if (!row) return "missing";
  const work = hasContent(asMap(row.fields));
  if (row.queuedAt && (!work || row.lastError)) return row.lastError ? "needs_translation" : "queued";
  if (!work && !row.published) return row.lastError ? "needs_translation" : "missing";
  if (work && row.sourceHash && row.sourceHash !== currentHash) return "stale";
  if (row.status === "published") return "published";
  if (row.queuedAt) return "queued";
  return row.source === "ai" ? "ai_draft" : "draft";
}

// ─────────────────────────────── Queue ───────────────────────────────

/**
 * Queue (entity × locales) when the translation is missing or made from older English. Translations a person wrote
 * are only re-queued with `force` (they show as stale instead). Already-queued rows are left alone (idempotent).
 */
export async function queueSource(src: SourceEntity, locales: readonly string[], opts: { force?: boolean } = {}) {
  if (!hasContent(aiFields(src.type, src.fields))) return 0;
  const rows = await db.contentTranslation.findMany({ where: { entityType: src.type, entityId: src.id, locale: { in: [...locales] } } });
  const now = new Date();
  let queued = 0;
  for (const locale of locales) {
    const row = rows.find((r) => r.locale === locale);
    if (row?.queuedAt) continue;
    if (row && !opts.force) {
      if (row.sourceHash === src.hash && hasContent(asMap(row.fields))) continue; // up to date
      if (row.source === "human" && hasContent(asMap(row.fields))) continue; // a person's work: flagged stale, not overwritten
    }
    if (row) await db.contentTranslation.update({ where: { id: row.id }, data: { queuedAt: now, attempts: 0, lastError: null } });
    else await db.contentTranslation.create({ data: { entityType: src.type, entityId: src.id, locale, queuedAt: now } }).catch(() => null); // concurrent create → already queued
    queued++;
  }
  return queued;
}

/** Called after English content is created or changed. Never throws (a save must not fail on translations). */
export async function onEnglishChanged(type: EntityType, id: string) {
  try {
    const settings = await getTranslationSettings();
    if (!settings.auto) return 0;
    const src = await loadSource(type, id);
    return src ? await queueSource(src, settings.locales) : 0;
  } catch (e) {
    console.error("[translations] queue failed", e instanceof Error ? e.message : e);
    return 0;
  }
}

/** Queue everything missing or stale (live products, published posts, all categories and collections). */
export async function scanAndQueue(opts: { locales?: readonly string[]; types?: readonly EntityType[] } = {}) {
  const settings = await getTranslationSettings();
  const locales = opts.locales ?? settings.locales;
  let queued = 0;
  for (const type of opts.types ?? ENTITY_TYPES) {
    for (const src of await loadSources(type, { activeOnly: true })) queued += await queueSource(src, locales);
  }
  return queued;
}

// ─────────────────────────────── Worker ───────────────────────────────

export async function translationSpendMicros(now = new Date()) {
  const agg = await db.aiUsage.aggregate({ where: { feature: "translation", mock: false, createdAt: { gte: monthStart(now) } }, _sum: { costMicros: true } });
  return agg._sum.costMicros ?? 0;
}

async function budgetBlock(settings: TranslationSettings): Promise<string | null> {
  const mode = await resolveAiMode();
  if (!mode.live) return NOT_LIVE_REASON[mode.reason];
  const cap = Math.round(settings.monthlyCapUsd * 1_000_000);
  if (cap > 0 && (await translationSpendMicros()) >= cap) return TRANSLATION_CAP_REASON;
  return null;
}

export type RunResult = {
  translated: number;
  published: number;
  flagged: number;
  failed: number;
  pending: number;
  costMicros: number;
  /** Set when nothing could run (no key, budget, switched off). */
  skipped?: string;
};

const LOCK_MS = 5 * 60_000;
const MAX_ITEMS_PER_CALL = 8;
const MAX_CHARS_PER_CALL = 6_000;
const MAX_ATTEMPTS = 3;
const CONCURRENCY = 3;

/**
 * Works the queue: claims up to `limit` rows, groups them by locale into a few packed calls, writes the results.
 * Stops early when the AI spend cap or the translation budget is reached; unprocessed rows stay queued.
 * Idempotent: rows are claimed (lockedUntil) and dequeued once written, so overlapping or repeated runs never
 * translate the same row twice.
 */
export async function runTranslationQueue(opts: { actorId?: string | null; limit?: number; timeBudgetMs?: number; only?: { type: EntityType; id: string; locales?: string[] } } = {}): Promise<RunResult> {
  const settings = await getTranslationSettings();
  const started = Date.now();
  const timeBudget = opts.timeBudgetMs ?? 45_000;
  const now = new Date();
  const where: Prisma.ContentTranslationWhereInput = {
    queuedAt: { not: null },
    OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    ...(opts.only ? { entityType: opts.only.type, entityId: opts.only.id, ...(opts.only.locales && { locale: { in: opts.only.locales } }) } : { locale: { in: settings.locales } }),
  };
  const result: RunResult = { translated: 0, published: 0, flagged: 0, failed: 0, pending: 0, costMicros: 0 };
  const countPending = () => db.contentTranslation.count({ where: { queuedAt: { not: null }, ...(opts.only && { entityType: opts.only.type, entityId: opts.only.id }) } });

  const candidates = await db.contentTranslation.findMany({ where, orderBy: { queuedAt: "asc" }, take: opts.limit ?? settings.batchSize });
  if (!candidates.length) return { ...result, pending: await countPending() };

  const blocked = await budgetBlock(settings);
  if (blocked) {
    // No key / over budget: keep English, mark the rows so the admin sees "Needs translation". They stay queued.
    await db.contentTranslation.updateMany({ where: { id: { in: candidates.map((c) => c.id) } }, data: { lastError: blocked } });
    return { ...result, skipped: blocked, pending: await countPending() };
  }

  // Claim (one row at a time so two runs never take the same row).
  const lockedUntil = new Date(Date.now() + LOCK_MS);
  const claimed: ContentTranslation[] = [];
  for (const c of candidates) {
    const r = await db.contentTranslation.updateMany({ where: { id: c.id, queuedAt: { not: null }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { lockedUntil } });
    if (r.count === 1) claimed.push(c);
  }

  // English sources for the claimed rows.
  const sources = new Map<string, SourceEntity>();
  for (const type of ENTITY_TYPES) {
    const ids = [...new Set(claimed.filter((c) => c.entityType === type).map((c) => c.entityId))];
    if (ids.length) for (const s of await loadSources(type, { ids })) sources.set(`${type}:${s.id}`, s);
  }
  const work: { row: ContentTranslation; src: SourceEntity; item: TranslateItem }[] = [];
  for (const row of claimed) {
    const src = sources.get(`${row.entityType}:${row.entityId}`);
    if (!src) {
      await db.contentTranslation.delete({ where: { id: row.id } }).catch(() => null); // entity is gone
      continue;
    }
    const fields = aiFields(src.type, src.fields);
    if (!hasContent(fields)) {
      await db.contentTranslation.update({ where: { id: row.id }, data: { queuedAt: null, lockedUntil: null } });
      continue;
    }
    work.push({ row, src, item: { key: row.id, type: src.type, fields } });
  }

  // Product names are proper nouns: kept as written in every language (and checked afterwards).
  const names = (await db.product.findMany({ select: { name: true } })).map((p) => p.name);
  const termsFor = (items: TranslateItem[]) => {
    const text = items.map((i) => JSON.stringify(i.fields)).join(" ");
    return [...new Set([...PROTECTED_TERMS, ...names])].filter((t) => text.includes(t));
  };

  // Pack per locale.
  const packs: { locale: string; jobs: typeof work }[] = [];
  for (const locale of [...new Set(work.map((w) => w.row.locale))]) {
    let cur: typeof work = [];
    let size = 0;
    for (const w of work.filter((x) => x.row.locale === locale)) {
      const s = itemSize(w.item);
      if (cur.length && (cur.length >= MAX_ITEMS_PER_CALL || size + s > MAX_CHARS_PER_CALL)) {
        packs.push({ locale, jobs: cur });
        cur = [];
        size = 0;
      }
      cur.push(w);
      size += s;
    }
    if (cur.length) packs.push({ locale, jobs: cur });
  }

  const release = (jobs: typeof work, lastError?: string) =>
    db.contentTranslation.updateMany({ where: { id: { in: jobs.map((j) => j.row.id) } }, data: { lockedUntil: null, ...(lastError && { lastError }) } });

  let stop: string | null = null;
  const runPack = async (pack: (typeof packs)[number]) => {
    if (stop || Date.now() - started > timeBudget) return release(pack.jobs);
    const block = await budgetBlock(settings);
    if (block) {
      stop = block;
      return release(pack.jobs, block);
    }
    const mode = await resolveAiMode();
    if (!mode.live) return release(pack.jobs);
    const items = pack.jobs.map((j) => j.item);
    const terms = termsFor(items);
    try {
      const out = await translateBatch({ apiKey: mode.apiKey, model: mode.models.translate, locale: pack.locale, items, protectedTerms: terms, actorId: opts.actorId });
      result.costMicros += out.costMicros;
      for (const j of pack.jobs) {
        const t = out.translations.get(j.row.id);
        if (!t || !hasContent(t)) {
          await failJob(j.row, "Claude returned no translation for this item");
          result.failed++;
          continue;
        }
        const missing = Object.keys(j.item.fields).filter((k) => !(k in t));
        const problems = [...glossaryProblems(j.item.fields, t, terms), ...missing.map((k) => `field “${k}”`)];
        const publish = settings.autoPublish && problems.length === 0;
        // Human-only fields (product name) already in the working copy are kept.
        const fields: FieldMap = { ...pickHumanOnly(j.src.type, asMap(j.row.fields)), ...t };
        const stamp = new Date();
        await db.contentTranslation.update({
          where: { id: j.row.id },
          data: {
            fields,
            source: "ai",
            status: publish ? "published" : "draft",
            sourceHash: j.src.hash,
            sourceText: j.src.fields,
            model: out.model,
            translatedAt: stamp,
            translatedById: opts.actorId ?? null,
            queuedAt: null,
            lockedUntil: null,
            attempts: 0,
            lastError: problems.length ? `Check before publishing: ${problems.slice(0, 6).join(", ")} missing in the translation.` : null,
            ...(publish && { published: fields, publishedHash: j.src.hash, publishedAt: stamp, publishedById: opts.actorId ?? null }),
          },
        });
        result.translated++;
        if (publish) result.published++;
        if (problems.length) result.flagged++;
      }
    } catch (e) {
      const msg = describeAiError(e);
      console.error("[translations] batch failed", pack.locale, msg);
      for (const j of pack.jobs) await failJob(j.row, msg);
      result.failed += pack.jobs.length;
    }
  };

  // A few calls at a time (different locales run in parallel).
  for (let i = 0; i < packs.length; i += CONCURRENCY) await Promise.all(packs.slice(i, i + CONCURRENCY).map(runPack));

  if (stop) result.skipped = stop;
  if (result.published) invalidateTranslations();
  result.pending = await countPending();
  return result;
}

const pickHumanOnly = (type: EntityType, fields: FieldMap): FieldMap => {
  const keys = FIELD_SPECS[type].filter((s) => s.humanOnly).map((s) => s.key);
  return Object.fromEntries(Object.entries(fields).filter(([k, v]) => keys.includes(k) && !isEmptyValue(v)));
};

async function failJob(row: ContentTranslation, message: string) {
  const attempts = row.attempts + 1;
  await db.contentTranslation.update({
    where: { id: row.id },
    // After a few failures it leaves the queue (no endless spend); "Translate with AI" re-queues it.
    data: { attempts, lastError: message, lockedUntil: null, ...(attempts >= MAX_ATTEMPTS && { queuedAt: null }) },
  });
}

// ─────────────────────────────── Admin operations ───────────────────────────────

const fieldValue = z.union([z.string().max(30_000), z.array(z.string().trim().max(120)).max(30)]);
export const saveTranslationSchema = z.object({
  type: z.enum(ENTITY_TYPES),
  id: z.string().min(1).max(64),
  locale: z.enum(TRANSLATION_LOCALES as [string, ...string[]]),
  fields: z.record(z.string().max(40), fieldValue),
  publish: z.boolean().default(false),
});

function cleanFields(type: EntityType, input: Record<string, string | string[]>): FieldMap {
  const out: FieldMap = {};
  for (const spec of FIELD_SPECS[type]) {
    const v = input[spec.key];
    if (v == null) continue;
    if (spec.list) {
      const list = (Array.isArray(v) ? v : v.split(",")).map((x) => x.trim().slice(0, spec.max)).filter(Boolean);
      if (list.length) out[spec.key] = list;
    } else {
      const s = (Array.isArray(v) ? v.join(", ") : v).trim().slice(0, spec.max);
      if (s) out[spec.key] = s;
    }
  }
  return out;
}

/** Staff edit of one locale (optionally publishing it). Edited text counts as a person's work (source "human"). */
export async function saveTranslation(actor: Actor, input: z.input<typeof saveTranslationSchema>) {
  const v = saveTranslationSchema.parse(input);
  assertCan(actor, v.type);
  const src = await loadSource(v.type, v.id);
  if (!src) throw new Error("That item no longer exists.");
  const fields = cleanFields(v.type, v.fields);
  const existing = await db.contentTranslation.findUnique({ where: { entityType_entityId_locale: { entityType: v.type, entityId: v.id, locale: v.locale } } });
  const changed = JSON.stringify(fields) !== JSON.stringify(asMap(existing?.fields));
  const stamp = new Date();
  const data = {
    fields,
    // Unchanged AI text published as-is stays "ai"; anything edited is a person's translation.
    source: changed || !existing ? "human" : existing.source,
    sourceHash: src.hash,
    sourceText: src.fields,
    queuedAt: null,
    lockedUntil: null,
    lastError: null,
    attempts: 0,
    ...(changed && { translatedAt: stamp, translatedById: actor.id }),
    ...(v.publish
      ? { status: "published", published: hasContent(fields) ? fields : Prisma.DbNull, publishedHash: src.hash, publishedAt: stamp, publishedById: actor.id }
      : { status: existing?.status === "published" && !changed ? "published" : "draft" }),
  };
  const row = existing
    ? await db.contentTranslation.update({ where: { id: existing.id }, data })
    : await db.contentTranslation.create({ data: { entityType: v.type, entityId: v.id, locale: v.locale, ...data } });
  if (v.publish) invalidateTranslations();
  return row;
}

const refSchema = z.object({ type: z.enum(ENTITY_TYPES), id: z.string().min(1).max(64), locale: z.enum(TRANSLATION_LOCALES as [string, ...string[]]) });

/** Publish the working copy as it is. */
export async function publishTranslation(actor: Actor, input: z.input<typeof refSchema>) {
  const v = refSchema.parse(input);
  assertCan(actor, v.type);
  const row = await db.contentTranslation.findUnique({ where: { entityType_entityId_locale: { entityType: v.type, entityId: v.id, locale: v.locale } } });
  if (!row || !hasContent(asMap(row.fields))) throw new Error("Nothing to publish yet — translate or write it first.");
  const stamp = new Date();
  const out = await db.contentTranslation.update({
    where: { id: row.id },
    data: { status: "published", published: asMap(row.fields), publishedHash: row.sourceHash, publishedAt: stamp, publishedById: actor.id, lastError: null },
  });
  invalidateTranslations();
  return out;
}

/** Take a locale off the store (English shows again); the working copy is kept as a draft. */
export async function unpublishTranslation(actor: Actor, input: z.input<typeof refSchema>) {
  const v = refSchema.parse(input);
  assertCan(actor, v.type);
  const out = await db.contentTranslation.updateMany({
    where: { entityType: v.type, entityId: v.id, locale: v.locale },
    data: { status: "draft", published: Prisma.DbNull, publishedHash: null, publishedAt: null },
  });
  invalidateTranslations();
  return out.count;
}

const translateNowSchema = z.object({ type: z.enum(ENTITY_TYPES), id: z.string().min(1).max(64), locales: z.array(z.enum(TRANSLATION_LOCALES as [string, ...string[]])).min(1).max(20) });

/** "Translate with AI" for one item: re-queues the chosen locales (even a person's version — it is explicit) and runs them now. */
export async function translateNow(actor: Actor, input: z.input<typeof translateNowSchema>): Promise<RunResult> {
  const v = translateNowSchema.parse(input);
  assertCan(actor, v.type);
  const src = await loadSource(v.type, v.id);
  if (!src) throw new Error("That item no longer exists.");
  await queueSource(src, v.locales, { force: true });
  return runTranslationQueue({ actorId: actor.id, only: { type: v.type, id: v.id, locales: v.locales }, limit: v.locales.length, timeBudgetMs: 120_000 });
}

/** "Translate missing": scan for missing/stale content the actor may edit, then work a batch of the queue. */
export async function translateMissing(actor: Actor, opts: { locales?: string[] } = {}) {
  const types = ENTITY_TYPES.filter((t) => canEdit(actor, t));
  if (!types.length) throw new TranslationDenied("catalog.edit");
  const locales = opts.locales?.filter(isTranslationLocale);
  const queued = await scanAndQueue({ types, ...(locales?.length && { locales }) });
  const run = await runTranslationQueue({ actorId: actor.id, timeBudgetMs: 50_000 });
  return { queued, ...run };
}

/** Publish every reviewed-ready AI draft (not stale, glossary check passed) for one locale or all. */
export async function bulkPublish(actor: Actor, opts: { locale?: string; type?: EntityType } = {}) {
  const types = (opts.type ? [opts.type] : ENTITY_TYPES).filter((t) => canEdit(actor, t));
  if (!types.length) throw new TranslationDenied(opts.type ? permissionFor(opts.type) : "catalog.edit");
  const rows = await db.contentTranslation.findMany({
    where: { status: "draft", lastError: null, queuedAt: null, entityType: { in: [...types] }, ...(opts.locale && isTranslationLocale(opts.locale) && { locale: opts.locale }) },
  });
  const hashes = new Map<string, string>();
  for (const type of types) for (const s of await loadSources(type)) hashes.set(`${type}:${s.id}`, s.hash);
  const stamp = new Date();
  let published = 0;
  for (const r of rows) {
    if (!hasContent(asMap(r.fields)) || r.sourceHash !== hashes.get(`${r.entityType}:${r.entityId}`)) continue;
    await db.contentTranslation.update({ where: { id: r.id }, data: { status: "published", published: asMap(r.fields), publishedHash: r.sourceHash, publishedAt: stamp, publishedById: actor.id } });
    published++;
  }
  if (published) invalidateTranslations();
  return published;
}

// ─────────────────────────────── Admin reads ───────────────────────────────

export type LocaleCell = {
  locale: string;
  state: TranslationState;
  fields: FieldMap;
  published: FieldMap | null;
  sourceText: FieldMap | null;
  source: string | null;
  model: string | null;
  lastError: string | null;
  translatedAt: string | null;
  publishedAt: string | null;
};

/** Everything the language tabs need for one item. */
export async function editorData(type: EntityType, id: string) {
  const src = await loadSource(type, id);
  if (!src) return null;
  const [rows, settings] = await Promise.all([db.contentTranslation.findMany({ where: { entityType: type, entityId: id } }), getTranslationSettings()]);
  const cells: LocaleCell[] = TRANSLATION_LOCALES.map((locale) => {
    const r = rows.find((x) => x.locale === locale);
    return {
      locale,
      state: stateOf(r, src.hash),
      fields: asMap(r?.fields),
      published: r?.published ? asMap(r.published) : null,
      sourceText: r?.sourceText ? asMap(r.sourceText) : null,
      source: r?.source ?? null,
      model: r?.model ?? null,
      lastError: r?.lastError ?? null,
      translatedAt: r?.translatedAt?.toISOString() ?? null,
      publishedAt: r?.publishedAt?.toISOString() ?? null,
    };
  });
  return { type, id, label: src.label, href: src.href, english: src.fields, hash: src.hash, cells, enabledLocales: settings.locales };
}
export type EditorData = NonNullable<Awaited<ReturnType<typeof editorData>>>;

/** Coverage matrix, stale list and usage for Admin → Translations. */
export async function translationsOverview() {
  const [settings, rows] = await Promise.all([getTranslationSettings(), db.contentTranslation.findMany({ select: { entityType: true, entityId: true, locale: true, status: true, source: true, fields: true, published: true, sourceHash: true, queuedAt: true, lastError: true, updatedAt: true } })]);
  const byKey = new Map(rows.map((r) => [`${r.entityType}:${r.entityId}:${r.locale}`, r]));
  const items: { type: EntityType; id: string; label: string; href: string | null; states: Record<string, TranslationState> }[] = [];
  for (const type of ENTITY_TYPES) {
    for (const s of await loadSources(type, { activeOnly: true })) {
      const states: Record<string, TranslationState> = {};
      for (const l of TRANSLATION_LOCALES) states[l] = stateOf(byKey.get(`${type}:${s.id}:${l}`), s.hash);
      items.push({ type, id: s.id, label: s.label, href: s.href, states });
    }
  }
  const matrix = TRANSLATION_LOCALES.map((locale) => {
    const counts: Record<TranslationState, number> = { published: 0, ai_draft: 0, draft: 0, stale: 0, queued: 0, needs_translation: 0, missing: 0 };
    for (const it of items) counts[it.states[locale]]++;
    return { locale, enabled: settings.locales.includes(locale), counts, total: items.length, coverage: items.length ? Math.round((counts.published / items.length) * 100) : 0 };
  });
  const stale = items.flatMap((it) => TRANSLATION_LOCALES.filter((l) => it.states[l] === "stale").map((l) => ({ type: it.type, id: it.id, label: it.label, locale: l })));
  const flagged = rows.filter((r) => r.lastError && !r.queuedAt).map((r) => ({ type: r.entityType as EntityType, id: r.entityId, locale: r.locale, error: r.lastError! }));
  const [usage, spent, mode] = await Promise.all([
    db.aiUsage.aggregate({ where: { feature: "translation", createdAt: { gte: monthStart() } }, _sum: { costMicros: true, inputTokens: true, outputTokens: true, cacheReadTokens: true }, _count: { _all: true } }),
    translationSpendMicros(),
    resolveAiMode(),
  ]);
  return {
    settings,
    items,
    matrix,
    stale,
    flagged: flagged.slice(0, 50),
    queued: rows.filter((r) => r.queuedAt).length,
    usage: {
      calls: usage._count._all,
      inputTokens: usage._sum.inputTokens ?? 0,
      outputTokens: usage._sum.outputTokens ?? 0,
      cacheReadTokens: usage._sum.cacheReadTokens ?? 0,
      spentMicros: spent,
      capMicros: Math.round(settings.monthlyCapUsd * 1_000_000),
      globalCapMicros: mode.capMicros,
      globalSpentMicros: mode.spentMicros,
      live: mode.live,
      reason: mode.live ? null : NOT_LIVE_REASON[mode.reason],
      model: mode.models.translate,
    },
  };
}
export type TranslationsOverview = Awaited<ReturnType<typeof translationsOverview>>;

/** Daily cron "translate": queue what is missing or stale, then translate one batch within the budgets. */
export async function runTranslateCron() {
  const settings = await getTranslationSettings();
  if (!settings.auto) return { skipped: "Automatic translation is off (Admin → Translations)." };
  const queued = await scanAndQueue();
  return { queued, ...(await runTranslationQueue({ timeBudgetMs: 50_000 })) };
}
