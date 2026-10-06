import "server-only";
import { cache } from "react";
import type { Prisma, ScentFamily } from "@/generated/prisma/client";
import { db } from "./db";

export const productCardSelect = {
  id: true,
  slug: true,
  name: true,
  subtitle: true,
  model: true,
  palette: true,
  family: true,
  intensity: true,
  isBestseller: true,
  ratingAvg: true,
  ratingCount: true,
  category: { select: { slug: true, name: true, ambient: true } },
  images: { orderBy: { position: "asc" }, take: 2, select: { type: true, url: true, poster: true, alt: true } },
  variants: {
    select: { id: true, label: true, price: true, compareAtPrice: true, stock: true, reserved: true },
    orderBy: { position: "asc" },
  },
} satisfies Prisma.ProductSelect;

export type ProductCardData = Prisma.ProductGetPayload<{ select: typeof productCardSelect }>;

export const available = (v: { stock: number; reserved: number }) => Math.max(0, v.stock - v.reserved);

export const getCategories = cache(() => db.category.findMany({ orderBy: { position: "asc" } }));

export const getCategory = cache((slug: string) => db.category.findUnique({ where: { slug } }));

export type ShopFilters = {
  category?: string;
  family?: ScentFamily;
  mood?: string;
  min?: number;
  max?: number;
  sort?: "featured" | "price-asc" | "price-desc" | "new" | "rating";
  q?: string;
};

export async function listProducts(f: ShopFilters = {}) {
  const where: Prisma.ProductWhereInput = { isActive: true };
  if (f.category) where.category = { slug: f.category };
  if (f.family) where.family = f.family;
  if (f.mood) where.moods = { has: f.mood };
  if (f.q) {
    const q = f.q.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { subtitle: { contains: q, mode: "insensitive" } },
      { topNotes: { has: q } },
      { heartNotes: { has: q } },
      { baseNotes: { has: q } },
    ];
  }
  if (f.min != null || f.max != null) {
    where.variants = { some: { price: { gte: f.min ?? 0, lte: f.max ?? Number.MAX_SAFE_INTEGER } } };
  }
  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    f.sort === "new"
      ? [{ createdAt: "desc" }]
      : f.sort === "rating"
        ? [{ ratingAvg: "desc" }]
        : [{ isFeatured: "desc" }, { isBestseller: "desc" }, { name: "asc" }];

  const rows = await db.product.findMany({ where, orderBy, select: productCardSelect });
  if (f.sort === "price-asc" || f.sort === "price-desc") {
    const dir = f.sort === "price-asc" ? 1 : -1;
    rows.sort((a, b) => dir * ((a.variants[0]?.price ?? 0) - (b.variants[0]?.price ?? 0)));
  }
  return rows;
}

export const getProduct = cache((slug: string) =>
  db.product.findFirst({
    where: { slug, isActive: true },
    include: {
      category: true,
      variants: { orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" }, select: { type: true, url: true, poster: true, alt: true } },
      reviews: {
        where: { approved: true },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { user: { select: { name: true } } },
      },
    },
  }),
);

export async function relatedProducts(productId: string, categoryId: string, family: ScentFamily) {
  return db.product.findMany({
    where: { isActive: true, id: { not: productId }, OR: [{ categoryId }, { family }] },
    select: productCardSelect,
    take: 4,
    orderBy: { isBestseller: "desc" },
  });
}

export const getBestsellers = cache(() =>
  db.product.findMany({
    where: { isActive: true, isBestseller: true },
    select: productCardSelect,
    take: 8,
  }),
);

export const getProductCard = cache((slug: string) =>
  db.product.findFirst({ where: { slug, isActive: true }, select: productCardSelect }),
);

export const getCollections = cache(() =>
  db.collection.findMany({
    orderBy: { position: "asc" },
    include: {
      products: { orderBy: { position: "asc" }, include: { product: { select: productCardSelect } } },
    },
  }),
);

export const getCollection = cache((slug: string) =>
  db.collection.findUnique({
    where: { slug },
    include: {
      products: { orderBy: { position: "asc" }, include: { product: { select: productCardSelect } } },
    },
  }),
);

/** Pieces eligible for the build-your-own coffret: everything in stock except gift sets. */
export const getCoffretPieces = cache(() =>
  db.product.findMany({
    where: { isActive: true, category: { slug: { not: "gifts" } } },
    select: productCardSelect,
    orderBy: { name: "asc" },
  }),
);
