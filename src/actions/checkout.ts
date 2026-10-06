"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { cartLines, getCart } from "@/server/cart";
import { CheckoutError, confirmOrder, placeOrder, quote } from "@/server/orders";
import { verifyRazorpayPayment } from "@/server/payments";
import { rateLimit } from "@/server/rate-limit";
import { flag } from "@/server/settings";
import { integrations } from "@/env";
import { checkoutSchema, type CheckoutInput } from "@/lib/checkout-schema";


export async function quoteAction(opts: { country: string; shippingRateId?: string; pointsRequested?: number; giftWrap?: boolean }) {
  const [cart, session] = await Promise.all([getCart(), auth()]);
  const lines = await cartLines(cart);
  const q = await quote({ lines, cart, country: opts.country, shippingRateId: opts.shippingRateId, userId: session?.user.id, pointsRequested: opts.pointsRequested, giftWrap: opts.giftWrap });
  return { pricing: q.pricing, giftCard: q.giftCard, rateId: q.rate?.id ?? null, rates: q.rates.map((r) => ({ id: r.id, name: r.name, price: r.price, freeOver: r.freeOver, etaDays: r.etaDays })) };
}

export type PlaceOrderResult =
  | { ok: true; number: string; orderId: string; client: null | { provider: "STRIPE"; clientSecret: string } | { provider: "RAZORPAY"; razorpayOrderId: string; amount: number; email: string; name: string; phone: string } }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export async function placeOrderAction(input: CheckoutInput): Promise<PlaceOrderResult> {
  if (!(await rateLimit("checkout", 8, 300)).ok) return { ok: false, error: "Too many attempts. Please wait a few minutes." };
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  const d = parsed.data;

  const [session, cart] = await Promise.all([auth(), getCart()]);
  if (!cart) return { ok: false, error: "Your bag is empty." };
  const lines = await cartLines(cart);

  // A payment method is only needed when something is left to pay after gift cards/discounts.
  const enabled = { STRIPE: integrations.stripe, RAZORPAY: integrations.razorpay, COD: await flag("cod") };
  if (!enabled[d.provider]) {
    const q = await quote({ lines, cart, country: d.country, shippingRateId: d.shippingRateId, userId: session?.user.id, pointsRequested: d.pointsRequested, giftWrap: d.giftWrap });
    if (q.pricing.payable > 0) return { ok: false, error: "That payment method isn’t available." };
  }
  const address = { fullName: d.fullName, phone: d.phone, line1: d.line1, line2: d.line2 || undefined, city: d.city, state: d.state, postalCode: d.postalCode, country: d.country };

  try {
    const { order, client } = await placeOrder({
      cart,
      lines,
      userId: session?.user.id ?? null,
      email: d.email,
      address,
      shippingRateId: d.shippingRateId,
      provider: d.provider,
      pointsRequested: session?.user ? d.pointsRequested : 0,
      giftWrap: d.giftWrap,
      giftNote: d.giftNote,
      deliveryDate: d.deliveryDate ? new Date(d.deliveryDate) : null,
    });
    if (session?.user && d.saveAddress) {
      const count = await db.address.count({ where: { userId: session.user.id } });
      await db.address.create({ data: { ...address, userId: session.user.id, isDefault: count === 0 } });
    }
    if (!session?.user) await db.cart.update({ where: { id: cart.id }, data: { email: d.email } });
    revalidatePath("/", "layout");
    return {
      ok: true,
      number: order.number,
      orderId: order.id,
      client: client?.provider === "RAZORPAY" ? { ...client, amount: order.total - order.giftCardAmount, email: d.email, name: d.fullName, phone: d.phone } : client,
    };
  } catch (e) {
    if (e instanceof CheckoutError) return { ok: false, error: e.message };
    console.error("[checkout]", e);
    return { ok: false, error: "We couldn’t start payment. Nothing was charged — please try again." };
  }
}

/** Razorpay Checkout.js success handler. The webhook confirms too; whichever lands first wins. */
export async function verifyRazorpayAction(p: { orderId: string; razorpayOrderId: string; paymentId: string; signature: string }) {
  if (!verifyRazorpayPayment(p.razorpayOrderId, p.paymentId, p.signature)) return { ok: false as const, error: "Payment could not be verified." };
  const payment = await db.payment.findUnique({ where: { providerRef: p.razorpayOrderId } });
  if (!payment || payment.orderId !== p.orderId) return { ok: false as const, error: "Order mismatch." };
  await confirmOrder(p.orderId, { captured: true, raw: { paymentId: p.paymentId } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Remember the shopper's email early so we can send an abandoned-bag reminder. */
export async function rememberCheckoutEmail(email: string) {
  if (!z.string().email().safeParse(email).success) return;
  const cart = await getCart();
  if (cart && !cart.userId) await db.cart.update({ where: { id: cart.id }, data: { email } });
}
