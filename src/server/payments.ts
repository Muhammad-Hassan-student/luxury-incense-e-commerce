import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import Razorpay from "razorpay";
import { env } from "@/env";

let stripeClient: Stripe | null = null;
export function stripe() {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured");
  return (stripeClient ??= new Stripe(env.STRIPE_SECRET_KEY));
}

let razorpayClient: Razorpay | null = null;
export function razorpay() {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) throw new Error("Razorpay is not configured");
  return (razorpayClient ??= new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET }));
}

export async function createStripeIntent(order: { id: string; number: string; total: number; currency: string; email: string }) {
  const intent = await stripe().paymentIntents.create(
    {
      amount: order.total,
      currency: order.currency.toLowerCase(),
      receipt_email: order.email,
      description: `Order ${order.number}`,
      metadata: { orderId: order.id },
      automatic_payment_methods: { enabled: true },
    },
    { idempotencyKey: `pi-${order.id}` },
  );
  return { providerRef: intent.id, clientSecret: intent.client_secret! };
}

export async function createRazorpayOrder(order: { id: string; number: string; total: number; currency: string }) {
  const ro = await razorpay().orders.create({
    amount: order.total,
    currency: order.currency,
    receipt: order.number,
    notes: { orderId: order.id },
  });
  return { providerRef: ro.id };
}

function safeEqualHex(a: string, b: string) {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Checkout.js handler signature: HMAC_SHA256(order_id|payment_id, key_secret). */
export function verifyRazorpayPayment(razorpayOrderId: string, paymentId: string, signature: string) {
  if (!env.RAZORPAY_KEY_SECRET) return false;
  const expected = createHmac("sha256", env.RAZORPAY_KEY_SECRET).update(`${razorpayOrderId}|${paymentId}`).digest("hex");
  return safeEqualHex(expected, signature);
}

export function verifyRazorpayWebhook(rawBody: string, signature: string) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
  return safeEqualHex(expected, signature);
}

/**
 * Refund at the provider: in full by default, or `opts.amount` (minor units) for a partial refund (returns).
 * `raw.paymentId` holds Razorpay's payment id once captured. COD / invoice payments have nothing to call.
 */
export async function refundAtProvider(
  p: { provider: string; providerRef: string | null; raw: unknown; amount: number },
  opts: { amount?: number; idempotencyKey?: string } = {},
) {
  if (p.provider === "STRIPE" && p.providerRef) {
    await stripe().refunds.create(
      { payment_intent: p.providerRef, ...(opts.amount !== undefined ? { amount: opts.amount } : {}) },
      opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
    );
  } else if (p.provider === "RAZORPAY") {
    const paymentId = (p.raw as { paymentId?: string } | null)?.paymentId;
    if (!paymentId) throw new Error("Missing Razorpay payment id");
    await razorpay().payments.refund(paymentId, { amount: opts.amount ?? p.amount });
  }
}
