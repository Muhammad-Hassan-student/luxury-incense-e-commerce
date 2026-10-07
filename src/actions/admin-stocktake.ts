"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { StockTakeError, cancelStockTake, completeStockTake, createStockTake, saveCounts, type StockTakeScope } from "@/server/stocktake";
import { cuid, done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";

function revalidateTakes(id?: string) {
  revalidatePath("/admin/stocktakes");
  if (id) revalidatePath(`/admin/stocktakes/${id}`);
}

async function guarded(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof StockTakeError) return fail(e.message);
    throw e;
  }
}

const createSchema = z
  .object({
    name: z.string().trim().min(2, "At least 2 characters").max(120),
    note: z.string().trim().max(1000),
    scope: z.enum(["all", "category", "supplier"]),
    categoryId: z.string().max(64).optional(),
    supplierId: z.string().max(64).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.scope === "category" && !v.categoryId) ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Choose a category" });
    if (v.scope === "supplier" && !v.supplierId) ctx.addIssue({ code: "custom", path: ["supplierId"], message: "Choose a supplier" });
  });

export async function startStockTake(input: z.input<typeof createSchema>): Promise<ActionResult> {
  const user = await requirePermission("stocktake.manage");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const v = parsed.data;
  const scope: StockTakeScope =
    v.scope === "category" ? { kind: "category", categoryId: v.categoryId! } : v.scope === "supplier" ? { kind: "supplier", supplierId: v.supplierId! } : { kind: "all" };
  return guarded(async () => {
    const t = await createStockTake({ name: v.name, note: v.note, scope, actorId: user.id });
    await audit(user.id, "stocktake.create", "StockTake", t.id, { name: t.name, scope, lines: t.lines });
    revalidateTakes();
    return done(`${t.name}: ${t.lines} lines to count`, t.id);
  });
}

const countsSchema = z.object({
  id: cuid,
  counts: z
    .array(z.object({ lineId: cuid, counted: z.number().int("Whole units only").min(0).max(1_000_000).nullable() }))
    .min(1)
    .max(5000),
});

export async function saveStockTakeCounts(input: z.input<typeof countsSchema>): Promise<ActionResult> {
  const user = await requirePermission("stocktake.manage");
  const parsed = countsSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  return guarded(async () => {
    const r = await saveCounts(parsed.data.id, parsed.data.counts);
    await audit(user.id, "stocktake.count", "StockTake", parsed.data.id, { lines: r.saved });
    revalidateTakes(parsed.data.id);
    return done(`${r.saved} count${r.saved === 1 ? "" : "s"} saved`);
  });
}

const completeSchema = z.object({ id: cuid, acknowledgeDrift: z.boolean() });

export async function finishStockTake(input: z.input<typeof completeSchema>): Promise<ActionResult> {
  const user = await requirePermission("stocktake.manage");
  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  return guarded(async () => {
    const r = await completeStockTake(parsed.data.id, { actorId: user.id, acknowledgeDrift: parsed.data.acknowledgeDrift });
    await audit(user.id, "stocktake.complete", "StockTake", parsed.data.id, { name: r.name, counted: r.counted, adjusted: r.adjusted, units: r.units, value: r.value, drifted: r.drifted, applied: r.applied });
    revalidateTakes(parsed.data.id);
    revalidatePath("/admin/inventory");
    revalidatePath("/", "layout");
    return done(`${r.name} completed · ${r.adjusted} adjustment${r.adjusted === 1 ? "" : "s"} applied`);
  });
}

const idSchema = z.object({ id: cuid });

export async function discardStockTake(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const user = await requirePermission("stocktake.manage");
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  return guarded(async () => {
    const t = await cancelStockTake(parsed.data.id);
    await audit(user.id, "stocktake.cancel", "StockTake", parsed.data.id, { name: t.name });
    revalidateTakes(parsed.data.id);
    return done(`${t.name} cancelled`);
  });
}
