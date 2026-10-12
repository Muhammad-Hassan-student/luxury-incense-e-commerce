"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { cartLines, getCart } from "@/server/cart";
import { CheckoutError, confirmOrder, placeOrder, quote } from "@/server/orders";
import { paymentProviders, verifyRazorpayPayment } from "@/server/payments";
import { attributionFrom } from "@/server/tracking";
import { cookies, headers } from "next/headers";
import { rateLimit } from "@/server/rate-limit";
import { flag } from "@/server/settings";
import { checkoutSchema, type CheckoutInput } from "@/lib/checkout-schema";
import { applyStorefrontRules, codDecision, getRiskSettings, type StorefrontAdjustment } from "@/server/risk";
import { AFF_COOKIE, DEVICE_COOKIE } from "@/server/affiliates";
import { getCurrency } from "@/server/prefs";
import { getFxTable, getRegion } from "@/server/region";
import { planCharge, razorpayAvailable } from "@/server/charge";

async function affiliateTouch() {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  return { cookie: jar.get(AFF_COOKIE)?.value ?? null, deviceId: jar.get(DEVICE_COOKIE)?.value ?? null, ip: (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null };
}


export async function quoteAction(opts: { country: string; shippingRateId?: string; pointsRequested?: number; giftWrap?: boolean; provider?: "STRIPE" | "RAZORPAY" | "COD"; postalCode?: string }) {
  const [cart, session] = await Promise.all([getCart(), auth()]);
  const lines = await cartLines(cart);
  const q = await quote({ lines, cart, country: opts.country, shippingRateId: opts.shippingRateId, userId: session?.user.id, pointsRequested: opts.pointsRequested, giftWrap: opts.giftWrap, postalCode: typeof opts.postalCode === "string" && /^\d{6}$/.test(opts.postalCode) ? opts.postalCode : null });
  // COD fee / pay-online incentive, exactly as placeOrder applies them.
  let adjust: StorefrontAdjustment | null = null;
  if (opts.provider) {
    const goodsSubtotal = lines.filter((l) => !l.digital).reduce((n, l) => n + l.unitPrice * l.quantity, 0);
    adjust = applyStorefrontRules(q.pricing, { provider: opts.provider === "COD" ? "COD" : "ONLINE", goodsSubtotal, giftCardBalance: q.giftCard?.balance ?? 0, settings: await getRiskSettings(), taxRatePercent: q.settings.taxRatePercent, taxInclusive: q.settings.taxInclusive }).adjust;
  }
  // What the card will actually be charged (Stripe in the shopper's currency; others in the base) — src/server/charge.ts.
  const [region, fx, display] = await Promise.all([getRegion(), getFxTable(), getCurrency()]);
  const charge = planCharge({ provider: opts.provider ?? "STRIPE", display, payable: q.pricing.payable, fx, region });
  return {
    pricing: q.pricing,
    adjust,
    giftCard: q.giftCard,
    rateId: q.rate?.id ?? null,
    rates: q.rates.map((r) => ({ id: r.id, name: r.name, price: r.price, freeOver: r.freeOver, etaDays: r.etaDays })),
    charge: { currency: charge?.currency ?? region.baseCurrency, amount: charge?.amount ?? null },
  };
}

export type PlaceOrderResult =
  | { ok: true; number: string; orderId: string; client: null | { provider: "STRIPE"; clientSecret: string } | { provider: "RAZORPAY"; razorpayOrderId: string; amount: number; email: string; name: string; phone: string } }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export async function placeOrderAction(input: CheckoutInput): Promise<PlaceOrderResult> {
  const t = await getTranslations("checkout");
  if (!(await rateLimit("checkout", 8, 300)).ok) return { ok: false, error: t("errorTooManyAttempts") };
  const parsed = checkoutSchema.safeParse(input);
  // fieldErrors stay English (schema messages); the form shows its own translated message per field.
  if (!parsed.success) return { ok: false, error: t("errorCheckFields"), fieldErrors: z.flattenError(parsed.error).fieldErrors };
  const d = parsed.data;

  const [session, cart] = await Promise.all([auth(), getCart()]);
  if (!cart) return { ok: false, error: t("errorBagEmpty") };
  const lines = await cartLines(cart);

  // A payment method is only needed when something is left to pay after gift cards/discounts.
  const online = await paymentProviders();
  // Razorpay is INR-only here: hidden whenever the base (charge) currency isn't INR.
  const region = await getRegion();
  const enabled = { STRIPE: online.stripe, RAZORPAY: online.razorpay && razorpayAvailable(region), COD: await flag("cod") };
  // Subscribe & Save is billed online to an account.
  if (lines.some((l) => l.subscription)) {
    if (!session?.user) return { ok: false, error: t("errorSubscriptionSignIn") };
    if (d.provider === "COD") return { ok: false, error: t("errorSubscriptionOnline") };
  }
  if (!enabled[d.provider]) {
    const q = await quote({ lines, cart, country: d.country, shippingRateId: d.shippingRateId, userId: session?.user.id, pointsRequested: d.pointsRequested, giftWrap: d.giftWrap, postalCode: /^\d{6}$/.test(d.postalCode) ? d.postalCode : null });
    if (q.pricing.payable > 0) return { ok: false, error: t("errorMethodUnavailable") };
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
      storefront: { whatsappOptIn: d.whatsappOptIn },
      // Only with cookie consent: IP, user agent and ad cookies for the server-side purchase event.
      tracking: attributionFrom(await cookies(), await headers()),
      // Affiliate attribution (last click / personal code) + fraud signals; see src/server/affiliates.ts.
      affiliate: await affiliateTouch(),
      displayCurrency: await getCurrency(),
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
    // CheckoutError text comes from src/server/orders.ts (English, no stable code to map).
    if (e instanceof CheckoutError) return { ok: false, error: e.message };
    console.error("[checkout]", e);
    return { ok: false, error: t("errorCouldNotStart") };
  }
}

/** Razorpay Checkout.js success handler. The webhook confirms too; whichever lands first wins. */
export async function verifyRazorpayAction(p: { orderId: string; razorpayOrderId: string; paymentId: string; signature: string }) {
  const t = await getTranslations("checkout");
  if (!(await verifyRazorpayPayment(p.razorpayOrderId, p.paymentId, p.signature))) return { ok: false as const, error: t("errorNotVerified") };
  const payment = await db.payment.findUnique({ where: { providerRef: p.razorpayOrderId } });
  if (!payment || payment.orderId !== p.orderId) return { ok: false as const, error: t("errorOrderMismatch") };
  await confirmOrder(p.orderId, { captured: true, raw: { paymentId: p.paymentId } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Live COD check for the checkout form (phone/pincode/amount change → COD may be hidden with a reason).
 * placeOrder enforces the same decision server-side.
 */
export async function codCheckAction(input: { email: string; phone: string; postalCode: string; country: string; shippingRateId?: string; pointsRequested?: number; giftWrap?: boolean }) {
  const parsed = z
    .object({ email: z.string().max(200), phone: z.string().max(32), postalCode: z.string().max(12), country: z.string().length(2), shippingRateId: z.string().max(64).optional(), pointsRequested: z.number().int().min(0).optional(), giftWrap: z.boolean().optional() })
    .safeParse(input);
  if (!parsed.success) return { allowed: true, message: null, fee: 0, incentive: null };
  if (!(await rateLimit("cod-check", 60, 300)).ok) return { allowed: true, message: null, fee: 0, incentive: null };
  const d = parsed.data;
  const [session, cart] = await Promise.all([auth(), getCart()]);
  const lines = await cartLines(cart);
  const settings = await getRiskSettings();
  const q = await quote({ lines, cart, country: d.country, shippingRateId: d.shippingRateId, userId: session?.user.id, pointsRequested: d.pointsRequested, giftWrap: d.giftWrap, postalCode: /^\d{6}$/.test(d.postalCode) ? d.postalCode : null });
  const goodsSubtotal = lines.filter((l) => !l.digital).reduce((n, l) => n + l.unitPrice * l.quantity, 0);
  applyStorefrontRules(q.pricing, { provider: "COD", goodsSubtotal, giftCardBalance: q.giftCard?.balance ?? 0, settings, taxRatePercent: q.settings.taxRatePercent, taxInclusive: q.settings.taxInclusive });
  const decision = await codDecision({ email: d.email, phone: d.phone, country: d.country, postalCode: d.postalCode, amount: q.pricing.payable, userId: session?.user.id, digital: lines.some((l) => l.digital), settings });
  // Never reveal the score or reasons to the shopper.
  return { allowed: decision.allowed, message: decision.message, fee: decision.fee, incentive: decision.incentive };
}

/** Remember the shopper's email early so we can send an abandoned-bag reminder. */
export async function rememberCheckoutEmail(email: string) {
  if (!z.string().email().safeParse(email).success) return;
  const cart = await getCart();
  if (cart && !cart.userId) await db.cart.update({ where: { id: cart.id }, data: { email } });
}
