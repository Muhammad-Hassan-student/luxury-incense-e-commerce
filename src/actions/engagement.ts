"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { rateLimit } from "@/server/rate-limit";
import { sendEmail } from "@/server/email";
import { SimpleEmail } from "@/emails/simple";
import { currencies, type Currency } from "@/config/brand";
import { productCardSelect } from "@/server/catalog";

type Result = { ok: true; message?: string } | { ok: false; error: string };

export async function subscribeNewsletter(email: string): Promise<Result> {
  if (!(await rateLimit("newsletter", 5, 600)).ok) return { ok: false, error: "Too many attempts." };
  if (!z.string().email().safeParse(email).success) return { ok: false, error: "Enter a valid email." };
  const locale = (await cookies()).get("NEXT_LOCALE")?.value ?? "en";
  const existing = await db.newsletterSubscriber.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) return { ok: true, message: "You’re already on the list." };
  await db.newsletterSubscriber.create({ data: { email: email.toLowerCase(), locale } });
  await sendEmail({
    to: email,
    subject: "Letters from the atelier",
    react: SimpleEmail({ preview: "Welcome", title: "You’re on the list", body: "Twice a month: new batches, rituals and private sales. Here’s 10% off your first order with code WELCOME10.", cta: { label: "Shop now", path: "/shop" } }),
  });
  return { ok: true, message: "Welcome — check your inbox." };
}

export async function toggleWishlist(productId: string): Promise<Result & { saved?: boolean }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "SIGN_IN" };
  const key = { userId_productId: { userId: session.user.id, productId } };
  const existing = await db.wishlistItem.findUnique({ where: key });
  if (existing) await db.wishlistItem.delete({ where: key });
  else await db.wishlistItem.create({ data: { userId: session.user.id, productId } });
  revalidatePath("/account/wishlist");
  return { ok: true, saved: !existing };
}

export async function notifyWhenBack(productId: string, email: string): Promise<Result> {
  if (!(await rateLimit("stock-alert", 10, 600)).ok) return { ok: false, error: "Too many attempts." };
  if (!z.string().email().safeParse(email).success) return { ok: false, error: "Enter a valid email." };
  await db.stockAlert.upsert({
    where: { productId_email: { productId, email: email.toLowerCase() } },
    update: { notifiedAt: null },
    create: { productId, email: email.toLowerCase() },
  });
  return { ok: true, message: "We’ll email you the moment it’s back." };
}

const reviewSchema = z.object({
  productId: z.string().cuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().min(2).max(80),
  body: z.string().min(10, "Tell us a little more (10+ characters).").max(2000),
});

export async function submitReview(input: z.infer<typeof reviewSchema>): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign in to leave a review." };
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid review." };
  const product = await db.product.findUnique({ where: { id: parsed.data.productId }, select: { slug: true, variants: { select: { id: true } } } });
  if (!product) return { ok: false, error: "Product not found." };
  const verified = (await db.orderItem.count({
    where: { variantId: { in: product.variants.map((v) => v.id) }, order: { userId: session.user.id, status: { in: ["PAID", "PACKED", "SHIPPED", "DELIVERED"] } } },
  })) > 0;
  await db.review.upsert({
    where: { productId_userId: { productId: parsed.data.productId, userId: session.user.id } },
    update: { ...parsed.data, verified, approved: false },
    create: { ...parsed.data, userId: session.user.id, verified },
  });
  return { ok: true, message: "Thank you — your review will appear once approved." };
}

export async function setCurrency(currency: string) {
  if (!(currency in currencies)) return;
  (await cookies()).set("mo_currency", currency as Currency, { maxAge: 60 * 60 * 24 * 365, path: "/", sameSite: "lax" });
  revalidatePath("/", "layout");
}

export async function setLocale(locale: string) {
  if (!["en", "ar"].includes(locale)) return;
  (await cookies()).set("NEXT_LOCALE", locale, { maxAge: 60 * 60 * 24 * 365, path: "/", sameSite: "lax" });
  revalidatePath("/", "layout");
}

const quizSchema = z.object({
  mood: z.string(),
  time: z.string(),
  family: z.string(),
  intensity: z.number().int().min(1).max(5),
  form: z.string(),
});

/** Scores every product against the five answers; returns the best three. */
export async function scentQuiz(answers: z.infer<typeof quizSchema>) {
  const a = quizSchema.parse(answers);
  const products = await db.product.findMany({
    where: { isActive: true, category: { slug: { not: "gifts" } } },
    select: { ...productCardSelect, moods: true, timeOfDay: true, story: true },
  });
  const scored = products
    .map((p) => {
      let score = 0;
      if (p.moods.includes(a.mood)) score += 4;
      if (p.timeOfDay.includes(a.time)) score += 2;
      if (p.family === a.family) score += 3;
      score += 2 - Math.abs(p.intensity - a.intensity) * 0.75;
      if (a.form !== "any" && p.category.slug === a.form) score += 3;
      return { p, score };
    })
    .sort((x, y) => y.score - x.score)
    .slice(0, 3);
  return scored.map(({ p }) => p);
}

export async function searchProducts(q: string) {
  const term = q.trim();
  if (term.length < 2) return [];
  return db.product.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { subtitle: { contains: term, mode: "insensitive" } },
        { story: { contains: term, mode: "insensitive" } },
        { category: { name: { contains: term, mode: "insensitive" } } },
      ],
    },
    select: { slug: true, name: true, subtitle: true, model: true, palette: true, category: { select: { name: true } }, variants: { select: { price: true }, orderBy: { position: "asc" }, take: 1 } },
    take: 8,
  });
}

/** Product cards for a list of slugs (recently viewed), in the order given. */
export async function productCardsBySlugs(slugs: string[]) {
  const clean = z.array(z.string().max(80)).max(8).safeParse(slugs);
  if (!clean.success || !clean.data.length) return [];
  const rows = await db.product.findMany({ where: { slug: { in: clean.data }, isActive: true }, select: productCardSelect });
  return clean.data.map((s) => rows.find((r) => r.slug === s)).filter((r) => r != null);
}
