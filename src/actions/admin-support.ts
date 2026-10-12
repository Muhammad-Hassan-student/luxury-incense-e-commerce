"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SupportPriority, SupportStatus } from "@/generated/prisma/enums";
import { requirePermission } from "@/server/roles";
import { createTicket, deleteMacro, mergeTickets, saveMacro, staffReply, SupportError, updateTicket } from "@/server/support";
import { cuid, done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";

/* Staff side of the support desk: every action = zod + support.manage + audit (in src/server/support). */

function failure(e: unknown, what: string): ActionResult {
  if (e instanceof SupportError) return fail(e.message);
  console.error(`[support] ${what} failed`, e);
  return fail(`${what} failed.`);
}

const refresh = (id?: string) => {
  revalidatePath("/admin/support");
  if (id) revalidatePath(`/admin/support/${id}`);
};

const replySchema = z.object({
  id: cuid,
  body: z.string().trim().min(1, "Write a reply first.").max(8000),
  internal: z.boolean().default(false),
  status: z.enum(SupportStatus).optional(),
  attachments: z.array(z.string().max(500)).max(4).default([]),
});

export async function replyTicketAction(input: z.input<typeof replySchema>): Promise<ActionResult> {
  const user = await requirePermission("support.manage");
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const r = await staffReply(user, parsed.data.id, parsed.data);
    refresh(parsed.data.id);
    return done(parsed.data.internal ? "Note added" : r.status === "RESOLVED" ? "Replied and resolved" : "Reply sent");
  } catch (e) {
    return failure(e, "Reply");
  }
}

const updateSchema = z.object({
  id: cuid,
  status: z.enum(SupportStatus).optional(),
  priority: z.enum(SupportPriority).optional(),
  assigneeId: cuid.nullable().optional(),
  tags: z.array(z.string().trim().max(30)).max(10).optional(),
  subject: z.string().trim().min(3).max(160).optional(),
});

export async function updateTicketAction(input: z.input<typeof updateSchema>): Promise<ActionResult> {
  const user = await requirePermission("support.manage");
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { id, ...patch } = parsed.data;
  try {
    await updateTicket(user, id, patch);
    refresh(id);
    return done("Ticket updated");
  } catch (e) {
    return failure(e, "Update");
  }
}

const mergeSchema = z.object({ id: cuid, into: z.coerce.number().int().positive().max(2 ** 31 - 1) });

export async function mergeTicketAction(input: z.input<typeof mergeSchema>): Promise<ActionResult> {
  const user = await requirePermission("support.manage");
  const parsed = mergeSchema.safeParse(input);
  if (!parsed.success) return fail("Enter the number of the ticket to merge into.");
  try {
    const r = await mergeTickets(user, parsed.data.id, parsed.data.into);
    refresh(parsed.data.id);
    refresh(r.targetId);
    return done(`Merged into #${r.number}`, r.targetId);
  } catch (e) {
    return failure(e, "Merge");
  }
}

const logSchema = z.object({
  subject: z.string().trim().min(3).max(160),
  body: z.string().trim().min(2).max(5000),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  phone: z.string().trim().max(20).optional(),
  name: z.string().trim().max(120).optional(),
  orderNumber: z.string().trim().max(40).optional(),
  priority: z.enum(SupportPriority).default("NORMAL"),
  channel: z.enum(["email", "whatsapp", "admin"]).default("email"),
});

/** Staff logs a request that arrived by email or phone. */
export async function logTicketAction(input: z.input<typeof logSchema>): Promise<ActionResult> {
  const user = await requirePermission("support.manage");
  const parsed = logSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const d = parsed.data;
  try {
    const t = await createTicket({ source: d.channel, subject: d.subject, body: d.body, email: d.email || null, phone: d.phone || null, name: d.name || null, orderNumber: d.orderNumber || null, priority: d.priority, createdBy: user, quiet: true });
    refresh(t.id);
    return done(`Ticket ${t.reference} created`, t.id);
  } catch (e) {
    return failure(e, "Creating the ticket");
  }
}

const macroSchema = z.object({ id: cuid.nullish(), title: z.string().trim().min(2).max(80), body: z.string().trim().min(2).max(5000) });

export async function saveMacroAction(input: z.input<typeof macroSchema>): Promise<ActionResult> {
  const user = await requirePermission("support.manage");
  const parsed = macroSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const m = await saveMacro(user, parsed.data);
    revalidatePath("/admin/support/macros");
    return done("Canned reply saved", m.id);
  } catch (e) {
    return failure(e, "Saving");
  }
}

export async function deleteMacroAction(id: string): Promise<ActionResult> {
  const user = await requirePermission("support.manage");
  if (!cuid.safeParse(id).success) return fail("Invalid canned reply.");
  await deleteMacro(user, id);
  revalidatePath("/admin/support/macros");
  return done("Canned reply deleted");
}
