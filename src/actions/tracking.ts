"use server";

import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { rateLimit } from "@/server/rate-limit";
import { LOCKED, NOT_FOUND, lookupTracking, type TrackingView } from "@/server/courier/tracking";
import { deliveryEstimate, type DeliveryEstimate } from "@/server/courier/checkout";

// Messages are keys in `track` (translated below).
const trackSchema = z.object({
  number: z.string().trim().min(4, "errorNumber").max(40, "errorNumber"),
  contact: z.string().trim().min(5, "errorContact").max(120, "errorContact"),
});
const SCHEMA_KEYS = ["errorNumber", "errorContact"] as const;

/** Public order tracking: order number + email or phone. Limited per IP and per order number. */
export async function trackOrderAction(input: z.input<typeof trackSchema>): Promise<{ ok: true; view: TrackingView } | { ok: false; error: string }> {
  const t = await getTranslations("track");
  const parsed = trackSchema.safeParse(input);
  if (!parsed.success) {
    const key = SCHEMA_KEYS.find((k) => k === parsed.error.issues[0]?.message);
    return { ok: false, error: t(key ?? "errorCheck") };
  }
  if (!(await rateLimit("track", 10, 600)).ok) return { ok: false, error: t("errorTooMany") };
  const r = await lookupTracking(parsed.data);
  // The server's two failure texts are exported constants: map them to messages.
  if (!r.ok) return { ok: false, error: r.error === NOT_FOUND ? t("errorNotFound") : r.error === LOCKED ? t("errorLocked") : r.error };
  return r;
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
