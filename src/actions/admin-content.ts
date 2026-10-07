"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { cuid, done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";

function revalidateContent() {
  revalidatePath("/admin/content");
  revalidatePath("/");
}

const toggleSchema = z.object({ id: cuid, enabled: z.boolean() });

export async function setBlockEnabled(input: z.input<typeof toggleSchema>): Promise<ActionResult> {
  const user = await requirePermission("content.edit");
  const parsed = toggleSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const updated = await db.contentBlock.updateMany({ where: { id: parsed.data.id }, data: { enabled: parsed.data.enabled } });
  if (!updated.count) return fail("Block not found.");
  await audit(user.id, parsed.data.enabled ? "content.enable" : "content.disable", "ContentBlock", parsed.data.id);
  revalidateContent();
  return done(parsed.data.enabled ? "Block shown" : "Block hidden");
}

const moveSchema = z.object({ id: cuid, direction: z.enum(["up", "down"]) });

export async function moveBlock(input: z.input<typeof moveSchema>): Promise<ActionResult> {
  const user = await requirePermission("content.edit");
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const block = await db.contentBlock.findUnique({ where: { id: parsed.data.id } });
  if (!block) return fail("Block not found.");

  const siblings = await db.contentBlock.findMany({ where: { page: block.page }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true } });
  const idx = siblings.findIndex((b) => b.id === block.id);
  const target = parsed.data.direction === "up" ? idx - 1 : idx + 1;
  if (target < 0 || target >= siblings.length) return done();
  const order = siblings.map((b) => b.id);
  [order[idx], order[target]] = [order[target], order[idx]];

  // Rewrite positions densely so duplicates from older data can't make moves no-ops.
  await db.$transaction(order.map((id, position) => db.contentBlock.update({ where: { id }, data: { position } })));
  await audit(user.id, "content.move", "ContentBlock", block.id, { direction: parsed.data.direction, type: block.type });
  revalidateContent();
  return done();
}

const jsonValue: z.ZodType<Prisma.InputJsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.array(jsonValue), z.record(z.string(), jsonValue)]),
);
const dataSchema = z.object({ id: cuid, data: z.record(z.string(), jsonValue) });

export async function saveBlockData(input: { id: string; data: unknown }): Promise<ActionResult> {
  const user = await requirePermission("content.edit");
  const parsed = dataSchema.safeParse(input);
  if (!parsed.success) return fail(`Block data must be a JSON object without nulls. ${zodMessage(parsed.error)}`);
  if (JSON.stringify(parsed.data.data).length > 20_000) return fail("Block data is too large.");
  const updated = await db.contentBlock.updateMany({ where: { id: parsed.data.id }, data: { data: parsed.data.data } });
  if (!updated.count) return fail("Block not found.");
  await audit(user.id, "content.update", "ContentBlock", parsed.data.id, { data: parsed.data.data });
  revalidateContent();
  return done("Block saved");
}
