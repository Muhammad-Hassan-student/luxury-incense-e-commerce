"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ReturnCondition, ReturnResolution } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { approveReturn, receiveReturn, rejectReturn, resolveReturn, ReturnError, saveReturnSettings, updateReturnNote } from "@/server/returns";
import { returnSettingsSchema } from "@/lib/returns";
import { cuid, done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";
import { formatMoney } from "@/lib/money";

async function revalidateReturn(id: string) {
  revalidatePath("/admin/returns");
  revalidatePath(`/admin/returns/${id}`);
  const r = await db.returnRequest.findUnique({ where: { id }, select: { orderId: true, order: { select: { number: true } } } });
  if (r) {
    revalidatePath(`/admin/orders/${r.orderId}`);
    revalidatePath(`/account/orders/${r.order.number}`);
  }
  revalidatePath("/admin/orders");
  revalidatePath("/admin/inventory");
}

/** Business-rule errors become a toast; anything else is logged and reported generically. */
function failure(e: unknown, what: string): ActionResult {
  if (e instanceof ReturnError) return fail(e.message);
  console.error(`[returns] ${what} failed`, e);
  return fail(e instanceof Error ? `${what} failed: ${e.message}` : `${what} failed.`);
}

const approveSchema = z.object({ id: cuid, note: z.string().trim().max(2000).optional() });

export async function approveReturnAction(input: z.input<typeof approveSchema>): Promise<ActionResult> {
  const user = await requirePermission("returns.manage");
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const r = await approveReturn(user, parsed.data.id, { note: parsed.data.note });
    await revalidateReturn(parsed.data.id);
    return done(`${r.number} approved — customer emailed`);
  } catch (e) {
    return failure(e, "Approval");
  }
}

const rejectSchema = z.object({ id: cuid, reason: z.string().trim().min(3, "Give the customer a reason").max(1000) });

export async function rejectReturnAction(input: z.input<typeof rejectSchema>): Promise<ActionResult> {
  const user = await requirePermission("returns.manage");
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const r = await rejectReturn(user, parsed.data.id, parsed.data.reason);
    await revalidateReturn(parsed.data.id);
    return done(`${r.number} declined — customer emailed`);
  } catch (e) {
    return failure(e, "Declining");
  }
}

const receiveSchema = z.object({
  id: cuid,
  items: z
    .array(z.object({ itemId: cuid, condition: z.enum(ReturnCondition), restock: z.boolean() }))
    .min(1)
    .max(100),
});

export async function receiveReturnAction(input: z.input<typeof receiveSchema>): Promise<ActionResult> {
  const user = await requirePermission("returns.manage");
  const parsed = receiveSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const { ret, restocked } = await receiveReturn(user, parsed.data.id, parsed.data.items);
    await revalidateReturn(parsed.data.id);
    return done(`${ret.number} received — ${restocked} restocked`);
  } catch (e) {
    return failure(e, "Receiving");
  }
}

const resolveSchema = z.object({
  id: cuid,
  resolution: z.enum(ReturnResolution),
  waiveFee: z.boolean().default(false),
  note: z.string().trim().max(2000).optional(),
});

export async function resolveReturnAction(input: z.input<typeof resolveSchema>): Promise<ActionResult> {
  const user = await requirePermission("returns.manage");
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const out = await resolveReturn(user, parsed.data.id, parsed.data);
    await revalidateReturn(parsed.data.id);
    if (out.kind === "exchanged") return done(`${out.ret.number} exchanged — replacement ${out.replacement?.number} is ready to pack`);
    if (out.kind === "credited") return done(`${out.ret.number}: ${formatMoney(out.quote?.amount ?? 0)} store credit issued (${out.card?.code})`);
    return done(`${out.ret.number}: ${formatMoney(out.quote?.amount ?? 0)} refunded`);
  } catch (e) {
    return failure(e, "Refund");
  }
}

const noteSchema = z.object({ id: cuid, note: z.string().max(5000) });

export async function saveReturnNoteAction(input: z.input<typeof noteSchema>): Promise<ActionResult> {
  const user = await requirePermission("returns.manage");
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    await updateReturnNote(user, parsed.data.id, parsed.data.note);
  } catch (e) {
    return failure(e, "Saving the note");
  }
  revalidatePath(`/admin/returns/${parsed.data.id}`);
  return done("Note saved");
}

/** Return policy lives with the store settings, so it needs settings.manage as well. */
export async function saveReturnPolicyAction(input: z.input<typeof returnSettingsSchema>): Promise<ActionResult> {
  const user = await requirePermission("returns.manage", "settings.manage");
  const parsed = returnSettingsSchema.strict().safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const value = await saveReturnSettings(parsed.data);
  await audit(user.id, "settings.returns", "Setting", "returns", value);
  revalidatePath("/admin/returns");
  return done("Return policy saved");
}
