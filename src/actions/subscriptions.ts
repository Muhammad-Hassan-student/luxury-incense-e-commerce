"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { rateLimit } from "@/server/rate-limit";
import { changeSubscription, orderIdFromPayToken, SubscriptionRuleError, type SubscriptionChange } from "@/server/subscriptions";
import { createRazorpayOrder, createStripeIntent, paymentProviders } from "@/server/payments";

const changeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("skip") }),
  z.object({ type: z.literal("interval"), months: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ type: z.literal("quantity"), quantity: z.number().int().min(1).max(10) }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("resume") }),
  z.object({ type: z.literal("cancel") }),
]);

export type SubscriptionActionResult = { ok: true; message: string } | { ok: false; error: string };

const MESSAGES: Record<SubscriptionChange["type"], string> = {
  skip: "Next delivery skipped",
  interval: "Delivery schedule updated",
  quantity: "Quantity updated",
  pause: "Subscription paused",
  resume: "Subscription resumed",
  cancel: "Subscription cancelled",
  renew_now: "Renewal started",
};

/** Customer portal: change one of your own subscriptions (the UI confirms first). */
export async function updateMySubscription(input: { id: string; change: z.input<typeof changeSchema>; confirm: true }): Promise<SubscriptionActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Please sign in again." };
  const parsed = z.object({ id: z.string().min(1).max(64), change: changeSchema, confirm: z.literal(true) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please check your choice and try again." };
  if (!(await rateLimit(`subs:${session.user.id}`, 30, 300)).ok) return { ok: false, error: "Too many changes — try again in a few minutes." };
  const sub = await db.subscription.findUnique({ where: { id: parsed.data.id }, select: { userId: true } });
  if (!sub || sub.userId !== session.user.id) return { ok: false, error: "Subscription not found." };
  try {
    await changeSubscription(parsed.data.id, parsed.data.change, "customer");
  } catch (e) {
    if (e instanceof SubscriptionRuleError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/account/subscriptions");
  return { ok: true, message: MESSAGES[parsed.data.change.type] };
}

export type PayRenewalResult =
  | { ok: true; number: string; orderId: string; client: { provider: "STRIPE"; clientSecret: string } | { provider: "RAZORPAY"; razorpayOrderId: string; amount: number; email: string; name: string; phone: string } }
  | { ok: false; error: string; paid?: boolean; number?: string };

/** One-click payment link for a renewal order: start (or resume) payment with whichever provider is live. */
export async function startRenewalPayment(token: string, prefer?: "STRIPE" | "RAZORPAY"): Promise<PayRenewalResult> {
  if (!(await rateLimit("pay-link", 20, 300)).ok) return { ok: false, error: "Too many attempts. Please wait a few minutes." };
  const orderId = orderIdFromPayToken(String(token).slice(0, 300));
  if (!orderId) return { ok: false, error: "This payment link isn’t valid." };
  const order = await db.order.findUnique({ where: { id: orderId }, include: { payments: { orderBy: { createdAt: "asc" } } } });
  if (!order) return { ok: false, error: "This payment link isn’t valid." };
  if (order.status === "CANCELLED") return { ok: false, error: "This renewal has expired. Your subscription will try again — or manage it from your account." };
  if (!order.reservedUntil) return { ok: false, error: "This renewal is already paid — thank you.", paid: true, number: order.number };
  const payment = order.payments[0];
  const online = await paymentProviders();
  const provider = prefer === "STRIPE" && online.stripe ? "STRIPE" : prefer === "RAZORPAY" && online.razorpay ? "RAZORPAY" : payment.provider === "STRIPE" && online.stripe ? "STRIPE" : online.razorpay ? "RAZORPAY" : online.stripe ? "STRIPE" : null;
  if (!provider) return { ok: false, error: "Online payments are unavailable right now. Please try again later." };
  const addr = order.shippingAddress as { fullName?: string; phone?: string };
  try {
    if (provider === "STRIPE") {
      // A fresh intent for the link (the off-session attempt, if any, used its own idempotency key).
      const { providerRef, clientSecret } = await createStripeIntent({ ...order, total: payment.amount });
      await db.payment.update({ where: { id: payment.id }, data: { provider: "STRIPE", providerRef } });
      return { ok: true, number: order.number, orderId: order.id, client: { provider: "STRIPE", clientSecret } };
    }
    const { providerRef } = await createRazorpayOrder({ ...order, total: payment.amount });
    await db.payment.update({ where: { id: payment.id }, data: { provider: "RAZORPAY", providerRef } });
    return { ok: true, number: order.number, orderId: order.id, client: { provider: "RAZORPAY", razorpayOrderId: providerRef, amount: payment.amount, email: order.email, name: addr.fullName ?? "", phone: addr.phone ?? "" } };
  } catch (e) {
    console.error("[pay-link]", (e as Error).message);
    return { ok: false, error: "We couldn’t start the payment. Nothing was charged — please try again." };
  }
}
