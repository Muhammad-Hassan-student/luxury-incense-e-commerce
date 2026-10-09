"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { changeSubscription, saveSubscriptionSettings, SubscriptionRuleError } from "@/server/subscriptions";
import { done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";

const changeSchema = z.object({
  id: z.string().min(1).max(64),
  change: z.discriminatedUnion("type", [
    z.object({ type: z.literal("skip") }),
    z.object({ type: z.literal("interval"), months: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
    z.object({ type: z.literal("quantity"), quantity: z.number().int().min(1).max(10) }),
    z.object({ type: z.literal("pause") }),
    z.object({ type: z.literal("resume") }),
    z.object({ type: z.literal("cancel") }),
    z.object({ type: z.literal("renew_now") }),
  ]),
});

const LABEL = { skip: "Next renewal skipped", interval: "Interval changed", quantity: "Quantity changed", pause: "Paused", resume: "Resumed", cancel: "Cancelled", renew_now: "Renewal started" } as const;

/** Manual actions from /admin/subscriptions (same rules as the customer portal, plus "renew now"). */
export async function adminChangeSubscription(input: z.input<typeof changeSchema>): Promise<ActionResult> {
  const user = await requirePermission("subscriptions.manage");
  const parsed = changeSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { id, change } = parsed.data;
  try {
    await changeSubscription(id, change, "staff");
  } catch (e) {
    if (e instanceof SubscriptionRuleError) return fail(e.message);
    throw e;
  }
  await audit(user.id, `subscription.${change.type}`, "Subscription", id, change);
  revalidatePath("/admin/subscriptions");
  return done(LABEL[change.type]);
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  discountPercent: z.number().int().min(0).max(50),
  maxFailures: z.number().int().min(1).max(10),
  retryDays: z.number().int().min(1).max(14),
  payWindowDays: z.number().int().min(1).max(7),
  reminderDays: z.number().int().min(1).max(14),
});

/** Subscribe & Save settings (discount %, retry policy). New discounts apply to new subscriptions only. */
export async function saveSubscriptionSettingsAction(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  const user = await requirePermission("subscriptions.manage", "settings.manage");
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  await saveSubscriptionSettings(parsed.data);
  await audit(user.id, "subscription.settings", "Setting", "subscriptions", parsed.data);
  revalidatePath("/admin/subscriptions");
  return done("Subscribe & Save settings saved");
}
