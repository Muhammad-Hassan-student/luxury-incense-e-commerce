"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { cartLines, getCart, getOrCreateCart } from "@/server/cart";
import { couponProblem } from "@/lib/pricing";
import { rateLimit } from "@/server/rate-limit";
import { findGiftCard, normalizeCode } from "@/server/gift-cards";

export type CartResult = { ok: true; message?: string } | { ok: false; error: string };

const done = (message?: string): CartResult => {
  revalidatePath("/", "layout");
  return { ok: true, message };
};

const MAX_QTY = 10;

export async function addToCart(variantId: string, quantity = 1): Promise<CartResult> {
  const parsed = z.object({ variantId: z.string().cuid(), quantity: z.number().int().min(1).max(MAX_QTY) }).safeParse({ variantId, quantity });
  if (!parsed.success) return { ok: false, error: "Invalid item." };
  if (!(await rateLimit("cart", 60, 60)).ok) return { ok: false, error: "Slow down a little and try again." };

  const variant = await db.productVariant.findUnique({ where: { id: variantId }, include: { product: true } });
  if (!variant || !variant.product.isActive) return { ok: false, error: "This piece is no longer available." };
  if (variant.product.model === "GIFTBOX" && variant.price === 0) return { ok: false, error: "Choose your coffret pieces first." };
  if (variant.product.isGiftCard) return { ok: false, error: "Add who the gift card is for first." };

  const cart = await getOrCreateCart();
  const existing = cart.items.find((i) => i.variantId === variantId)?.quantity ?? 0;
  const free = variant.stock - variant.reserved;
  const next = Math.min(existing + quantity, MAX_QTY);
  if (next > free) return { ok: false, error: free > 0 ? `Only ${free} left.` : "Sold out." };

  await db.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId } },
    update: { quantity: next },
    create: { cartId: cart.id, variantId, quantity: next },
  });
  return done(`${variant.product.name} added to your bag`);
}

/** Coffret: exactly four distinct pieces. One coffret per bag; adding again replaces it. */
export async function addCoffret(variantIds: string[]): Promise<CartResult> {
  const parsed = z.array(z.string().cuid()).length(4).safeParse(variantIds);
  if (!parsed.success) return { ok: false, error: "Choose four pieces." };
  const coffret = await db.productVariant.findFirst({ where: { product: { slug: "build-your-coffret" } } });
  if (!coffret) return { ok: false, error: "Coffrets are unavailable right now." };
  const pieces = await db.productVariant.findMany({ where: { id: { in: variantIds }, product: { isActive: true } } });
  if (pieces.length !== new Set(variantIds).size) return { ok: false, error: "One of those pieces is unavailable." };
  const counts = variantIds.reduce<Record<string, number>>((m, id) => ({ ...m, [id]: (m[id] ?? 0) + 1 }), {});
  for (const p of pieces) if (p.stock - p.reserved < counts[p.id]) return { ok: false, error: "One of those pieces just sold out." };

  const cart = await getOrCreateCart();
  await db.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId: coffret.id } },
    update: { quantity: 1, bundle: { variantIds } },
    create: { cartId: cart.id, variantId: coffret.id, quantity: 1, bundle: { variantIds } },
  });
  return done("Your coffret is in the bag");
}

export async function updateQuantity(itemId: string, quantity: number): Promise<CartResult> {
  const cart = await getCart();
  const item = cart?.items.find((i) => i.id === itemId);
  if (!cart || !item) return { ok: false, error: "Item not found." };
  if (quantity <= 0) {
    await db.cartItem.delete({ where: { id: itemId } });
    return done();
  }
  const line = (await cartLines(cart)).find((l) => l.id === itemId);
  const q = Math.min(quantity, MAX_QTY, line?.available ?? 0);
  if (q <= 0) return { ok: false, error: "Sold out." };
  if (item.bundle && q > 1) return { ok: false, error: "One coffret per order — add another after checkout." };
  await db.cartItem.update({ where: { id: itemId }, data: { quantity: q } });
  return done(q < quantity ? `Only ${q} available.` : undefined);
}

export async function removeItem(itemId: string): Promise<CartResult> {
  const cart = await getCart();
  if (!cart?.items.some((i) => i.id === itemId)) return { ok: false, error: "Item not found." };
  await db.cartItem.delete({ where: { id: itemId } });
  return done();
}

export async function applyCoupon(code: string): Promise<CartResult> {
  if (!(await rateLimit("coupon", 10, 60)).ok) return { ok: false, error: "Too many attempts. Try again in a minute." };
  const clean = code.trim().toUpperCase();
  if (!clean) return { ok: false, error: "Enter a code." };
  const coupon = await db.coupon.findUnique({ where: { code: clean } });
  if (!coupon) return { ok: false, error: "That code isn’t valid." };
  const cart = await getOrCreateCart();
  const subtotal = (await cartLines(cart)).reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const problem = couponProblem(coupon, subtotal);
  if (problem) return { ok: false, error: problem };
  await db.cart.update({ where: { id: cart.id }, data: { couponId: coupon.id } });
  return done(`${coupon.code} applied`);
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
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details." };
  const { variantId, ...giftCard } = parsed.data;
  const variant = await db.productVariant.findUnique({ where: { id: variantId }, include: { product: true } });
  if (!variant?.product.isGiftCard || !variant.product.isActive) return { ok: false, error: "That gift card isn’t available." };

  const cart = await getOrCreateCart();
  if (cart.giftCardCode) return { ok: false, error: "Remove the gift card applied to your bag first — gift cards can’t buy gift cards." };
  await db.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId } },
    update: { quantity: 1, bundle: { giftCard } },
    create: { cartId: cart.id, variantId, quantity: 1, bundle: { giftCard } },
  });
  return done(`Gift card for ${giftCard.recipientName} added`);
}

export async function applyGiftCard(code: string): Promise<CartResult> {
  if (!(await rateLimit("gift-card", 8, 300)).ok) return { ok: false, error: "Too many attempts. Try again in a few minutes." };
  const clean = normalizeCode(code);
  if (!clean) return { ok: false, error: "Enter a gift card code." };
  const { card, error } = await findGiftCard(clean);
  if (error || !card) return { ok: false, error: error ?? "That gift card code isn’t valid." };
  const cart = await getOrCreateCart();
  if (cart.items.some((i) => i.variant.product.isGiftCard)) return { ok: false, error: "Gift cards can’t be used to buy other gift cards." };
  await db.cart.update({ where: { id: cart.id }, data: { giftCardCode: card.code } });
  return done("Gift card applied");
}

export async function removeGiftCard(): Promise<CartResult> {
  const cart = await getCart();
  if (cart) await db.cart.update({ where: { id: cart.id }, data: { giftCardCode: null } });
  return done();
}
