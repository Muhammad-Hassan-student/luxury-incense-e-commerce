"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { rateLimit } from "@/server/rate-limit";
import { runBackup } from "@/server/backup";
import { recordCronRun } from "@/server/monitoring";
import { cuid, done, fail } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";

/* Admin → Health: error group triage and "run the backup now". */

const statusSchema = z.object({ ids: z.array(cuid).min(1).max(100), status: z.enum(["open", "resolved", "ignored"]) });

export async function setErrorStatusAction(input: z.input<typeof statusSchema>): Promise<ActionResult> {
  const user = await requirePermission("health.view");
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid selection.");
  const { ids, status } = parsed.data;
  const r = await db.errorGroup.updateMany({ where: { id: { in: ids } }, data: { status, resolvedAt: status === "resolved" ? new Date() : null, ...(status === "open" ? { alertedAt: null } : {}) } });
  await audit(user.id, `monitoring.error.${status}`, "ErrorGroup", ids.length === 1 ? ids[0] : null, { ids, count: r.count });
  revalidatePath("/admin/health");
  return done(`${r.count} error group${r.count === 1 ? "" : "s"} marked ${status}`);
}

/** Owner: build and deliver a backup right now (same as the daily cron), recorded as a cron run. */
export async function runBackupNowAction(): Promise<ActionResult> {
  const user = await requirePermission("health.view");
  if (user.role !== "OWNER") return fail("Only owners can run backups.");
  if (!(await rateLimit(`backup-run:${user.id}`, 3, 3600)).ok) return fail("Backups were run several times this hour — try again later.");
  try {
    const r = (await recordCronRun("backup", () => runBackup())) as { destination?: string; bytes?: number; skipped?: string };
    await audit(user.id, "backup.run", "Backup", null, r);
    revalidatePath("/admin/health");
    if (r.skipped) return fail("Backups are switched off in Integrations → Monitoring & backups.");
    return done(`Backup sent (${r.destination}, ${Math.round((r.bytes ?? 0) / 1024)} KB)`);
  } catch (e) {
    revalidatePath("/admin/health");
    return fail(`Backup failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
