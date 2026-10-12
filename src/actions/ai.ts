"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { cuid, done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";
import {
  AiDenied,
  AiFeatureOff,
  draftJournalPost,
  draftProductCopy,
  journalDraftSchema,
  PRODUCT_COPY_KINDS,
  productCopySchema,
  productFactsSchema,
  saveJournalDraft,
  saveProductCopy,
  summariseReviews,
  type ProductDraft,
  type ProductCopyKind,
  type ReviewSummary,
} from "@/server/ai/admin";
import { saveAiFeatures } from "@/server/ai/config";
import { recordFeedback, ownsConversation } from "@/server/ai/concierge";
import { createSupportTicketFromChat } from "@/server/ai/handoff";
import { conciergeWho } from "@/server/ai/identity";

type Draft<T> = { ok: true; draft: T; mock: boolean; note?: string; model: string } | { ok: false; error: string };

const errorText = (e: unknown) => (e instanceof AiDenied || e instanceof AiFeatureOff ? e.message : e instanceof z.ZodError ? zodMessage(e) : e instanceof Error && e.message.length < 140 ? e.message : "Something went wrong.");

// ─────────────────────────────── Product form: Write with AI ───────────────────────────────

const draftInput = z.object({
  kind: z.enum(PRODUCT_COPY_KINDS),
  productId: cuid.optional(),
  brief: z.string().trim().max(500).optional(),
  facts: productFactsSchema,
});

/** Returns a draft for the admin to review. Never saves anything to the product. */
export async function aiDraftProductCopy<K extends ProductCopyKind>(input: { kind: K; productId?: string; brief?: string; facts: z.input<typeof productFactsSchema> }): Promise<Draft<ProductDraft[K]>> {
  const user = await requirePermission("catalog.edit");
  const parsed = draftInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodMessage(parsed.error) };
  try {
    const r = await draftProductCopy(user, parsed.data.kind as K, parsed.data.facts, parsed.data.brief);
    await audit(user.id, "ai.product_copy.draft", "Product", parsed.data.productId ?? null, { kind: parsed.data.kind, mock: r.mock, model: r.model });
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

export async function aiGetProductCopy(productId: string) {
  await requirePermission("catalog.view");
  if (!cuid.safeParse(productId).success) return null;
  return db.productCopy.findUnique({ where: { productId }, select: { seoTitle: true, seoDescription: true, nameAr: true, subtitleAr: true, storyAr: true, updatedAt: true } });
}

/** Explicit save of the SEO / Arabic fields after the admin reviewed them. */
export async function aiSaveProductCopy(input: z.input<typeof productCopySchema>): Promise<ActionResult> {
  const user = await requirePermission("catalog.edit");
  const parsed = productCopySchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    await saveProductCopy(user, parsed.data);
  } catch (e) {
    return fail(errorText(e));
  }
  await audit(user.id, "product.copy.update", "Product", parsed.data.productId, {
    fields: Object.entries(parsed.data)
      .filter(([k, v]) => k !== "productId" && v)
      .map(([k]) => k),
  });
  const slug = (await db.product.findUnique({ where: { id: parsed.data.productId }, select: { slug: true } }))?.slug;
  if (slug) revalidatePath(`/product/${slug}`);
  return done("SEO & Arabic copy saved");
}

// ─────────────────────────────── Reviews ───────────────────────────────

export async function aiSummariseReviews(input: { productId: string; refresh?: boolean }): Promise<
  { ok: true; summary: ReviewSummary; reviewCount: number; mock: boolean; model: string; updatedAt: string; cached: boolean } | { ok: false; error: string }
> {
  const user = await requirePermission("content.edit");
  const parsed = z.object({ productId: cuid, refresh: z.boolean().optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: zodMessage(parsed.error) };
  try {
    const r = await summariseReviews(user, parsed.data.productId, { refresh: parsed.data.refresh });
    if (!r.cached) await audit(user.id, "ai.review_summary", "Product", parsed.data.productId, { reviews: r.reviewCount, mock: r.mock, model: r.model });
    revalidatePath("/admin/reviews");
    return { ok: true, summary: r.summary, reviewCount: r.reviewCount, mock: r.mock, model: r.model, updatedAt: r.updatedAt.toISOString(), cached: r.cached };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

// ─────────────────────────────── Journal ───────────────────────────────

export async function aiDraftJournal(input: { brief: string }): Promise<Draft<z.infer<typeof journalDraftSchema>>> {
  const user = await requirePermission("content.edit");
  const parsed = z.object({ brief: z.string().trim().min(10, "Write a brief of at least a sentence.").max(2000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: zodMessage(parsed.error) };
  try {
    const r = await draftJournalPost(user, parsed.data.brief);
    await audit(user.id, "ai.journal.draft", "JournalPost", null, { mock: r.mock, model: r.model, briefChars: parsed.data.brief.length });
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

/** Saves the reviewed draft as an unpublished Journal post. */
export async function aiSaveJournalDraft(input: z.input<typeof journalDraftSchema>): Promise<ActionResult> {
  const user = await requirePermission("content.edit");
  const parsed = journalDraftSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const post = await saveJournalDraft(user, parsed.data);
    await audit(user.id, "journal.create_draft", "JournalPost", post.id, { slug: post.slug, viaAi: true });
    revalidatePath("/admin/ai");
    return done(`Saved as an unpublished draft (/journal/${post.slug})`, post.id);
  } catch (e) {
    return fail(errorText(e));
  }
}

// ─────────────────────────────── Settings ───────────────────────────────

const featuresInput = z.object({ concierge: z.boolean(), productCopy: z.boolean(), reviewSummaries: z.boolean(), journalDraft: z.boolean() });

export async function aiSaveFeatures(input: z.input<typeof featuresInput>): Promise<ActionResult> {
  const user = await requirePermission("settings.manage");
  const parsed = featuresInput.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  await saveAiFeatures(parsed.data);
  await audit(user.id, "ai.features.update", "Setting", "ai:features", parsed.data);
  revalidatePath("/admin/ai");
  revalidatePath("/", "layout");
  return done("AI features updated");
}

// ─────────────────────────────── Storefront: feedback & hand-off ───────────────────────────────

const convoInput = z.object({ conversationId: cuid, helpful: z.boolean().optional(), note: z.string().trim().max(500).optional() });

export async function conciergeFeedback(input: { conversationId: string; helpful: boolean; note?: string }): Promise<{ ok: boolean }> {
  const parsed = convoInput.required({ helpful: true }).safeParse(input);
  if (!parsed.success) return { ok: false };
  const who = await conciergeWho();
  return { ok: await recordFeedback(parsed.data.conversationId, parsed.data.helpful, parsed.data.note ?? null, who) };
}

export async function conciergeHandoff(input: { conversationId: string; note?: string }): Promise<{ ok: true; ticket: string | null } | { ok: false; error: string }> {
  const parsed = convoInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Start a chat first." };
  const who = await conciergeWho();
  if (!(await ownsConversation(parsed.data.conversationId, who))) return { ok: false, error: "Start a chat first." };
  const r = await createSupportTicketFromChat(parsed.data.conversationId, { note: parsed.data.note ?? null });
  if (!r.ok) return r;
  return { ok: true, ticket: r.ticketNumber != null ? String(r.ticketNumber) : r.ticketId };
}
