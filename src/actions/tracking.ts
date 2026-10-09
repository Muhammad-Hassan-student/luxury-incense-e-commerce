"use server";

import { z } from "zod";
import { rateLimit } from "@/server/rate-limit";
import { lookupTracking, type TrackingView } from "@/server/courier/tracking";
import { deliveryEstimate, type DeliveryEstimate } from "@/server/courier/checkout";

const trackSchema = z.object({
  number: z.string().trim().min(4, "Enter your order number").max(40),
  contact: z.string().trim().min(5, "Enter the email or phone you ordered with").max(120),
});

/** Public order tracking: order number + email or phone. Limited per IP and per order number. */
export async function trackOrderAction(input: z.input<typeof trackSchema>): Promise<{ ok: true; view: TrackingView } | { ok: false; error: string }> {
  const parsed = trackSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  if (!(await rateLimit("track", 10, 600)).ok) return { ok: false, error: "Too many lookups. Please wait a few minutes." };
  return lookupTracking(parsed.data);
}

const estimateSchema = z.object({ postalCode: z.string().trim().regex(/^\d{6}$/), country: z.string().trim().length(2).default("IN") });

/** Checkout delivery estimate for a pincode. Never throws; null = nothing to show. */
export async function deliveryEstimateAction(input: z.input<typeof estimateSchema>): Promise<DeliveryEstimate | null> {
  const parsed = estimateSchema.safeParse(input);
  if (!parsed.success) return null;
  if (!(await rateLimit("delivery-estimate", 40, 300)).ok) return null;
  try {
    return await deliveryEstimate(parsed.data.postalCode, parsed.data.country);
  } catch {
    return null;
  }
}
