"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { getIntlLocale } from "@/i18n/server";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { cartLines, getCart, getOrCreateCart } from "@/server/cart";
import { couponProblem } from "@/lib/pricing";
import { rateLimit } from "@/server/rate-limit";
import { findGiftCard, normalizeCode } from "@/server/gift-cards";
import { personalCouponProblem } from "@/server/marketing";
import { activePreorders } from "@/server/preorders";

export type CartResult = { ok: true; message?: string } | { ok: false; error: string };

const done = (message?: string): CartResult => {
  revalidatePath("/", "layout");
  return { ok: true, message };
};

const MAX_QTY = 10;

/** `subscribe` makes it a Subscribe & Save line (every 1/2/3 months); without it the line is a one-time purchase. */
export async function addToCart(variantId: string, quantity = 1, subscribe?: { intervalMonths: number } | null): Promise<CartResult> {
  const parsed = z
    .object({ variantId: z.string().cuid(), quantity: z.number().int().min(1).max(MAX_QTY), subscribe: z.object({ intervalMonths: z.union([z.literal(1), z.literal(2), z.literal(3)]) }).nullish() })
    .safeParse({ variantId, quantity, subscribe });
  const t = await getTranslations("cart");
  if (!parsed.success) return { ok: false, error: t("errInvalidItem") };
  if (!(await rateLimit("cart", 60, 60)).ok) return { ok: false, error: t("errSlowDown") };

  const variant = await db.productVariant.findUnique({ where: { id: variantId }, include: { product: true } });
  if (!variant || !variant.product.isActive) return { ok: false, error: t("errUnavailable") };
  if (variant.product.model === "GIFTBOX" && variant.price === 0) return { ok: false, error: t("errCoffretFirst") };
  if (variant.product.isGiftCard) return { ok: false, error: t("errGiftCardFirst") };
  const sub = parsed.data.subscribe ?? null;
  if (sub) {
    const row = await db.setting.findUnique({ where: { key: "subscriptions" } });
    if ((row?.value as { enabled?: boolean } | null)?.enabled === false) return { ok: false, error: t("errSubscribePaused") };
  }

  // Pre-order variants sell from their own allocation, not on-hand stock (src/server/preorders.ts).
  const pre = (await activePreorders([variantId])).get(variantId);
  if (pre && sub) return { ok: false, error: t("errPreorderSubscribe") };

  const cart = await getOrCreateCart();
  const existing = cart.items.find((i) => i.variantId === variantId)?.quantity ?? 0;
  const free = pre ? pre.remaining : variant.stock - variant.reserved;
  const next = Math.min(existing + quantity, MAX_QTY);
  if (next > free) return { ok: false, error: free > 0 ? t("errOnlyLeft", { count: free }) : pre ? t("errPreorderFull") : t("errSoldOut") };

  // One line per piece: choosing subscribe / one-time switches the existing line too.
  const bundle = sub ? { subscribe: { intervalMonths: sub.intervalMonths } } : Prisma.DbNull;
  await db.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId } },
    update: { quantity: next, bundle },
    create: { cartId: cart.id, variantId, quantity: next, bundle },
  });
  if (pre) return done(t("addedPreorder", { name: variant.product.name, date: pre.shipDate.toLocaleDateString(await getIntlLocale(), { day: "numeric", month: "short" }) }));
  return done(sub ? t("addedSubscribe", { name: variant.product.name, count: sub.intervalMonths }) : t("addedName", { name: variant.product.name }));
}

/** Coffret: exactly four distinct pieces. One coffret per bag; adding again replaces it. */
export async function addCoffret(variantIds: string[]): Promise<CartResult> {
  const parsed = z.array(z.string().cuid()).length(4).safeParse(variantIds);
  const t = await getTranslations("cart");
  if (!parsed.success) return { ok: false, error: t("errChooseFour") };
  const coffret = await db.productVariant.findFirst({ where: { product: { slug: "build-your-coffret" } } });
  if (!coffret) return { ok: false, error: t("errCoffretUnavailable") };
  const pieces = await db.productVariant.findMany({ where: { id: { in: variantIds }, product: { isActive: true } } });
  if (pieces.length !== new Set(variantIds).size) return { ok: false, error: t("errPieceUnavailable") };
  const counts = variantIds.reduce<Record<string, number>>((m, id) => ({ ...m, [id]: (m[id] ?? 0) + 1 }), {});
  for (const p of pieces) if (p.stock - p.reserved < counts[p.id]) return { ok: false, error: t("errPieceSoldOut") };

  const cart = await getOrCreateCart();
  await db.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId: coffret.id } },
    update: { quantity: 1, bundle: { variantIds } },
    create: { cartId: cart.id, variantId: coffret.id, quantity: 1, bundle: { variantIds } },
  });
  return done(t("coffretAdded"));
}

