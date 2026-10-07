"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import {
  PurchasingError,
  addPoLines,
  cancelPurchaseOrder,
  createDraftFromSuggestions,
  createPurchaseOrder,
  markOrdered,
  receivePurchaseOrder,
  removePoLine,
  updatePoDetails,
  updatePoLine,
} from "@/server/purchasing";
import { cuid, done, fail, isUniqueViolation, zodMessage } from "@/lib/admin-server";
import { toMinor, type ActionResult } from "@/lib/admin-shared";
import type { VariantOption } from "@/components/admin/inventory/types";

function revalidatePurchasing(poId?: string) {
  revalidatePath("/admin/purchasing");
  if (poId) revalidatePath(`/admin/purchasing/${poId}`);
  revalidatePath("/admin/suppliers");
  revalidatePath("/admin/inventory");
}

/** Converts known business-rule errors into a failed result; anything else is a real bug and propagates. */
async function guarded(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PurchasingError) return fail(e.message);
    throw e;
  }
}

const optionalText = (max: number) => z.string().trim().max(max);
const optionalDate = z
  .string()
  .trim()
  .transform((s, ctx) => {
    if (!s) return null;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Invalid date" });
      return z.NEVER;
    }
    return d;
  });

// ─────────────────────────────── Suppliers ───────────────────────────────

const supplierSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(2, "At least 2 characters").max(120),
  contactName: optionalText(120),
  email: z.union([z.literal(""), z.email("Invalid email").trim().max(200)]),
  phone: optionalText(40),
  leadTimeDays: z.number().int("Whole days").min(0).max(365),
  notes: optionalText(2000),
  isActive: z.boolean(),
});

export async function saveSupplier(input: z.input<typeof supplierSchema>): Promise<ActionResult> {
  const user = await requirePermission("purchasing.manage");
  const parsed = supplierSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { id, ...s } = parsed.data;
  const data = {
    name: s.name,
    contactName: s.contactName || null,
    email: s.email || null,
    phone: s.phone || null,
    leadTimeDays: s.leadTimeDays,
    notes: s.notes || null,
    isActive: s.isActive,
  };
  try {
    const saved = id ? await db.supplier.update({ where: { id }, data, select: { id: true } }) : await db.supplier.create({ data, select: { id: true } });
    await audit(user.id, id ? "supplier.update" : "supplier.create", "Supplier", saved.id, data);
    revalidatePurchasing();
    return done(id ? `${data.name} saved` : `${data.name} added`, saved.id);
  } catch (e) {
    if (isUniqueViolation(e)) return fail("A supplier with that name already exists.");
    throw e;
  }
}

const activeSchema = z.object({ id: cuid, isActive: z.boolean() });

export async function setSupplierActive(input: z.input<typeof activeSchema>): Promise<ActionResult> {
  const user = await requirePermission("purchasing.manage");
  const parsed = activeSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const res = await db.supplier.updateMany({ where: { id: parsed.data.id }, data: { isActive: parsed.data.isActive } });
  if (!res.count) return fail("Supplier not found.");
  await audit(user.id, parsed.data.isActive ? "supplier.activate" : "supplier.deactivate", "Supplier", parsed.data.id);
  revalidatePurchasing();
  return done(parsed.data.isActive ? "Supplier reactivated" : "Supplier deactivated");
}

// ─────────────────────────────── Variant picker ───────────────────────────────

const searchSchema = z.object({ q: z.string().trim().max(80), supplierId: z.string().max(64).optional() });

/** Variant search for the PO line picker. Preferred-supplier matches first. */
export async function searchVariants(input: z.input<typeof searchSchema>): Promise<VariantOption[]> {
  await requirePermission("purchasing.manage");
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) return [];
  const { q, supplierId } = parsed.data;
  const contains = { contains: q, mode: "insensitive" as const };
  const rows = await db.productVariant.findMany({
    where: {
      product: { isGiftCard: false },
      ...(q ? { OR: [{ sku: contains }, { label: contains }, { barcode: { equals: q } }, { product: { name: contains } }] } : supplierId ? { supplierId } : {}),
    },
    orderBy: [{ product: { name: "asc" } }, { position: "asc" }],
    take: 30,
    select: { id: true, sku: true, label: true, costPrice: true, stock: true, supplierId: true, product: { select: { name: true } } },
  });
  return rows
    .map((r) => ({ id: r.id, sku: r.sku, label: r.label, product: r.product.name, costPrice: r.costPrice, stock: r.stock, supplierId: r.supplierId }))
    .sort((a, b) => Number(b.supplierId === supplierId) - Number(a.supplierId === supplierId))
    .slice(0, 20);
}

// ─────────────────────────────── Purchase orders ───────────────────────────────

const createSchema = z.object({ supplierId: cuid, notes: optionalText(2000), expectedAt: optionalDate });

export async function createPo(input: z.input<typeof createSchema>): Promise<ActionResult> {
  const user = await requirePermission("purchasing.manage");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  return guarded(async () => {
    const po = await createPurchaseOrder({ ...parsed.data, actorId: user.id });
    await audit(user.id, "po.create", "PurchaseOrder", po.id, { number: po.number, supplierId: parsed.data.supplierId });
    revalidatePurchasing();
    return done(`${po.number} created`, po.id);
  });
}

const fromSuggestionSchema = z.object({ supplierId: cuid });

