import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import Razorpay from "razorpay";
import { getIntegration } from "./integrations";

// Every key is read at call time from Admin → Integrations (database first, environment as the fallback),
// so pasting new keys takes effect without a redeploy. SDK clients are memoised per key.

const stripeClients = new Map<string, Stripe>();
const razorpayClients = new Map<string, Razorpay>();

/** Stripe client for the current secret key. Throws when Stripe isn't set up. */
export async function stripe() {
  const { secretKey } = await getIntegration("stripe");
  if (!secretKey) throw new Error("Stripe is not configured");
  let c = stripeClients.get(secretKey);
  if (!c) {
    c = new Stripe(secretKey);
    stripeClients.clear(); // a rotated key replaces the old client
    stripeClients.set(secretKey, c);
  }
  return c;
}

/** Razorpay client for the current key pair. Throws when Razorpay isn't set up. */
export async function razorpay() {
  const { keyId, keySecret } = await getIntegration("razorpay");
  if (!keyId || !keySecret) throw new Error("Razorpay is not configured");
  const k = `${keyId}:${keySecret}`;
  let c = razorpayClients.get(k);
  if (!c) {
    c = new Razorpay({ key_id: keyId, key_secret: keySecret });
    razorpayClients.clear();
    razorpayClients.set(k, c);
  }
  return c;
}

/** Which online providers can take payments right now (async replacement for the old env flags). */
export async function paymentProviders() {
  const [s, r] = await Promise.all([getIntegration("stripe"), getIntegration("razorpay")]);
  return {
    stripe: Boolean(s.secretKey && s.publishableKey),
    razorpay: Boolean(r.keyId && r.keySecret),
    /** Public values the browser needs (never secrets). */
    stripePublishableKey: s.secretKey ? s.publishableKey : "",
    razorpayKeyId: r.keySecret ? r.keyId : "",
  };
}

type OrderItemLike = { meta?: unknown };
const wantsSubscription = (items: OrderItemLike[] | undefined) =>
  Boolean(items?.some((i) => (i.meta as { subscription?: unknown } | null)?.subscription));

export async function createStripeIntent(order: { id: string; number: string; total: number; currency: string; email: string; userId?: string | null; items?: OrderItemLike[] }) {
  const client = await stripe();
  // Subscribe & Save: keep the card on a Stripe customer so renewals can be charged off-session.
  let customer: string | undefined;
  if (wantsSubscription(order.items)) {
    const c = await client.customers.create({ email: order.email, metadata: { userId: order.userId ?? "" } }, { idempotencyKey: `cus-${order.id}` });
    customer = c.id;
  }
  const intent = await client.paymentIntents.create(
    {
      amount: order.total,
      currency: order.currency.toLowerCase(),
      receipt_email: order.email,
      description: `Order ${order.number}`,
      metadata: { orderId: order.id },
      automatic_payment_methods: { enabled: true },
      ...(customer ? { customer, setup_future_usage: "off_session" as const } : {}),
    },
    { idempotencyKey: `pi-${order.id}` },
  );
  return { providerRef: intent.id, clientSecret: intent.client_secret! };
}

/**
 * Charges a saved card without the customer present (subscription renewals).
 * Returns the PaymentIntent; `status === "succeeded"` means paid. Card errors come back as `{ error }`.
 */
export async function chargeSavedCard(p: { orderId: string; number: string; amount: number; currency: string; customer: string; paymentMethod: string; email: string }) {
  const client = await stripe();
  try {
    const intent = await client.paymentIntents.create(
      {
        amount: p.amount,
        currency: p.currency.toLowerCase(),
        customer: p.customer,
        payment_method: p.paymentMethod,
        off_session: true,
        confirm: true,
        receipt_email: p.email,
        description: `Order ${p.number} (subscription renewal)`,
        metadata: { orderId: p.orderId },
      },
      { idempotencyKey: `pi-${p.orderId}` },
    );
    return { intent, error: null as string | null };
  } catch (e) {
    const err = e as { message?: string; raw?: { payment_intent?: { id: string } } };
    return { intent: null, error: err.message ?? "Card was declined", intentId: err.raw?.payment_intent?.id };
  }
}

