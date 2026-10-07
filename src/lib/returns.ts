// Returns & exchanges (RMA): policy schema, labels and refund maths.
// Pure and client-safe (no server-only imports) so the account UI, the admin, the server and the tests share one source of truth.
import { z } from "zod";
import type { ReturnCondition, ReturnResolution, ReturnStatus } from "@/generated/prisma/enums";

// ─────────────────────────────── Constants ───────────────────────────────

export const RETURN_REASONS = [
  "Not what I expected",
  "Damaged in transit",
  "Wrong item sent",
  "Scent not for me",
  "Arrived too late",
  "Other",
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export const RETURN_STATUSES: ReturnStatus[] = ["REQUESTED", "APPROVED", "RECEIVED", "REFUNDED", "EXCHANGED", "REJECTED", "CANCELLED"];
export const RETURN_RESOLUTIONS: ReturnResolution[] = ["REFUND", "STORE_CREDIT", "EXCHANGE"];
export const RETURN_CONDITIONS: ReturnCondition[] = ["RESELLABLE", "OPENED", "DAMAGED"];

/** Statuses whose units still count against what may be returned (everything except rejected / cancelled). */
export const COUNTING_STATUSES: ReturnStatus[] = ["REQUESTED", "APPROVED", "RECEIVED", "REFUNDED", "EXCHANGED"];
export const OPEN_STATUSES: ReturnStatus[] = ["REQUESTED", "APPROVED", "RECEIVED"];

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  REQUESTED: "Requested",
  APPROVED: "Approved",
  RECEIVED: "Received",
  REFUNDED: "Refunded",
  EXCHANGED: "Exchanged",
  REJECTED: "Declined",
  CANCELLED: "Cancelled",
};

export const RESOLUTION_LABEL: Record<ReturnResolution, string> = {
  REFUND: "Refund",
  STORE_CREDIT: "Store credit",
  EXCHANGE: "Exchange",
};

export const CONDITION_LABEL: Record<ReturnCondition, string> = {
  RESELLABLE: "Resellable",
  OPENED: "Opened",
  DAMAGED: "Damaged",
};

export const REFUND_METHOD_LABEL: Record<string, string> = {
  PROVIDER: "original payment method",
  MANUAL: "bank transfer arranged by our team",
  GIFT_CARD: "original gift card",
  STORE_CREDIT: "store credit",
};

export function returnStatusTone(s: ReturnStatus): "gold" | "ember" | "muted" {
  if (s === "REJECTED" || s === "CANCELLED") return "ember";
  if (s === "REFUNDED" || s === "EXCHANGED") return "muted";
  return "gold";
}

/** "PROVIDER+GIFT_CARD" → "original payment method and original gift card" */
export const refundMethodText = (m: string | null | undefined) =>
  (m ?? "")
    .split("+")
    .filter(Boolean)
    .map((x) => REFUND_METHOD_LABEL[x] ?? x.toLowerCase())
    .join(" and ");

// ─────────────────────────────── Policy (Setting "returns") ───────────────────────────────

export const returnSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  /** Days after delivery a customer may request a return. */
  windowDays: z.number().int().min(1).max(365).default(14),
  /** Deducted from refunds and store credit (not exchanges); staff can waive it per return. */
  restockingFeePercent: z.number().min(0).max(50).default(0),
  /** Category slugs that can't be returned at all (e.g. "oils" for attars). */
  nonReturnableCategories: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
});
export type ReturnSettings = z.infer<typeof returnSettingsSchema>;
export type ReturnSettingsInput = z.input<typeof returnSettingsSchema>;

export function parseReturnSettings(value: unknown): ReturnSettings {
  const parsed = returnSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : returnSettingsSchema.parse({});
}

/** Last day a return may be requested; null when the order hasn't been delivered. */
export function returnDeadline(deliveredAt: Date | null, windowDays: number) {
  return deliveredAt ? new Date(deliveredAt.getTime() + windowDays * 864e5) : null;
}

// ─────────────────────────────── Refund maths ───────────────────────────────

export type RefundQuote = {
  /** Paid share of the returned lines (after discounts/points, incl. tax; shipping & wrap are not refunded). */
  gross: number;
  fee: number;
  /** What the customer gets back: gross − fee, never more than what is still refundable on the order. */
  amount: number;
  /** Total still refundable on the order before this return. */
  remaining: number;
};

/**
 * Money value of returned lines. Each unit's paid share is its list value scaled by what the order actually
 * charged for goods (total − shipping) over the list subtotal, so coupons, points and exclusive tax are shared fairly.
 */
export function refundQuote(input: {
  order: { subtotal: number; total: number; shipping: number };
  lines: { unitPrice: number; quantity: number }[];
  /** Money already given back for this order by earlier returns. */
  alreadyRefunded?: number;
  feePercent: number;
  waiveFee?: boolean;
}): RefundQuote {
  const goodsCharged = Math.max(0, input.order.total - input.order.shipping);
  const listValue = input.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const remaining = Math.max(0, goodsCharged - (input.alreadyRefunded ?? 0));
  const share = input.order.subtotal > 0 ? Math.round((listValue * goodsCharged) / input.order.subtotal) : 0;
  const gross = Math.min(share, remaining);
  const fee = input.waiveFee ? 0 : Math.min(gross, Math.round((gross * input.feePercent) / 100));
  return { gross, fee, amount: gross - fee, remaining };
}

/** Points to take back for a partial return: the same share of the points earned on the order. */
export function loyaltyClawback(input: { earned: number; alreadyReversed: number; gross: number; goodsCharged: number }) {
  if (input.earned <= 0 || input.goodsCharged <= 0) return 0;
  const share = Math.round((input.earned * input.gross) / input.goodsCharged);
  return Math.max(0, Math.min(share, input.earned - input.alreadyReversed));
}

// ─────────────────────────────── Timeline ───────────────────────────────

export type ReturnTimelineStep = { key: string; label: string; at: Date | null; tone: "done" | "todo" | "stop" };

/** Customer- and staff-facing progress: Requested → Approved → Received → Refunded/Exchanged, or a stop. */
export function returnTimeline(r: {
  status: ReturnStatus;
  resolution: ReturnResolution | null;
  preferred: ReturnResolution;
  requestedAt: Date;
  approvedAt: Date | null;
  receivedAt: Date | null;
  resolvedAt: Date | null;
  rejectedAt: Date | null;
  cancelledAt: Date | null;
}): ReturnTimelineStep[] {
  const res = r.resolution ?? r.preferred;
  const last = res === "EXCHANGE" ? "Exchanged" : res === "STORE_CREDIT" ? "Credited" : "Refunded";
  const steps: ReturnTimelineStep[] = [
    { key: "requested", label: "Requested", at: r.requestedAt, tone: "done" },
    { key: "approved", label: "Approved", at: r.approvedAt, tone: r.approvedAt ? "done" : "todo" },
    { key: "received", label: "Received", at: r.receivedAt, tone: r.receivedAt ? "done" : "todo" },
    { key: "resolved", label: last, at: r.resolvedAt, tone: r.resolvedAt ? "done" : "todo" },
  ];
  if (r.status === "REJECTED" || r.status === "CANCELLED") {
    const kept = steps.filter((s) => s.tone === "done");
    kept.push({ key: r.status.toLowerCase(), label: RETURN_STATUS_LABEL[r.status], at: r.status === "REJECTED" ? r.rejectedAt : r.cancelledAt, tone: "stop" });
    return kept;
  }
  return steps;
}