export async function createPoFromSuggestions(input: z.input<typeof fromSuggestionSchema>): Promise<ActionResult> {
  const user = await requirePermission("purchasing.manage");
  const parsed = fromSuggestionSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  return guarded(async () => {
    const po = await createDraftFromSuggestions(parsed.data.supplierId, user.id);
    await audit(user.id, "po.create", "PurchaseOrder", po.id, { number: po.number, supplierId: parsed.data.supplierId, fromSuggestions: true, lines: po.lines });
    revalidatePurchasing();
    return done(`${po.number} drafted with ${po.lines} line${po.lines === 1 ? "" : "s"}`, po.id);
  });
}

const qty = z.number().int("Whole units only").min(1, "At least 1").max(1_000_000);
const rupees = z.number().min(0).max(10_000_000);

const addLineSchema = z.object({ poId: cuid, variantId: cuid, quantity: qty, unitCost: rupees.nullable() });

export async function addPoLine(input: z.input<typeof addLineSchema>): Promise<ActionResult> {
  const user = await requirePermission("purchasing.manage");
  const parsed = addLineSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { poId, variantId, quantity, unitCost } = parsed.data;
  return guarded(async () => {
    const po = await addPoLines(poId, [{ variantId, quantity, unitCost: unitCost === null ? null : toMinor(unitCost) }]);
    await audit(user.id, "po.line.add", "PurchaseOrder", poId, { number: po.number, variantId, quantity, unitCost });
    revalidatePurchasing(poId);
    return done("Line added");
  });
}

const updateLineSchema = z.object({ itemId: cuid, quantity: qty, unitCost: rupees });

export async function updatePoItem(input: z.input<typeof updateLineSchema>): Promise<ActionResult> {
  const user = await requirePermission("purchasing.manage");
  const parsed = updateLineSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { itemId, quantity, unitCost } = parsed.data;
  return guarded(async () => {
    const po = await updatePoLine(itemId, { quantity, unitCost: toMinor(unitCost) });
    await audit(user.id, "po.line.update", "PurchaseOrder", po.id, { number: po.number, itemId, quantity, unitCost });
    revalidatePurchasing(po.id);
    return done("Line updated");
  });
}

const itemSchema = z.object({ itemId: cuid });

export async function removePoItem(input: z.input<typeof itemSchema>): Promise<ActionResult> {
  const user = await requirePermission("purchasing.manage");
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  return guarded(async () => {
    const po = await removePoLine(parsed.data.itemId);
    await audit(user.id, "po.line.remove", "PurchaseOrder", po.id, { number: po.number, variantId: po.variantId });
    revalidatePurchasing(po.id);
    return done("Line removed");
  });
}

const detailsSchema = z.object({ poId: cuid, notes: optionalText(2000), expectedAt: optionalDate });

export async function savePoDetails(input: z.input<typeof detailsSchema>): Promise<ActionResult> {
  const user = await requirePermission("purchasing.manage");
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { poId, notes, expectedAt } = parsed.data;
  return guarded(async () => {
    const po = await updatePoDetails(poId, { notes: notes || null, expectedAt });
    await audit(user.id, "po.update", "PurchaseOrder", poId, { number: po.number, expectedAt: expectedAt?.toISOString() ?? null });
    revalidatePurchasing(poId);
    return done("Details saved");
  });
}

const poSchema = z.object({ poId: cuid });

export async function markPoOrdered(input: z.input<typeof poSchema>): Promise<ActionResult> {
  const user = await requirePermission("purchasing.manage");
  const parsed = poSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  return guarded(async () => {
    const po = await markOrdered(parsed.data.poId);
    await audit(user.id, "po.ordered", "PurchaseOrder", parsed.data.poId, { number: po.number });
    revalidatePurchasing(parsed.data.poId);
    return done(`${po.number} marked as ordered`);
  });
}

export async function cancelPo(input: z.input<typeof poSchema>): Promise<ActionResult> {
  const user = await requirePermission("purchasing.manage");
  const parsed = poSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  return guarded(async () => {
    const po = await cancelPurchaseOrder(parsed.data.poId);
    await audit(user.id, "po.cancel", "PurchaseOrder", parsed.data.poId, { number: po.number, from: po.status });
    revalidatePurchasing(parsed.data.poId);
    return done(`${po.number} cancelled`);
  });
}

const receiveSchema = z.object({
  poId: cuid,
  overReceive: z.boolean(),
  lines: z.array(z.object({ itemId: cuid, quantity: z.number().int("Whole units only").min(0).max(1_000_000) })).max(500),
});

export async function receivePo(input: z.input<typeof receiveSchema>): Promise<ActionResult> {
  const user = await requirePermission("purchasing.manage");
  const parsed = receiveSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { poId, overReceive, lines } = parsed.data;
  return guarded(async () => {
    const r = await receivePurchaseOrder(poId, lines, { actorId: user.id, overReceive });
    await audit(user.id, "po.receive", "PurchaseOrder", poId, { number: r.number, status: r.status, overReceive, lines: r.lines });
    revalidatePurchasing(poId);
    revalidatePath("/", "layout");
    return done(`${r.units} unit${r.units === 1 ? "" : "s"} received · ${r.number} ${r.status === "RECEIVED" ? "complete" : "partially received"}`);
  });
}
