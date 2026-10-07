"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { VisitStatus } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { requirePermission } from "@/server/roles";
import { VisitError, emailVisitor, getVisitSettings, rescheduleVisit, saveVisitSettings, transitionVisit } from "@/server/visits";
import { fmtVisitDay, fmtVisitTime, visitSettingsSchema, type VisitSettingsInput } from "@/server/visit-schedule";
import { db } from "@/server/db";
import { cuid, done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";

function revalidateVisit(id?: string, token?: string) {
  revalidatePath("/admin/visits");
  if (id) revalidatePath(`/admin/visits/${id}`);
  if (token) revalidatePath(`/visit/${token}`);
}

function guard(e: unknown): ActionResult {
  if (e instanceof VisitError) return fail(e.message);
  throw e;
}

// ─────────────────────────────── Settings ───────────────────────────────

export async function saveVisitSettingsAction(input: VisitSettingsInput): Promise<ActionResult> {
  const user = await requirePermission("visits.manage");
  const parsed = visitSettingsSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const saved = await saveVisitSettings(parsed.data);
  await audit(user.id, "visit.settings", "Setting", "visits", {
    capacityPerSlot: saved.capacityPerSlot,
    maxGroupSize: saved.maxGroupSize,
    leadDays: saved.leadDays,
    horizonDays: saved.horizonDays,
    closedDates: saved.closedDates.length,
    autoConfirm: saved.autoConfirm,
  });
  revalidatePath("/admin/visits/settings");
  revalidatePath("/visit");
  return done("Visit settings saved");
}

// ─────────────────────────────── Status ───────────────────────────────

const STAFF_TARGETS = ["CONFIRMED", "DECLINED", "CANCELLED", "CHECKED_IN", "COMPLETED", "NO_SHOW"] as const satisfies readonly VisitStatus[];

const statusSchema = z.object({
  id: cuid,
  to: z.enum(STAFF_TARGETS),
  reason: z.string().trim().max(600).optional().default(""),
  notify: z.boolean().optional().default(true),
});

const verb: Record<(typeof STAFF_TARGETS)[number], string> = {
  CONFIRMED: "confirmed",
  DECLINED: "declined",
  CANCELLED: "cancelled",
  CHECKED_IN: "checked in",
  COMPLETED: "completed",
  NO_SHOW: "marked no-show",
};

export async function setVisitStatusAction(input: z.input<typeof statusSchema>): Promise<ActionResult> {
  const user = await requirePermission("visits.manage");
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { id, to, reason, notify } = parsed.data;
  if (to === "DECLINED" && !reason) return fail("Please give the visitor a reason.");
  try {
    const { before, after } = await transitionVisit(id, to);
    await audit(user.id, `visit.${to.toLowerCase()}`, "Visit", id, { reference: after.reference, from: before.status, to, ...(reason ? { reason } : {}) });
    // Reception moves (check-in, complete, no-show, undo) don't email; decisions about the booking do.
    if (notify) {
      if (to === "CONFIRMED" && before.status === "REQUESTED") await emailVisitor(after, "confirmed");
      if (to === "DECLINED") await emailVisitor(after, "declined", { reason });
      if (to === "CANCELLED") await emailVisitor(after, "cancelled", { reason: reason || null });
    }
    revalidateVisit(id, after.token);
    return done(`${after.reference} ${verb[to]}`);
  } catch (e) {
    return guard(e);
  }
}

// ─────────────────────────────── Reschedule ───────────────────────────────

const rescheduleSchema = z.object({
  id: cuid,
  startsAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
  override: z.boolean().optional().default(false),
});

export async function rescheduleVisitAction(input: z.input<typeof rescheduleSchema>): Promise<ActionResult> {
  const user = await requirePermission("visits.manage");
  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const s = await getVisitSettings();
    const { before, after } = await rescheduleVisit(parsed.data.id, parsed.data.startsAt, { by: "staff", override: parsed.data.override, settings: s });
    await audit(user.id, "visit.reschedule", "Visit", after.id, {
      reference: after.reference,
      from: before.startsAt.toISOString(),
      to: after.startsAt.toISOString(),
      fromStatus: before.status,
      override: parsed.data.override,
    });
    await emailVisitor(after, "rescheduled", { settings: s });
    revalidateVisit(after.id, after.token);
    return done(`${after.reference} moved to ${fmtVisitDay(after.startsAt, s.timezone)}, ${fmtVisitTime(after.startsAt, s.timezone)}`);
  } catch (e) {
    return guard(e);
  }
}

// ─────────────────────────────── Notes & trade invite ───────────────────────────────

const notesSchema = z.object({ id: cuid, notes: z.string().trim().max(4000) });

export async function saveVisitNotesAction(input: z.input<typeof notesSchema>): Promise<ActionResult> {
  const user = await requirePermission("visits.manage");
  const parsed = notesSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const res = await db.visit.updateMany({ where: { id: parsed.data.id }, data: { staffNotes: parsed.data.notes || null } });
  if (!res.count) return fail("Visit not found.");
  await audit(user.id, "visit.notes", "Visit", parsed.data.id, { length: parsed.data.notes.length });
  revalidateVisit(parsed.data.id);
  return done("Notes saved");
}

const idSchema = z.object({ id: cuid });

export async function inviteVisitorToTradeAction(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const user = await requirePermission("visits.manage");
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const v = await db.visit.findUnique({ where: { id: parsed.data.id } });
  if (!v) return fail("Visit not found.");
  if (v.purpose !== "WHOLESALE") return fail("Trade invitations are for wholesale visits.");
  await emailVisitor(v, "trade-invite");
  await audit(user.id, "visit.trade_invite", "Visit", v.id, { reference: v.reference, email: v.email });
  revalidateVisit(v.id);
  return done(`Trade invitation sent to ${v.email}`);
}
