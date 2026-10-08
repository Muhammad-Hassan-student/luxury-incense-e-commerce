"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/server/audit";
import { DASHBOARD_SETTINGS_KEY, getDashboardSettings, saveDashboardSettings } from "@/server/dashboard";
import { requirePermission } from "@/server/roles";
import { done, fail, zodMessage } from "@/lib/admin-server";
import { toMinor, type ActionResult } from "@/lib/admin-shared";

/** Major units (₹) from the inline editor; 0 clears the goal. */
const goalSchema = z.object({ target: z.number().min(0, "The goal can’t be negative").max(1_000_000_000, "That goal is too large") });

export async function saveMonthlyGoal(input: z.input<typeof goalSchema>): Promise<ActionResult> {
  const user = await requirePermission("settings.manage");
  const parsed = goalSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const before = await getDashboardSettings();
  const saved = await saveDashboardSettings({ monthlyTarget: toMinor(parsed.data.target) });
  await audit(user.id, "settings.dashboard_goal", "Setting", DASHBOARD_SETTINGS_KEY, { from: before.monthlyTarget, to: saved.monthlyTarget });
  revalidatePath("/admin");
  return done(saved.monthlyTarget ? "Monthly goal saved" : "Monthly goal cleared");
}
