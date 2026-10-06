"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requireRole } from "@/server/roles";
import { audit } from "@/server/audit";
import { adjustStock } from "@/server/inventory";
import { cuid, done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";

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
  const user = await requireRole("MANAGER");
  const parsed = adjustSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { variantId, delta, reason } = parsed.data;
  if (reason === "RESTOCK" && delta < 0) return fail("A restock must add stock. Use Adjust to remove.");

  const variant = await db.productVariant.findUnique({ where: { id: variantId }, select: { sku: true, stock: true, reserved: true } });
  if (!variant) return fail("Variant not found.");
  if (variant.stock + delta < variant.reserved) {
    return fail(`Stock can't drop below the ${variant.reserved} units held for pending orders.`);
  }

  await db.$transaction(async (tx) => adjustStock(tx, variantId, delta, reason, user.id));
  await audit(user.id, "inventory.adjust", "ProductVariant", variantId, { sku: variant.sku, delta, reason, before: variant.stock });
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/products");
  revalidatePath("/admin");
  revalidatePath("/", "layout");
  return done(`${variant.sku}: ${delta > 0 ? "+" : ""}${delta}`);
}
