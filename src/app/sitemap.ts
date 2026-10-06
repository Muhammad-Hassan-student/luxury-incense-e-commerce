import type { MetadataRoute } from "next";
import { db } from "@/server/db";
import { pages } from "@/content/pages";
import { productHref } from "@/lib/product-href";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const [products, categories, collections, posts] = await Promise.all([
    db.product.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } }),
    db.category.findMany({ select: { slug: true } }),
    db.collection.findMany({ select: { slug: true } }),
    db.journalPost.findMany({ where: { published: true }, select: { slug: true, updatedAt: true } }),
  ]);
  const url = (path: string, lastModified?: Date, priority = 0.6) => ({ url: `${site}${path}`, lastModified, priority });
  return [
    url("/", undefined, 1),
    url("/shop", undefined, 0.9),
    url("/collections"),
    url("/ritual"),
    url("/gifts/coffret"),
    url("/journal"),
    ...Object.keys(pages).map((p) => url(`/${p}`, undefined, 0.3)),
    ...categories.map((c) => url(`/shop/${c.slug}`, undefined, 0.8)),
    ...collections.map((c) => url(`/collections/${c.slug}`)),
    ...products.map((p) => url(productHref(p.slug), p.updatedAt, 0.8)),
    ...posts.map((p) => url(`/journal/${p.slug}`, p.updatedAt, 0.5)),
  ];
}
