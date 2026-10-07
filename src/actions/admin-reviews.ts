"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { cuid, done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";

async function recomputeRating(tx: Prisma.TransactionClient, productId: string) {
  const agg = await tx.review.aggregate({ where: { productId, approved: true }, _avg: { rating: true }, _count: { _all: true } });
  await tx.product.update({
    where: { id: productId },
    data: { ratingAvg: Math.round((agg._avg.rating ?? 0) * 10) / 10, ratingCount: agg._count._all },
  });
}

const idSchema = z.object({ id: cuid });

function revalidateReviews() {
  revalidatePath("/admin/reviews");
  revalidatePath("/admin");
  revalidatePath("/", "layout");
}

export async function approveReview(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const user = await requirePermission("reviews.moderate");
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const review = await db.review.findUnique({ where: { id: parsed.data.id }, select: { productId: true, rating: true } });
  if (!review) return fail("Review not found.");
  await db.$transaction(async (tx) => {
    await tx.review.update({ where: { id: parsed.data.id }, data: { approved: true } });
    await recomputeRating(tx, review.productId);
  });
  await audit(user.id, "review.approve", "Review", parsed.data.id, { productId: review.productId, rating: review.rating });
  revalidateReviews();
  return done("Review published");
}

export async function deleteReview(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const user = await requirePermission("reviews.moderate");
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const review = await db.review.findUnique({ where: { id: parsed.data.id }, select: { productId: true, rating: true, title: true } });
  if (!review) return fail("Review not found.");
  await db.$transaction(async (tx) => {
    await tx.review.delete({ where: { id: parsed.data.id } });
    await recomputeRating(tx, review.productId);
  });
  await audit(user.id, "review.delete", "Review", parsed.data.id, { productId: review.productId, rating: review.rating, title: review.title });
  revalidateReviews();
  return done("Review deleted");
}
