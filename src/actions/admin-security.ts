"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { POLICY_KEY, policySchema } from "@/server/security/state";
import { done, fail } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";

/** Admin → Settings: who must use Face ID / phone lock as a second sign-in step. */
export async function saveSecondStepPolicy(input: { require: string }): Promise<ActionResult> {
  const user = await requirePermission("settings.manage");
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) return fail("Choose nobody, all staff or everyone.");
  await db.setting.upsert({ where: { key: POLICY_KEY }, update: { value: parsed.data }, create: { key: POLICY_KEY, value: parsed.data } });
  await audit(user.id, "security.policy.update", "Setting", POLICY_KEY, parsed.data);
  revalidatePath("/admin/settings");
  const who = { nobody: "nobody", staff: "all staff", everyone: "everyone" }[parsed.data.require];
  return done(`Face ID / phone lock is now required for ${who}`);
}
