"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { adjustStock } from "@/server/inventory";
import { cuid, done, fail, isUniqueViolation, zodMessage } from "@/lib/admin-server";
import { toMinor, type ActionResult } from "@/lib/admin-shared";

function revalidateStock() {
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/purchasing");
  revalidatePath("/admin/products");
  revalidatePath("/admin");
}

const adjustSchema = z.object({
  variantId: cuid,
  delta: z
    .number()
    .int("Whole units only")
    .min(-100_000)
    .max(100_000)
    .refine((n) => n !== 0, "Enter a non-zero amount"),
  reason: z.enum(["RESTOCK", "ADJUST"]),
});

export async function adjustInventory(input: z.input<typeof adjustSchema>): Promise<ActionResult> {
  const user = await requirePermission("inventory.adjust");
  const parsed = adjustSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { variantId, delta, reason } = parsed.data;
  if (reason === "RESTOCK" && delta < 0) return fail("A restock must add stock. Use Adjust to remove.");

  // Lock the row so the reserved check and the update see the same figures.
  type Outcome = { ok: false; error: string } | { ok: true; sku: string; before: number };
  const result = await db.$transaction(async (tx): Promise<Outcome> => {
    const rows = await tx.$queryRaw<{ sku: string; stock: number; reserved: number }[]>`
      SELECT sku, stock, reserved FROM "ProductVariant" WHERE id = ${variantId} FOR UPDATE`;
    const v = rows[0];
    if (!v) return { ok: false, error: "Variant not found." };
    if (v.stock + delta < v.reserved) return { ok: false, error: `Stock can't drop below the ${v.reserved} units held for pending orders.` };
    await adjustStock(tx, variantId, delta, reason, user.id);
    return { ok: true, sku: v.sku, before: v.stock };
  });
  if (!result.ok) return fail(result.error);

  await audit(user.id, "inventory.adjust", "ProductVariant", variantId, { sku: result.sku, delta, reason, before: result.before });
  revalidateStock();
  revalidatePath("/", "layout");
  return done(`${result.sku}: ${delta > 0 ? "+" : ""}${delta}`);
}

const optionalInt = (max: number) => z.number().int("Whole units only").min(0).max(max).nullable();

const settingsSchema = z.object({
  variantId: cuid,
  /** Rupees (major units); null = unknown. */
  costPrice: z.number().min(0).max(10_000_000).nullable(),
  reorderPoint: optionalInt(1_000_000),
  reorderQty: z.number().int("Whole units only").min(1, "At least 1").max(1_000_000).nullable(),
  barcode: z
    .string()
    .trim()
    .max(64)
    .refine((s) => s === "" || /^[A-Za-z0-9._-]{3,64}$/.test(s), "3–64 letters, digits, dot, dash or underscore"),
  supplierId: z.string().max(64).nullable(),
});

/** Cost price, reorder point/qty, barcode and preferred supplier for one variant. */
export async function updateVariantInventory(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  const user = await requirePermission("inventory.adjust");
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { variantId, ...f } = parsed.data;

  const before = await db.productVariant.findUnique({
    where: { id: variantId },
    select: { sku: true, costPrice: true, reorderPoint: true, reorderQty: true, barcode: true, supplierId: true },
  });
  if (!before) return fail("Variant not found.");
  if (f.supplierId) {
    const s = await db.supplier.findUnique({ where: { id: f.supplierId }, select: { id: true } });
    if (!s) return fail("Supplier not found.");
  }
  const data = {
    costPrice: f.costPrice === null ? null : toMinor(f.costPrice),
    reorderPoint: f.reorderPoint,
    reorderQty: f.reorderQty,
    barcode: f.barcode || null,
    supplierId: f.supplierId || null,
  };
  try {
    await db.productVariant.update({ where: { id: variantId }, data });
  } catch (e) {
    if (isUniqueViolation(e)) return fail("That barcode is already used by another variant.");
    throw e;
  }
  const { sku, ...prev } = before;
  await audit(user.id, "inventory.settings", "ProductVariant", variantId, { sku, before: prev, after: data });
  revalidateStock();
  return done(`${sku} saved`);
}
