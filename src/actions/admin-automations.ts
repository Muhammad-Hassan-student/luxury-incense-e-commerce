"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/roles";
import { getJourneySettings, JourneyError, saveJourneyConfig, saveJourneySettings, setJourneyEnabled, setJourneysPaused } from "@/server/automations";
import { JOURNEY_KEYS, journeySettingsSchema } from "@/lib/journeys";
import { done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";

const keySchema = z.enum(JOURNEY_KEYS);

function failure(e: unknown, what: string): ActionResult {
  if (e instanceof JourneyError) return fail(e.message);
  console.error(`[journeys] ${what} failed`, e);
  return fail(`${what} failed.`);
}

const revalidate = (key?: string) => {
  revalidatePath("/admin/automations");
  if (key) revalidatePath(`/admin/automations/${key}`);
};

const enabledSchema = z.object({ key: keySchema, enabled: z.boolean() });

export async function setJourneyEnabledAction(input: z.input<typeof enabledSchema>): Promise<ActionResult> {
  const user = await requirePermission("automations.manage");
  const parsed = enabledSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const j = await setJourneyEnabled(user, parsed.data.key, parsed.data.enabled);
    revalidate(parsed.data.key);
    return done(`${j.name} ${j.enabled ? "switched on" : "switched off"}`);
  } catch (e) {
    return failure(e, "Updating the journey");
  }
}

const configSchema = z.object({ key: keySchema, config: z.record(z.string(), z.number()) });

export async function saveJourneyConfigAction(input: z.input<typeof configSchema>): Promise<ActionResult> {
  const user = await requirePermission("automations.manage");
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    await saveJourneyConfig(user, parsed.data.key, parsed.data.config);
    revalidate(parsed.data.key);
    return done("Timing and offers saved");
  } catch (e) {
    return failure(e, "Saving");
  }
}

export async function saveJourneySettingsAction(input: z.input<typeof journeySettingsSchema>): Promise<ActionResult> {
  const user = await requirePermission("automations.manage");
  const parsed = journeySettingsSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    // The kill switch has its own control; a stale form never flips it.
    await saveJourneySettings(user, { ...parsed.data, paused: (await getJourneySettings()).paused });
    revalidate();
    return done("Guardrails saved");
  } catch (e) {
    return failure(e, "Saving");
  }
}

const pauseSchema = z.object({ paused: z.boolean() });

/** Kill switch: stops every journey (no enrolments, no sends) until resumed. */
export async function setJourneysPausedAction(input: z.input<typeof pauseSchema>): Promise<ActionResult> {
  const user = await requirePermission("automations.manage");
  const parsed = pauseSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    await setJourneysPaused(user, parsed.data.paused);
    revalidate();
    for (const k of JOURNEY_KEYS) revalidatePath(`/admin/automations/${k}`);
    return done(parsed.data.paused ? "All journeys paused" : "Journeys resumed");
  } catch (e) {
    return failure(e, "Updating");
  }
}
