import "server-only";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { db } from "./db";
import { cartInclude, cartLines, type CartWithItems } from "./cart-lines";

export { cartLines };
export type { Bundle, CartLine, CartWithItems } from "./cart-lines";

export const CART_COOKIE = "mo_cart";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 60;

/** Read-only lookup for Server Components. Never creates a cart or sets cookies. */
export async function getCart(): Promise<CartWithItems | null> {
  const session = await auth();
  if (session?.user) return db.cart.findUnique({ where: { userId: session.user.id }, include: cartInclude });
  const token = (await cookies()).get(CART_COOKIE)?.value;
  if (!token) return null;
  return db.cart.findUnique({ where: { token }, include: cartInclude });
}

/** For Server Actions only: returns the cart, creating it (and the guest cookie) if needed. */
export async function getOrCreateCart(): Promise<CartWithItems> {
  const session = await auth();
  if (session?.user) {
    return db.cart.upsert({
      where: { userId: session.user.id },
      update: {},
      create: { userId: session.user.id, email: session.user.email },
      include: cartInclude,
    });
  }
  const jar = await cookies();
  const token = jar.get(CART_COOKIE)?.value;
  const existing = token ? await db.cart.findUnique({ where: { token }, include: cartInclude }) : null;
  if (existing) return existing;
  const cart = await db.cart.create({ data: {}, include: cartInclude });
  jar.set(CART_COOKIE, cart.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
  return cart;
}

/** Called on sign-in: folds the guest cart into the user's cart and drops the guest cookie. */
export async function mergeGuestCartInto(userId: string) {
  const jar = await cookies();
  const token = jar.get(CART_COOKIE)?.value;
  if (!token) return;
  const guest = await db.cart.findUnique({ where: { token }, include: { items: true } });
  if (!guest || guest.userId) return;

  const user = await db.cart.upsert({ where: { userId }, update: {}, create: { userId } });
  await db.$transaction(async (tx) => {
    for (const item of guest.items) {
      await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId: user.id, variantId: item.variantId } },
        update: { quantity: { increment: item.quantity }, bundle: item.bundle ?? undefined },
        create: {
          cartId: user.id,
          variantId: item.variantId,
          quantity: item.quantity,
          bundle: item.bundle ?? undefined,
        },
      });
    }
    if (guest.couponId && !user.couponId) await tx.cart.update({ where: { id: user.id }, data: { couponId: guest.couponId } });
    await tx.cart.delete({ where: { id: guest.id } });
  });
  jar.delete(CART_COOKIE);
}

export async function cartCount() {
  const cart = await getCart();
  return cart?.items.reduce((n, i) => n + i.quantity, 0) ?? 0;
}