export async function updateQuantity(itemId: string, quantity: number): Promise<CartResult> {
  const cart = await getCart();
  const item = cart?.items.find((i) => i.id === itemId);
  const t = await getTranslations("cart");
  if (!cart || !item) return { ok: false, error: t("errNotFound") };
  if (quantity <= 0) {
    await db.cartItem.delete({ where: { id: itemId } });
    return done();
  }
  const line = (await cartLines(cart)).find((l) => l.id === itemId);
  const q = Math.min(quantity, MAX_QTY, line?.available ?? 0);
  if (q <= 0) return { ok: false, error: t("errSoldOut") };
  if (item.bundle && q > 1) return { ok: false, error: t("errOneCoffret") };
  await db.cartItem.update({ where: { id: itemId }, data: { quantity: q } });
  return done(q < quantity ? t("onlyAvailableToast", { count: q }) : undefined);
}

export async function removeItem(itemId: string): Promise<CartResult> {
  const cart = await getCart();
  if (!cart?.items.some((i) => i.id === itemId)) return { ok: false, error: (await getTranslations("cart"))("errNotFound") };
  await db.cartItem.delete({ where: { id: itemId } });
  return done();
}

export async function applyCoupon(code: string): Promise<CartResult> {
  const t = await getTranslations("cart");
  if (!(await rateLimit("coupon", 10, 60)).ok) return { ok: false, error: t("errTooManyMinute") };
  const clean = code.trim().toUpperCase();
  if (!clean) return { ok: false, error: t("errEnterCode") };
  const coupon = await db.coupon.findUnique({ where: { code: clean } });
  if (!coupon) return { ok: false, error: t("errCodeInvalid") };
  const cart = await getOrCreateCart();
  const subtotal = (await cartLines(cart)).reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const problem = couponProblem(coupon, subtotal);
  if (problem) return { ok: false, error: problem };
  const owner = cart.userId ? (await db.user.findUnique({ where: { id: cart.userId }, select: { email: true } }))?.email : cart.email;
  const personal = await personalCouponProblem(coupon.code, owner ?? null);
  if (personal) return { ok: false, error: personal };
  await db.cart.update({ where: { id: cart.id }, data: { couponId: coupon.id } });
  return done(t("codeAppliedToast", { code: coupon.code }));
}

export async function removeCoupon(): Promise<CartResult> {
  const cart = await getCart();
  if (cart) await db.cart.update({ where: { id: cart.id }, data: { couponId: null } });
  return done();
}

export async function setGiftWrap(giftWrap: boolean, giftNote?: string): Promise<CartResult> {
  const cart = await getOrCreateCart();
  await db.cart.update({ where: { id: cart.id }, data: { giftWrap, giftNote: giftNote?.slice(0, 300) || null } });
  return done();
}

const giftCardSchema = z.object({
  variantId: z.string().cuid(),
  recipientName: z.string().trim().min(1, "Who is it for?").max(80),
  recipientEmail: z.string().trim().email("Enter the recipient’s email"),
  senderName: z.string().trim().max(80).optional(),
  message: z.string().trim().max(400).optional(),
});

/** One gift card per amount per bag; adding again updates who it's for. */
export async function addGiftCardToCart(input: z.infer<typeof giftCardSchema>): Promise<CartResult> {
  const parsed = giftCardSchema.safeParse(input);
  const t = await getTranslations("cart");
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { ok: false, error: field === "recipientName" ? t("errGiftCardWho") : field === "recipientEmail" ? t("errGiftCardEmail") : t("errCheckDetails") };
  }
  const { variantId, ...giftCard } = parsed.data;
  const variant = await db.productVariant.findUnique({ where: { id: variantId }, include: { product: true } });
  if (!variant?.product.isGiftCard || !variant.product.isActive) return { ok: false, error: t("errGiftCardUnavailable") };

  const cart = await getOrCreateCart();
  if (cart.giftCardCode) return { ok: false, error: t("errGiftCardOnGiftCard") };
  await db.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId } },
    update: { quantity: 1, bundle: { giftCard } },
    create: { cartId: cart.id, variantId, quantity: 1, bundle: { giftCard } },
  });
  return done(t("giftCardAddedFor", { name: giftCard.recipientName }));
}

export async function applyGiftCard(code: string): Promise<CartResult> {
  const t = await getTranslations("cart");
  if (!(await rateLimit("gift-card", 8, 300)).ok) return { ok: false, error: t("errTooManyMinutes") };
  const clean = normalizeCode(code);
  if (!clean) return { ok: false, error: t("errEnterGiftCard") };
  const { card, error } = await findGiftCard(clean);
  if (error || !card) return { ok: false, error: error ?? t("errGiftCardInvalid") };
  const cart = await getOrCreateCart();
  if (cart.items.some((i) => i.variant.product.isGiftCard)) return { ok: false, error: t("errGiftCardForGiftCard") };
  await db.cart.update({ where: { id: cart.id }, data: { giftCardCode: card.code } });
  return done(t("giftCardAppliedToast"));
}

export async function removeGiftCard(): Promise<CartResult> {
  const cart = await getCart();
  if (cart) await db.cart.update({ where: { id: cart.id }, data: { giftCardCode: null } });
  return done();
}
