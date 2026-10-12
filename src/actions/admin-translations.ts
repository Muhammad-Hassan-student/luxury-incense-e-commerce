"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAnyPermission, requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";
import { isEntityType, type EntityType } from "@/lib/translations-shared";
import {
  bulkPublish,
  editorData,
  publishTranslation,
  saveTranslation,
  TranslationDenied,
  translateMissing,
  translateNow,
  unpublishTranslation,
  type EditorData,
  type RunResult,
} from "@/server/translations/service";
import { saveTranslationSettings, translationSettingsSchema } from "@/server/translations/source";

const errorText = (e: unknown) => (e instanceof TranslationDenied ? e.message : e instanceof z.ZodError ? zodMessage(e) : e instanceof Error && e.message.length < 160 ? e.message : "Something went wrong.");

const refresh = (type?: string, id?: string) => {
  revalidatePath("/admin/translations");
  if (type && id) revalidatePath(`/admin/translations/${type}/${id}`);
  if (type === "product" && id) revalidatePath(`/admin/products/${id}`);
};

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(micros < 10_000 ? 4 : 2)}`;

function runMessage(r: RunResult & { queued?: number }) {
  if (r.skipped && !r.translated) return r.skipped;
  const bits = [`${r.translated} translated`];
  if (r.published) bits.push(`${r.published} published`);
  if (r.flagged) bits.push(`${r.flagged} to check`);
  if (r.failed) bits.push(`${r.failed} failed`);
  if (r.pending) bits.push(`${r.pending} still queued`);
  if (r.costMicros) bits.push(`≈ ${usd(r.costMicros)}`);
  return `${bits.join(" · ")}${r.skipped ? ` — ${r.skipped}` : ""}`;
}

/** Fresh tab data after an action (the client re-renders the language tabs from it). */
export type TabResult = { ok: true; message?: string; data: EditorData } | { ok: false; error: string };

async function tabData(type: EntityType, id: string) {
  const data = await editorData(type, id);
  if (!data) throw new Error("That item no longer exists.");
  return data;
}

export async function loadTranslations(type: string, id: string): Promise<TabResult> {
  await requireAnyPermission("catalog.view", "content.view");
  if (!isEntityType(type)) return { ok: false, error: "Unknown item." };
  try {
    return { ok: true, data: await tabData(type, id) };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

export async function saveTranslationAction(input: { type: string; id: string; locale: string; fields: Record<string, string | string[]>; publish?: boolean }): Promise<TabResult> {
  const user = await requireAnyPermission("catalog.edit", "content.edit");
  try {
    const row = await saveTranslation(user, input as Parameters<typeof saveTranslation>[1]);
    await audit(user.id, input.publish ? "translation.publish" : "translation.save", "ContentTranslation", row.id, { type: input.type, entityId: input.id, locale: input.locale });
    refresh(input.type, input.id);
    return { ok: true, message: input.publish ? "Saved and published" : "Draft saved", data: await tabData(input.type as EntityType, input.id) };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

export async function publishTranslationAction(input: { type: string; id: string; locale: string; unpublish?: boolean }): Promise<TabResult> {
  const user = await requireAnyPermission("catalog.edit", "content.edit");
  try {
    const ref = input as { type: EntityType; id: string; locale: string };
    if (input.unpublish) await unpublishTranslation(user, ref);
    else await publishTranslation(user, ref);
    await audit(user.id, input.unpublish ? "translation.unpublish" : "translation.publish", "ContentTranslation", null, { type: input.type, entityId: input.id, locale: input.locale });
    refresh(input.type, input.id);
    return { ok: true, message: input.unpublish ? "Removed from the store — English shows again" : "Published", data: await tabData(ref.type, input.id) };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

export async function translateNowAction(input: { type: string; id: string; locales: string[] }): Promise<TabResult> {
  const user = await requireAnyPermission("catalog.edit", "content.edit");
  try {
    const r = await translateNow(user, input as Parameters<typeof translateNow>[1]);
    await audit(user.id, "translation.ai", "ContentTranslation", null, { type: input.type, entityId: input.id, locales: input.locales, translated: r.translated, costMicros: r.costMicros, skipped: r.skipped ?? null });
    refresh(input.type, input.id);
    const data = await tabData(input.type as EntityType, input.id);
    if (r.skipped && !r.translated) return { ok: false, error: r.skipped };
    return { ok: true, message: runMessage(r), data };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

export async function translateMissingAction(input: { locales?: string[] } = {}): Promise<ActionResult> {
  const user = await requireAnyPermission("catalog.edit", "content.edit");
  try {
    const r = await translateMissing(user, input);
    await audit(user.id, "translation.translate_missing", "ContentTranslation", null, { queued: r.queued, translated: r.translated, costMicros: r.costMicros, skipped: r.skipped ?? null });
    refresh();
    if (r.skipped && !r.translated) return fail(`${r.queued} queued. ${r.skipped}`);
    return done(`${r.queued} queued · ${runMessage(r)}`);
  } catch (e) {
    return fail(errorText(e));
  }
}

export async function bulkPublishAction(input: { locale?: string; type?: string } = {}): Promise<ActionResult> {
  const user = await requireAnyPermission("catalog.edit", "content.edit");
  try {
    const n = await bulkPublish(user, { locale: input.locale, type: isEntityType(input.type) ? input.type : undefined });
    await audit(user.id, "translation.bulk_publish", "ContentTranslation", null, { locale: input.locale ?? "all", type: input.type ?? "all", published: n });
    refresh();
    return done(n ? `${n} translation${n === 1 ? "" : "s"} published` : "Nothing ready to publish (stale or flagged drafts need a look first)");
  } catch (e) {
    return fail(errorText(e));
  }
}

export async function saveTranslationSettingsAction(input: z.input<typeof translationSettingsSchema>): Promise<ActionResult> {
  const user = await requirePermission("catalog.edit");
  const parsed = translationSettingsSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  await saveTranslationSettings(parsed.data);
  await audit(user.id, "translation.settings", "Setting", "translations:settings", parsed.data);
  refresh();
  return done("Translation settings saved");
}
