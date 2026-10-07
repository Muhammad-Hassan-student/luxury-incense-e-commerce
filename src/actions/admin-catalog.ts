"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Model3D, ScentFamily } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { cuid, done, fail, isUniqueViolation, zodMessage } from "@/lib/admin-server";
import { toMinor, type ActionResult } from "@/lib/admin-shared";

const list = z.array(z.string().trim().min(1).max(60)).max(30);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #RRGGBB colour");

const variantSchema = z
  .object({
    id: z.string().max(64).optional(),
    sku: z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9._-]+$/, "Letters, numbers, . _ - only"),
    label: z.string().trim().min(1).max(60),
    /** Major units, e.g. 1290.00 */
    price: z.number().min(0).max(10_000_000),
    compareAtPrice: z.number().min(0).max(10_000_000).nullable(),
    weightGrams: z.number().int().min(0).max(100_000),
  })
  .refine((v) => v.compareAtPrice === null || v.compareAtPrice > v.price, {
    message: "Compare-at price must be higher than the price",
    path: ["compareAtPrice"],
  });

const productSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, numbers and dashes"),
  subtitle: z.string().trim().max(200),
  story: z.string().trim().max(10_000),
  categoryId: cuid,
  family: z.enum(ScentFamily),
  intensity: z.number().int().min(1).max(5),
  model: z.enum(Model3D),
  palette: z.tuple([hex, hex]),
  topNotes: list,
  heartNotes: list,
  baseNotes: list,
  moods: list,
  timeOfDay: list,
  burnTime: z.string().trim().max(100).nullable(),
  origin: z.string().trim().max(100).nullable(),
  isFeatured: z.boolean(),
  isBestseller: z.boolean(),
  isActive: z.boolean(),
  variants: z.array(variantSchema).min(1, "Add at least one variant").max(30),
});

export type ProductInput = z.input<typeof productSchema>;

function revalidateCatalog(productId?: string) {
  revalidatePath("/admin/products");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin");
  if (productId) revalidatePath(`/admin/products/${productId}`);
  // Storefront: listing, product pages, home sections.
  revalidatePath("/", "layout");
}

export async function saveProduct(input: ProductInput): Promise<ActionResult> {
  const user = await requirePermission("catalog.edit");
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { id, variants, ...p } = parsed.data;

  const skus = variants.map((v) => v.sku.toUpperCase());
  if (new Set(skus).size !== skus.length) return fail("Each variant needs a unique SKU.");
  const category = await db.category.findUnique({ where: { id: p.categoryId }, select: { id: true } });
  if (!category) return fail("Choose a category.");

  const data = {
    ...p,
    burnTime: p.burnTime || null,
    origin: p.origin || null,
    palette: [...p.palette],
  };
  const variantData = (v: (typeof variants)[number], position: number) => ({
    sku: v.sku,
    label: v.label,
    price: toMinor(v.price),
    compareAtPrice: v.compareAtPrice === null ? null : toMinor(v.compareAtPrice),
    weightGrams: v.weightGrams,
    position,
  });

  try {
    const productId = await db.$transaction(async (tx) => {
      if (!id) {
        const created = await tx.product.create({
          data: { ...data, variants: { create: variants.map((v, i) => variantData(v, i)) } },
          select: { id: true },
        });
        return created.id;
      }

      const existing = await tx.product.findUnique({ where: { id }, include: { variants: { select: { id: true, reserved: true } } } });
      if (!existing) throw new Error("NOT_FOUND");
      await tx.product.update({ where: { id }, data });

      const keep = new Set(variants.map((v) => v.id).filter((x): x is string => Boolean(x)));
      const ownIds = new Set(existing.variants.map((v) => v.id));
      for (const k of keep) if (!ownIds.has(k)) throw new Error("FOREIGN_VARIANT");

      const removedRows = existing.variants.filter((v) => !keep.has(v.id));
      const removed = removedRows.map((v) => v.id);
      if (removedRows.some((v) => v.reserved > 0)) throw new Error("VARIANT_IN_USE");
      if (removed.length) {
        // Variants on open orders or subscriptions must not vanish from under them.
        const inUse = await tx.subscription.count({ where: { variantId: { in: removed }, status: { not: "CANCELLED" } } });
        if (inUse) throw new Error("VARIANT_IN_USE");
        await tx.productVariant.deleteMany({ where: { id: { in: removed } } });
      }
      // Free up SKUs first so renames/swaps between variants don't collide.
      for (const v of variants) {
        if (v.id) await tx.productVariant.update({ where: { id: v.id }, data: { sku: `__tmp_${v.id}` } });
      }
      for (const [i, v] of variants.entries()) {
        if (v.id) await tx.productVariant.update({ where: { id: v.id }, data: variantData(v, i) });
        else await tx.productVariant.create({ data: { ...variantData(v, i), productId: id } });
      }
      return id;
    });

    await audit(user.id, id ? "product.update" : "product.create", "Product", productId, {
      slug: p.slug,
      variants: variants.map((v) => v.sku),
    });
    revalidateCatalog(productId);
    return done(id ? "Product saved" : "Product created", productId);
  } catch (e) {
    if (isUniqueViolation(e)) return fail("That slug or SKU is already in use.");
    if (e instanceof Error && e.message === "NOT_FOUND") return fail("Product not found.");
    if (e instanceof Error && e.message === "FOREIGN_VARIANT") return fail("A variant does not belong to this product.");
    if (e instanceof Error && e.message === "VARIANT_IN_USE") return fail("A removed variant is held by a pending order or an active subscription — keep it for now.");
    throw e;
  }
}

const toggleSchema = z.object({ id: cuid, isActive: z.boolean() });

export async function setProductActive(input: z.input<typeof toggleSchema>): Promise<ActionResult> {
  const user = await requirePermission("catalog.edit");
  const parsed = toggleSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const updated = await db.product.updateMany({ where: { id: parsed.data.id }, data: { isActive: parsed.data.isActive } });
  if (!updated.count) return fail("Product not found.");
  await audit(user.id, parsed.data.isActive ? "product.activate" : "product.deactivate", "Product", parsed.data.id);
  revalidateCatalog(parsed.data.id);
  return done(parsed.data.isActive ? "Product is live" : "Product hidden");
}
