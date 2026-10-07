"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { cloudinaryPoster, cloudinarySignature, deleteLocal, isAcceptableUrl, prepareProductImage } from "@/server/media";
import { cuid, done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";

const url = z.string().trim().max(2000).refine(isAcceptableUrl, "Use an https:// link or upload a file");

export async function getUploadSignature(folder: "products" | "categories" | "content") {
  await (folder === "content" ? requirePermission("content.edit") : requirePermission("catalog.edit"));
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
  const user = await requirePermission("catalog.edit");
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const d = parsed.data;
  const product = await db.product.findUnique({ where: { id: d.productId }, select: { name: true, _count: { select: { images: true } } } });
  if (!product) return fail("Product not found.");
  if (product._count.images >= 20) return fail("Up to 20 photos and videos per product.");

  // Photos get a studio cutout when their background allows, so they sit on the theme like the product art.
  const prepared = d.type === "IMAGE" ? await prepareProductImage(d.url) : null;
  const media = await db.productImage.create({
    data: {
      productId: d.productId,
      type: d.type,
      url: d.url,
      poster: d.poster ?? (d.type === "VIDEO" ? cloudinaryPoster(d.url) : null),
      alt: d.alt || product.name,
      position: product._count.images,
      cutoutUrl: prepared?.cutoutUrl ?? null,
      edgeColor: prepared?.edgeColor ?? null,
      width: prepared?.width ?? null,
      height: prepared?.height ?? null,
    },
  });
  await audit(user.id, "media.add", "Product", d.productId, { mediaId: media.id, type: d.type, cutout: Boolean(prepared?.cutoutUrl) });
  await refreshProduct(d.productId);
  return done(d.type === "VIDEO" ? "Video added" : `Photo added · ${prepared?.note ?? ""}`, media.id);
}

export async function updateMediaAlt(id: string, alt: string): Promise<ActionResult> {
  const user = await requirePermission("catalog.edit");
  const parsed = z.object({ id: cuid, alt: z.string().trim().min(1, "Describe the image").max(200) }).safeParse({ id, alt });
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const media = await db.productImage.update({ where: { id }, data: { alt: parsed.data.alt } });
  await audit(user.id, "media.alt", "Product", media.productId, { mediaId: id });
  await refreshProduct(media.productId);
  return done("Description saved");
}

/** Saves a new order for a product's media (ids in display order). */
export async function reorderMedia(productId: string, ids: string[]): Promise<ActionResult> {
  const user = await requirePermission("catalog.edit");
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
  const user = await requirePermission("catalog.edit");
  if (!cuid.safeParse(id).success) return fail("Invalid media.");
  const media = await db.productImage.delete({ where: { id } }).catch(() => null);
  if (!media) return fail("Already removed.");
  await Promise.all([deleteLocal(media.url), deleteLocal(media.poster), deleteLocal(media.cutoutUrl)]);
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
  const user = await requirePermission("catalog.edit");
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

const displaySchema = z.object({ id: cuid, display: z.enum(["AUTO", "CUTOUT", "PHOTO"]) });

/** How a photo appears on the store: Auto (cutout when available), always Cutout, or the full Photo. */
export async function setMediaDisplay(input: z.input<typeof displaySchema>): Promise<ActionResult> {
  const user = await requirePermission("catalog.edit");
  const parsed = displaySchema.safeParse(input);
  if (!parsed.success) return fail("Invalid choice.");
  const media = await db.productImage.findUnique({ where: { id: parsed.data.id } });
  if (!media) return fail("Already removed.");
  if (parsed.data.display === "CUTOUT" && !media.cutoutUrl) return fail("This photo has no cutout — its background is too busy. Try re-preparing, or upload a photo on a plain background.");
  await db.productImage.update({ where: { id: media.id }, data: { display: parsed.data.display } });
  await audit(user.id, "media.display", "Product", media.productId, { mediaId: media.id, display: parsed.data.display });
  await refreshProduct(media.productId);
  return done("Display updated");
}

/** Re-runs the studio cutout (e.g. for photos added before cutouts existed). */
export async function reprepareMedia(id: string): Promise<ActionResult> {
  const user = await requirePermission("catalog.edit");
  if (!cuid.safeParse(id).success) return fail("Invalid media.");
  const media = await db.productImage.findUnique({ where: { id } });
  if (!media || media.type !== "IMAGE") return fail("Only photos can be prepared.");
  const prepared = await prepareProductImage(media.url);
  if (media.cutoutUrl && media.cutoutUrl !== prepared.cutoutUrl) await deleteLocal(media.cutoutUrl);
  await db.productImage.update({
    where: { id },
    data: { cutoutUrl: prepared.cutoutUrl, edgeColor: prepared.edgeColor, width: prepared.width, height: prepared.height, ...(!prepared.cutoutUrl && media.display === "CUTOUT" && { display: "AUTO" as const }) },
  });
  await audit(user.id, "media.prepare", "Product", media.productId, { mediaId: id, cutout: Boolean(prepared.cutoutUrl) });
  await refreshProduct(media.productId);
  return done(prepared.note);
}