/** Saved payment method + customer of a succeeded PaymentIntent (for subscriptions). */
export async function savedPaymentMethod(paymentIntentId: string) {
  const intent = await (await stripe()).paymentIntents.retrieve(paymentIntentId);
  const customer = typeof intent.customer === "string" ? intent.customer : (intent.customer?.id ?? null);
  const paymentMethod = typeof intent.payment_method === "string" ? intent.payment_method : (intent.payment_method?.id ?? null);
  return { customer, paymentMethod };
}

export async function createRazorpayOrder(order: { id: string; number: string; total: number; currency: string }) {
  const ro = await (await razorpay()).orders.create({
    amount: order.total,
    currency: order.currency,
    receipt: order.number,
    notes: { orderId: order.id },
  });
  return { providerRef: ro.id };
}

function safeEqualHex(a: string, b: string) {
  if (!/^[0-9a-f]*$/i.test(b)) return false;
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length > 0 && ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Checkout.js handler signature: HMAC_SHA256(order_id|payment_id, key_secret). */
export async function verifyRazorpayPayment(razorpayOrderId: string, paymentId: string, signature: string) {
  const { keySecret } = await getIntegration("razorpay");
  if (!keySecret) return false;
  const expected = createHmac("sha256", keySecret).update(`${razorpayOrderId}|${paymentId}`).digest("hex");
  return safeEqualHex(expected, signature);
}

/** Webhook signature: HMAC_SHA256(raw body, webhook secret) with the secret saved in Admin → Integrations. */
export async function verifyRazorpayWebhook(rawBody: string, signature: string) {
  const { webhookSecret } = await getIntegration("razorpay");
  if (!webhookSecret) return false;
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return safeEqualHex(expected, signature);
}

/**
 * Verifies a Stripe webhook with the saved signing secret. Signature checking is local (no API key needed).
 * Returns null when no secret is configured; throws on a bad signature.
 */
export async function verifyStripeWebhook(rawBody: string, signature: string): Promise<Stripe.Event | null> {
  const { webhookSecret } = await getIntegration("stripe");
  if (!webhookSecret) return null;
  return Stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
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
    await (await stripe()).refunds.create(
      { payment_intent: p.providerRef, ...(opts.amount !== undefined ? { amount: opts.amount } : {}) },
      opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
    );
  } else if (p.provider === "RAZORPAY") {
    const paymentId = (p.raw as { paymentId?: string } | null)?.paymentId;
    if (!paymentId) throw new Error("Missing Razorpay payment id");
    await (await razorpay()).payments.refund(paymentId, { amount: opts.amount ?? p.amount });
  }
}

/** Harmless authenticated call used by Admin → Integrations "Test connection". Never returns secrets. */
export async function testPaymentConnection(provider: "stripe" | "razorpay"): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  try {
    if (provider === "stripe") {
      const c = await getIntegration("stripe");
      const balance = await (await stripe()).balance.retrieve();
      const mode = c.secretKey.startsWith("sk_live") || c.secretKey.startsWith("rk_live") ? "live" : "test";
      const pkMismatch = c.publishableKey && !c.publishableKey.startsWith(mode === "live" ? "pk_live" : "pk_test");
      return { ok: true, detail: `Stripe ${mode} mode — balance currencies: ${balance.available.map((b) => b.currency.toUpperCase()).join(", ") || "none yet"}${pkMismatch ? ". Warning: the publishable key is from the other mode." : c.publishableKey ? "" : ". Add the publishable key too."}` };
    }
    const c = await getIntegration("razorpay");
    await (await razorpay()).orders.all({ count: 1 });
    return { ok: true, detail: `Razorpay ${c.keyId.startsWith("rzp_live") ? "live" : "test"} mode — keys accepted` };
  } catch (e) {
    const err = e as { message?: string; error?: { description?: string }; statusCode?: number };
    return { ok: false, error: err.error?.description ?? err.message ?? "Unknown error" };
  }
}
