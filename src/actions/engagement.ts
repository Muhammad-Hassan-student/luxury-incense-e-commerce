"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { rateLimit } from "@/server/rate-limit";
import { sendEmail } from "@/server/email";
import { SimpleEmail } from "@/emails/simple";
import { isCurrency } from "@/config/brand";
import { getRegion } from "@/server/region";
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/i18n/locales";
import { productCardSelect } from "@/server/catalog";
import { localizeProduct, localizeProducts, translatedProductMatches } from "@/server/translations/localize";

type Result = { ok: true; message?: string } | { ok: false; error: string };

export async function subscribeNewsletter(email: string): Promise<Result> {
  const t = await getTranslations("engagement");
  if (!(await rateLimit("newsletter", 5, 600)).ok) return { ok: false, error: t("errTooMany") };
  if (!z.string().email().safeParse(email).success) return { ok: false, error: t("errEmail") };
  const locale = (await cookies()).get("NEXT_LOCALE")?.value ?? "en";
  const existing = await db.newsletterSubscriber.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) return { ok: true, message: t("newsletterAlready") };
  await db.newsletterSubscriber.create({ data: { email: email.toLowerCase(), locale } });
  await sendEmail({
    to: email,
    subject: "Letters from the atelier",
    react: SimpleEmail({ preview: "Welcome", title: "You’re on the list", body: "Twice a month: new batches, rituals and private sales. Here’s 10% off your first order with code WELCOME10.", cta: { label: "Shop now", path: "/shop" } }),
  });
  return { ok: true, message: t("newsletterWelcome") };
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
  const t = await getTranslations("engagement");
  if (!(await rateLimit("stock-alert", 10, 600)).ok) return { ok: false, error: t("errTooMany") };
  if (!z.string().email().safeParse(email).success) return { ok: false, error: t("errEmail") };
  await db.stockAlert.upsert({
    where: { productId_email: { productId, email: email.toLowerCase() } },
    update: { notifiedAt: null },
    create: { productId, email: email.toLowerCase() },
  });
  return { ok: true, message: t("notifyDone") };
}

const reviewSchema = z.object({
  productId: z.string().cuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().min(2).max(80),
  body: z.string().min(10, "Tell us a little more (10+ characters).").max(2000),
});

export async function submitReview(input: z.infer<typeof reviewSchema>): Promise<Result> {
  const session = await auth();
  const t = await getTranslations("engagement");
  if (!session?.user) return { ok: false, error: t("reviewSignIn") };
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.path[0] === "body" ? t("reviewMore") : t("reviewInvalid") };
  const product = await db.product.findUnique({ where: { id: parsed.data.productId }, select: { slug: true, variants: { select: { id: true } } } });
  if (!product) return { ok: false, error: t("reviewNotFound") };
  const verified = (await db.orderItem.count({
    where: { variantId: { in: product.variants.map((v) => v.id) }, order: { userId: session.user.id, status: { in: ["PAID", "PACKED", "SHIPPED", "DELIVERED"] } } },
  })) > 0;
  await db.review.upsert({
    where: { productId_userId: { productId: parsed.data.productId, userId: session.user.id } },
    update: { ...parsed.data, verified, approved: false },
    create: { ...parsed.data, userId: session.user.id, verified },
  });
  return { ok: true, message: t("reviewThanks") };
}

export async function setCurrency(currency: string) {
  // Only the currencies the store has switched on (Admin → Currencies).
  if (!isCurrency(currency) || !(await getRegion()).enabledCurrencies.includes(currency)) return;
  (await cookies()).set("mo_currency", currency, { maxAge: 60 * 60 * 24 * 365, path: "/", sameSite: "lax" });
  revalidatePath("/", "layout");
}

export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { maxAge: LOCALE_COOKIE_MAX_AGE, path: "/", sameSite: "lax" });
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
  return localizeProducts(scored.map(({ p }) => p));
}

export async function searchProducts(q: string) {
  const term = q.trim();
  if (term.length < 2) return [];
  // Also match the shopper's language (published translations), then show localized results.
  const translated = await translatedProductMatches(term);
  const rows = await db.product.findMany({
    where: {
      isActive: true,
      OR: [
        ...(translated.length ? [{ id: { in: translated } }] : []),
        { name: { contains: term, mode: "insensitive" } },
        { subtitle: { contains: term, mode: "insensitive" } },
        { story: { contains: term, mode: "insensitive" } },
        { category: { name: { contains: term, mode: "insensitive" } } },
      ],
    },
    select: { id: true, slug: true, name: true, subtitle: true, model: true, palette: true, images: { where: { type: "IMAGE" }, orderBy: { position: "asc" }, take: 1, select: { url: true, cutoutUrl: true, display: true } }, category: { select: { name: true, slug: true } }, variants: { select: { price: true }, orderBy: { position: "asc" }, take: 1 } },
    take: 8,
  });
  return localizeProducts(rows);
}

/** Product cards for a list of slugs (recently viewed), in the order given. */
export async function productCardsBySlugs(slugs: string[]) {
  const clean = z.array(z.string().max(80)).max(8).safeParse(slugs);
  if (!clean.success || !clean.data.length) return [];
  const rows = await db.product.findMany({ where: { slug: { in: clean.data }, isActive: true }, select: productCardSelect });
  const ordered = clean.data.map((s) => rows.find((r) => r.slug === s)).filter((r) => r != null);
  return localizeProducts(ordered);
}

/** Everything the quick-view dialog shows for one product. Public catalogue data only. */
export async function quickViewProduct(slug: string) {
  const parsed = z.string().min(1).max(80).safeParse(slug);
  if (!parsed.success) return null;
  const p = await db.product.findFirst({
    where: { slug: parsed.data, isActive: true, isGiftCard: false },
    select: {
      id: true,
      slug: true,
      name: true,
      subtitle: true,
      story: true,
      model: true,
      palette: true,
      intensity: true,
      topNotes: true,
      heartNotes: true,
      baseNotes: true,
      ratingAvg: true,
      ratingCount: true,
      category: { select: { name: true, slug: true } },
      images: { orderBy: { position: "asc" }, take: 1, select: { type: true, url: true, poster: true, alt: true, cutoutUrl: true, display: true } },
      variants: { orderBy: { position: "asc" }, select: { id: true, label: true, price: true, compareAtPrice: true, stock: true, reserved: true } },
    },
  });
  if (!p || p.slug === "build-your-coffret") return null;
  const { variants, ...rest } = await localizeProduct(p);
  return { ...rest, variants: variants.map(({ stock, reserved, ...v }) => ({ ...v, available: Math.max(0, stock - reserved) })) };
}

export type QuickViewData = NonNullable<Awaited<ReturnType<typeof quickViewProduct>>>;
