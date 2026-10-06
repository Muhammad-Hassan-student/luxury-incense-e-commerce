"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requireRole } from "@/server/roles";
import { audit } from "@/server/audit";
import { cloudinaryPoster, cloudinarySignature, deleteLocal, isAcceptableUrl } from "@/server/media";
import { cuid, done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";

const url = z.string().trim().max(2000).refine(isAcceptableUrl, "Use an https:// link or upload a file");

export async function getUploadSignature(folder: "products" | "categories" | "content") {
  await requireRole("MANAGER");
  return cloudinarySignature(`maison-oud/${folder}`);
}

async function refreshProduct(productId: string) {
  const p = await db.product.findUnique({ where: { id: productId }, select: { slug: true } });
  revalidatePath(`/admin/products/${productId}`);
  if (p) revalidatePath(`/product/${p.slug}`);
  revalidatePath("/", "layout");
}

const addSchema = z.object({
  productId: cuid,
  type: z.enum(["IMAGE", "VIDEO"]),
  url,
  poster: url.optional(),
  alt: z.string().trim().max(200),
});

export async function addProductMedia(input: z.input<typeof addSchema>): Promise<ActionResult> {
  const user = await requireRole("MANAGER");
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const d = parsed.data;
  const product = await db.product.findUnique({ where: { id: d.productId }, select: { name: true, _count: { select: { images: true } } } });
  if (!product) return fail("Product not found.");
  if (product._count.images >= 20) return fail("Up to 20 photos and videos per product.");

  const media = await db.productImage.create({
    data: {
      productId: d.productId,
      type: d.type,
      url: d.url,
      poster: d.poster ?? (d.type === "VIDEO" ? cloudinaryPoster(d.url) : null),
      alt: d.alt || product.name,
      position: product._count.images,
    },
  });
  await audit(user.id, "media.add", "Product", d.productId, { mediaId: media.id, type: d.type });
  await refreshProduct(d.productId);
  return done(d.type === "VIDEO" ? "Video added" : "Photo added", media.id);
}

export async function updateMediaAlt(id: string, alt: string): Promise<ActionResult> {
  const user = await requireRole("MANAGER");
  const parsed = z.object({ id: cuid, alt: z.string().trim().min(1, "Describe the image").max(200) }).safeParse({ id, alt });
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const media = await db.productImage.update({ where: { id }, data: { alt: parsed.data.alt } });
  await audit(user.id, "media.alt", "Product", media.productId, { mediaId: id });
  await refreshProduct(media.productId);
  return done("Description saved");
}

/** Saves a new order for a product's media (ids in display order). */
export async function reorderMedia(productId: string, ids: string[]): Promise<ActionResult> {
  const user = await requireRole("MANAGER");
  const parsed = z.object({ productId: cuid, ids: z.array(cuid).max(20) }).safeParse({ productId, ids });
  if (!parsed.success) return fail("Invalid order.");
  const existing = await db.productImage.findMany({ where: { productId }, select: { id: true } });
  if (existing.length !== ids.length || !existing.every((m) => ids.includes(m.id))) return fail("Media changed — refresh and try again.");
  await db.$transaction(ids.map((id, position) => db.productImage.update({ where: { id }, data: { position } })));
  await audit(user.id, "media.reorder", "Product", productId);
  await refreshProduct(productId);
  return done();
}

export async function deleteMedia(id: string): Promise<ActionResult> {
  const user = await requireRole("MANAGER");
  if (!cuid.safeParse(id).success) return fail("Invalid media.");
  const media = await db.productImage.delete({ where: { id } }).catch(() => null);
  if (!media) return fail("Already removed.");
  await Promise.all([deleteLocal(media.url), deleteLocal(media.poster)]);
  // Close the gap in positions.
  const rest = await db.productImage.findMany({ where: { productId: media.productId }, orderBy: { position: "asc" }, select: { id: true } });
  await db.$transaction(rest.map((m, position) => db.productImage.update({ where: { id: m.id }, data: { position } })));
  await audit(user.id, "media.delete", "Product", media.productId, { mediaId: id });
  await refreshProduct(media.productId);
  return done("Removed");
}

const heroSchema = z.object({
  categoryId: cuid,
  field: z.enum(["heroImage", "heroVideo"]),
  url: url.nullable(),
});

/** Sets or clears a category banner image/video. */
export async function setCategoryHero(input: z.input<typeof heroSchema>): Promise<ActionResult> {
  const user = await requireRole("MANAGER");
  const parsed = heroSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { categoryId, field, url: next } = parsed.data;
  const before = await db.category.findUnique({ where: { id: categoryId } });
  if (!before) return fail("Category not found.");
  const category = await db.category.update({ where: { id: categoryId }, data: { [field]: next } });
  if (before[field] && before[field] !== next) await deleteLocal(before[field]);
  await audit(user.id, next ? "category.hero.set" : "category.hero.clear", "Category", categoryId, { field });
  revalidatePath("/admin/categories");
  revalidatePath(`/shop/${category.slug}`);
  revalidatePath("/");
  return done(next ? "Banner updated" : "Banner removed");
}
