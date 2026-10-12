import "server-only";
import { z } from "zod";
import { db } from "../db";
import { getIntegration } from "../integrations";

/**
 * AI settings: the `ai` integration (key, models, monthly cap — Admin → Integrations) plus per-feature switches
 * (Admin → AI, stored in the `ai:features` setting). Everything degrades to Mock mode, never to an error.
 */

export const AI_FEATURES = ["concierge", "productCopy", "reviewSummaries", "journalDraft"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const featureLabels: Record<AiFeature, string> = {
  concierge: "Scent concierge (storefront chat)",
  productCopy: "Write with AI (product form)",
  reviewSummaries: "Review summaries",
  journalDraft: "Journal drafts",
};

const featuresSchema = z.object({
  concierge: z.boolean().default(true),
  productCopy: z.boolean().default(true),
  reviewSummaries: z.boolean().default(true),
  journalDraft: z.boolean().default(true),
});
export type AiFeatures = z.infer<typeof featuresSchema>;
export const FEATURES_KEY = "ai:features";

export async function getAiFeatures(): Promise<AiFeatures> {
  const row = await db.setting.findUnique({ where: { key: FEATURES_KEY } }).catch(() => null);
  const parsed = featuresSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : featuresSchema.parse({});
}

export async function saveAiFeatures(next: AiFeatures) {
  const value = featuresSchema.parse(next);
  await db.setting.upsert({ where: { key: FEATURES_KEY }, create: { key: FEATURES_KEY, value }, update: { value } });
}

// ─────────────────────────────── Pricing & spend ───────────────────────────────

/** USD per million tokens. Cache writes are 1.25× input (5-minute TTL). Unknown models price as Sonnet. */
const PRICES: { match: RegExp; input: number; output: number; cacheRead: number }[] = [
  { match: /opus-5-5/, input: 4, output: 20, cacheRead: 0.2 },
  { match: /opus/, input: 5, output: 25, cacheRead: 0.5 },
  { match: /fable|mythos/, input: 10, output: 50, cacheRead: 1 },
  { match: /haiku/, input: 1, output: 5, cacheRead: 0.1 },
  { match: /sonnet-4/, input: 3, output: 15, cacheRead: 0.3 },
  { match: /sonnet/, input: 2, output: 10, cacheRead: 0.2 },
];

export type TokenUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

/** Cost estimate in micro-USD (1e-6 $), rounded up. */
export function estimateCostMicros(model: string, u: TokenUsage) {
  const p = PRICES.find((x) => x.match.test(model)) ?? PRICES[PRICES.length - 1];
  const usd = (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.input * 1.25) / 1_000_000;
  return Math.ceil(usd * 1_000_000);
}

export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Live (non-mock) spend this calendar month (UTC), in micro-USD. */
export async function monthSpendMicros(now = new Date()) {
  const agg = await db.aiUsage.aggregate({ where: { createdAt: { gte: monthStart(now) }, mock: false }, _sum: { costMicros: true } });
  return agg._sum.costMicros ?? 0;
}

export type AiFeatureName = "concierge" | "product_copy" | "review_summary" | "journal_draft" | "translation";

export async function recordUsage(input: { feature: AiFeatureName; model: string; usage?: Partial<TokenUsage>; mock?: boolean; actorId?: string | null }) {
  const u: TokenUsage = {
    inputTokens: input.usage?.inputTokens ?? 0,
    outputTokens: input.usage?.outputTokens ?? 0,
    cacheReadTokens: input.usage?.cacheReadTokens ?? 0,
    cacheWriteTokens: input.usage?.cacheWriteTokens ?? 0,
  };
  const costMicros = input.mock ? 0 : estimateCostMicros(input.model, u);
  await db.aiUsage
    .create({ data: { feature: input.feature, model: input.mock ? "mock" : input.model, ...u, costMicros, mock: Boolean(input.mock), actorId: input.actorId ?? null } })
    .catch((e) => console.error("[ai] usage log failed", e instanceof Error ? e.message : e));
  return costMicros;
}

// ─────────────────────────────── Mode ───────────────────────────────

export type AiModels = { concierge: string; admin: string; fast: string; translate: string };

export type AiMode =
  | { live: true; apiKey: string; models: AiModels; capMicros: number; spentMicros: number }
  | { live: false; reason: "disabled" | "no_key" | "cap"; models: AiModels; capMicros: number; spentMicros: number };

/**
 * Live only when enabled, keyed and under the monthly cap. Over the cap fails closed to Mock mode.
 * `AI_TRANSPORT=mock` (set by test scripts) forces Mock mode regardless of saved keys.
 */
export async function resolveAiMode(now = new Date()): Promise<AiMode> {
  const cfg = await getIntegration("ai");
  const models: AiModels = { concierge: cfg.conciergeModel, admin: cfg.adminModel, fast: cfg.fastModel, translate: cfg.translationModel };
  const capMicros = Math.round(cfg.monthlyCapUsd * 1_000_000);
  const spentMicros = await monthSpendMicros(now);
  const base = { models, capMicros, spentMicros };
  if (!cfg.enabled) return { live: false, reason: "disabled", ...base };
  if (!cfg.apiKey || process.env.AI_TRANSPORT === "mock") return { live: false, reason: "no_key", ...base };
  if (capMicros > 0 && spentMicros >= capMicros) return { live: false, reason: "cap", ...base };
  return { live: true, apiKey: cfg.apiKey, ...base };
}

export const mockReasonText: Record<Exclude<AiMode, { live: true }>["reason"], string> = {
  disabled: "AI is switched off — answering in Mock mode from the catalogue.",
  no_key: "No Anthropic key yet — answering in Mock mode from the catalogue.",
  cap: "This month’s AI budget is used up — answering in Mock mode from the catalogue.",
};
