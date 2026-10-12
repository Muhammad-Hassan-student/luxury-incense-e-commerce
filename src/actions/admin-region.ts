"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, requireStaff } from "@/server/roles";
import { getRegion, saveRegion } from "@/server/region";
import { pinRate, refreshRatesNow, setCurrencyOptions } from "@/server/fx";
import { applyConversion, previewConversion, undoLastConversion, type ConversionPlan } from "@/server/currency-conversion";
import { done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";
import { ROUNDINGS, type Rounding } from "@/lib/region-shared";

function revalidateAll() {
  revalidatePath("/admin", "layout");
  revalidatePath("/", "layout");
}

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

const regionInput = z.object({
  country: z.string(),
  timezone: z.string(),
  displayCurrency: z.string(),
  enabledCurrencies: z.array(z.string()).max(40),
  phoneCode: z.string(),
  taxLabel: z.string(),
  taxRatePercent: z.number().min(0).max(50),
  locale: z.string(),
});

/** Admin → Settings → Region & currency (settings.manage, audited). */
export async function saveRegionSettings(input: z.input<typeof regionInput>): Promise<ActionResult> {
  const user = await requirePermission("settings.manage");
  const parsed = regionInput.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const region = await getRegion();
    await saveRegion(user, { ...parsed.data, rounding: region.rounding });
  } catch (e) {
    if (e instanceof z.ZodError) return fail(zodMessage(e));
    return fail(message(e));
  }
  revalidateAll();
  return done("Region saved");
}

export async function pinRateAction(input: { code: string; rate: number | null }): Promise<ActionResult> {
  const user = await requirePermission("settings.manage");
  try {
    await pinRate(user, input.code, input.rate === null ? null : Number(input.rate));
  } catch (e) {
    return fail(message(e));
  }
  revalidateAll();
  return done(input.rate === null ? `${input.code} follows the live rate again` : `${input.code} pinned`);
}

export async function currencyOptionsAction(input: { code: string; enabled?: boolean; rounding?: string }): Promise<ActionResult> {
  const user = await requirePermission("settings.manage");
  if (input.rounding && !ROUNDINGS.includes(input.rounding as Rounding)) return fail("Unknown rounding rule.");
  try {
    await setCurrencyOptions(user, input.code, { enabled: input.enabled, rounding: input.rounding as Rounding | undefined });
  } catch (e) {
    return fail(message(e));
  }
  revalidateAll();
  return done("Saved");
}

export async function refreshRatesAction(): Promise<ActionResult> {
  const user = await requirePermission("settings.manage");
  const r = await refreshRatesNow(user);
  revalidateAll();
  return r.ok ? done(`Rates updated (${r.updated} currencies)`) : fail(`Couldn’t reach the rate feed — keeping the last rates. ${r.error}`);
}

// ── Base-currency wizard (owner only; the server functions check the role again) ──

const wizardInput = z.object({ to: z.string().length(3), rate: z.number().positive().max(1_000_000).optional(), rounding: z.enum(ROUNDINGS).optional() });

export type PreviewResult = { ok: true; plan: ConversionPlan } | { ok: false; error: string };

export async function previewConversionAction(input: z.input<typeof wizardInput>): Promise<PreviewResult> {
  const user = await requireStaff();
  const parsed = wizardInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodMessage(parsed.error) };
  try {
    return { ok: true, plan: await previewConversion(user, parsed.data) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function applyConversionAction(input: z.input<typeof wizardInput> & { confirm: string }): Promise<ActionResult> {
  const user = await requireStaff();
  const parsed = wizardInput.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const r = await applyConversion(user, { ...parsed.data, confirm: input.confirm });
    revalidateAll();
    return done(`Converted ${r.plan.changes.length} amounts to ${r.plan.to}`);
  } catch (e) {
    return fail(message(e));
  }
}

export async function undoConversionAction(): Promise<ActionResult> {
  const user = await requireStaff();
  try {
    const r = await undoLastConversion(user);
    revalidateAll();
    return done(`Restored ${r.restored} amounts — the base currency is ${r.base} again${r.editedSince ? ` (${r.editedSince} edited since were overwritten)` : ""}`);
  } catch (e) {
    return fail(message(e));
  }
}
