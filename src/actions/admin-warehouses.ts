"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import {
  WarehouseError,
  cancelTransfer,
  createTransfer,
  createWarehouse,
  dispatchTransfer,
  receiveTransfer,
  setDefaultWarehouse,
  setTransferLines,
  setWarehouseReorderPoint,
  updateWarehouse,
} from "@/server/warehouses";
import { stockByWarehouse } from "@/server/warehouses";
import { cuid, done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";

function revalidateStock(extra?: string) {
  revalidatePath("/admin/warehouses");
  revalidatePath("/admin/transfers");
  revalidatePath("/admin/inventory");
  if (extra) revalidatePath(extra);
}

async function guarded(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof WarehouseError) return fail(e.message);
    throw e;
  }
}

const warehouseSchema = z.object({
  id: cuid.optional(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,11}$/, "2–12 letters, digits or dashes"),
  name: z.string().trim().min(2, "At least 2 characters").max(80),
  address: z.string().trim().max(200),
  city: z.string().trim().max(60),
  state: z.string().trim().max(60),
  pincode: z.string().trim().regex(/^(\d{6})?$/, "Six digits"),
  priority: z.number().int().min(0).max(1000),
  pickupLocation: z.string().trim().max(80),
  active: z.boolean(),
});

export async function saveWarehouse(input: z.input<typeof warehouseSchema>): Promise<ActionResult> {
  const user = await requirePermission("inventory.adjust");
  const parsed = warehouseSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { id, ...data } = parsed.data;
  return guarded(async () => {
    const w = id ? await updateWarehouse(id, data) : await createWarehouse(data);
    await audit(user.id, id ? "warehouse.update" : "warehouse.create", "Warehouse", w.id, { ...data });
    revalidateStock(`/admin/warehouses/${w.id}`);
    return done(`${w.code} saved`, w.id);
  });
}

const idSchema = z.object({ id: cuid });

export async function makeDefaultWarehouse(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const user = await requirePermission("inventory.adjust");
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  return guarded(async () => {
    const w = await setDefaultWarehouse(parsed.data.id);
    await audit(user.id, "warehouse.default", "Warehouse", w.id, { code: w.code });
    revalidateStock(`/admin/warehouses/${w.id}`);
    return done(`${w.code} is now the default warehouse`);
  });
}

const reorderSchema = z.object({ warehouseId: cuid, variantId: cuid, reorderPoint: z.number().int().min(0).max(1_000_000).nullable() });

export async function saveLocationReorderPoint(input: z.input<typeof reorderSchema>): Promise<ActionResult> {
  const user = await requirePermission("inventory.adjust");
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { warehouseId, variantId, reorderPoint } = parsed.data;
  if (!(await db.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true } }))) return fail("Warehouse not found.");
  if (!(await db.productVariant.findUnique({ where: { id: variantId }, select: { id: true } }))) return fail("Variant not found.");
  await setWarehouseReorderPoint(warehouseId, variantId, reorderPoint);
  await audit(user.id, "warehouse.reorder_point", "WarehouseStock", `${warehouseId}:${variantId}`, { reorderPoint });
  revalidatePath(`/admin/warehouses/${warehouseId}`);
  return done(reorderPoint === null ? "Using the variant's reorder point" : `Low-stock level set to ${reorderPoint}`);
}

// ─────────────────────────────── Transfers ───────────────────────────────

const lineSchema = z.object({ variantId: cuid, quantity: z.number().int("Whole units only").min(1).max(1_000_000) });

const transferSchema = z
  .object({
    fromId: cuid,
    toId: cuid,
    note: z.string().trim().max(1000),
    lines: z.array(lineSchema).min(1, "Add at least one line").max(500),
  })
  .refine((v) => v.fromId !== v.toId, { message: "Pick two different warehouses", path: ["toId"] });

export async function createStockTransfer(input: z.input<typeof transferSchema>): Promise<ActionResult> {
  const user = await requirePermission("inventory.adjust");
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  return guarded(async () => {
    const t = await createTransfer({ ...parsed.data, actorId: user.id });
    await audit(user.id, "transfer.create", "StockTransfer", t.id, { number: t.number, fromId: parsed.data.fromId, toId: parsed.data.toId, lines: parsed.data.lines });
    revalidateStock();
    return done(`${t.number} drafted`, t.id);
  });
}

const linesSchema = z.object({ id: cuid, lines: z.array(lineSchema).min(1, "Add at least one line").max(500) });

export async function saveTransferLines(input: z.input<typeof linesSchema>): Promise<ActionResult> {
  const user = await requirePermission("inventory.adjust");
  const parsed = linesSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  return guarded(async () => {
    const t = await setTransferLines(parsed.data.id, parsed.data.lines);
    await audit(user.id, "transfer.lines", "StockTransfer", t.id, { number: t.number, lines: parsed.data.lines });
    revalidatePath(`/admin/transfers/${t.id}`);
    return done("Lines saved");
  });
}

const STEP = {
  dispatch: { fn: dispatchTransfer, verb: "dispatched" },
  receive: { fn: receiveTransfer, verb: "received" },
} as const;

const stepSchema = z.object({ id: cuid, step: z.enum(["dispatch", "receive", "cancel"]) });

export async function advanceTransfer(input: z.input<typeof stepSchema>): Promise<ActionResult> {
  const user = await requirePermission("inventory.adjust");
  const parsed = stepSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { id, step } = parsed.data;
  return guarded(async () => {
    if (step === "cancel") {
      const r = await cancelTransfer(id, user.id);
      await audit(user.id, "transfer.cancel", "StockTransfer", id, { number: r.number, returnedToSource: r.returned });
      revalidateStock(`/admin/transfers/${id}`);
      return done(`${r.number} cancelled${r.returned ? " — units back at the source" : ""}`);
    }
    const r = await STEP[step].fn(id, user.id);
    await audit(user.id, `transfer.${step}`, "StockTransfer", id, { number: r.number, lines: r.lines, units: r.units });
    revalidateStock(`/admin/transfers/${id}`);
    revalidatePath("/", "layout");
    return done(`${r.number} ${STEP[step].verb} · ${r.units} unit${r.units === 1 ? "" : "s"}`);
  });
}

const searchSchema = z.object({ q: z.string().trim().max(80), warehouseId: cuid });

export type TransferVariantOption = { id: string; sku: string; label: string; product: string; available: number };

/** Variant search for the transfer builder, with free units in the source warehouse. */
export async function searchTransferVariants(input: z.input<typeof searchSchema>): Promise<TransferVariantOption[]> {
  await requirePermission("inventory.view");
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) return [];
  const { q, warehouseId } = parsed.data;
  const contains = { contains: q, mode: "insensitive" as const };
  const rows = await db.productVariant.findMany({
    where: { product: { isGiftCard: false }, ...(q ? { OR: [{ sku: contains }, { label: contains }, { barcode: { equals: q } }, { product: { name: contains } }] } : {}) },
    orderBy: [{ product: { name: "asc" } }, { position: "asc" }],
    take: 25,
    select: { id: true, sku: true, label: true, product: { select: { name: true } } },
  });
  const split = await stockByWarehouse(rows.map((r) => r.id));
  return rows.map((r) => {
    const here = split.get(r.id)?.get(warehouseId);
    return { id: r.id, sku: r.sku, label: r.label, product: r.product.name, available: Math.max(0, (here?.stock ?? 0) - (here?.reserved ?? 0)) };
  });
}
