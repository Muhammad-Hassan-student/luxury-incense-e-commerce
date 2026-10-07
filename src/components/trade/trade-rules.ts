/**
 * Trade (wholesale) rules shared by the buyer UI, admin UI, server and tests.
 * Client-safe: no server imports. The server always re-checks with these same functions.
 */
import type { QuoteStatus, TradeStatus, TradeTerms } from "@/generated/prisma/enums";

export const BUSINESS_TYPES = [
  { value: "RETAILER", label: "Boutique or retailer", taxIdRequired: true },
  { value: "DISTRIBUTOR", label: "Distributor or wholesaler", taxIdRequired: true },
  { value: "ONLINE", label: "Online store", taxIdRequired: true },
  { value: "HOSPITALITY", label: "Hotel or restaurant", taxIdRequired: false },
  { value: "SPA", label: "Spa or wellness studio", taxIdRequired: false },
  { value: "CORPORATE", label: "Corporate gifting", taxIdRequired: false },
  { value: "OTHER", label: "Something else", taxIdRequired: false },
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number]["value"];
export const BUSINESS_TYPE_VALUES = BUSINESS_TYPES.map((b) => b.value) as [BusinessType, ...BusinessType[]];

export const businessTypeLabel = (v: string) => BUSINESS_TYPES.find((b) => b.value === v)?.label ?? v;
/** Resellers must give a tax registration; hospitality, spas and gifting buyers may not have one to hand. */
export const taxIdRequired = (v: string) => BUSINESS_TYPES.find((b) => b.value === v)?.taxIdRequired ?? false;

export const VOLUME_BANDS = ["Under ₹50,000 a month", "₹50,000 – ₹2 lakh a month", "₹2 lakh – ₹10 lakh a month", "Over ₹10 lakh a month", "Seasonal or one-off"] as const;
export type VolumeBand = (typeof VOLUME_BANDS)[number];

export const TERMS = ["PREPAID", "NET_15", "NET_30", "NET_60"] as const satisfies readonly TradeTerms[];
export const TERMS_LABEL: Record<TradeTerms, string> = { PREPAID: "Prepaid (proforma)", NET_15: "Net 15", NET_30: "Net 30", NET_60: "Net 60" };
/** Days until the invoice is due. Prepaid proformas are held for three days. */
export const TERMS_DAYS: Record<TradeTerms, number> = { PREPAID: 3, NET_15: 15, NET_30: 30, NET_60: 60 };
export const isCreditTerms = (t: TradeTerms) => t !== "PREPAID";

export const TRADE_STATUS_LABEL: Record<TradeStatus, string> = { PENDING: "Under review", APPROVED: "Approved", REJECTED: "Not approved", SUSPENDED: "Suspended" };
export const tradeStatusTone = (s: TradeStatus): "gold" | "ember" | "muted" => (s === "APPROVED" ? "gold" : s === "PENDING" ? "muted" : "ember");

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  REQUESTED: "Requested",
  QUOTED: "Quoted",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  CANCELLED: "Withdrawn",
};
export const quoteStatusTone = (s: QuoteStatus): "gold" | "ember" | "muted" => (s === "QUOTED" || s === "ACCEPTED" ? "gold" : s === "REQUESTED" ? "muted" : "ember");

/** Per-unit trade price: the tier's override for the variant, else retail less the tier discount (rounded to the paisa). */
export function tradeUnitPrice(retail: number, discountPercent: number, override?: number | null) {
  if (override != null) return override;
  const pct = Math.min(100, Math.max(0, discountPercent));
  return Math.round((retail * (100 - pct)) / 100);
}

/** Why a quantity can't be ordered, or null. 0 means "not ordering this line". */
export function quantityProblem(qty: number, caseSize: number, minQty: number): string | null {
  if (!Number.isInteger(qty) || qty < 0) return "Enter a whole number";
  if (qty === 0) return null;
  const cs = Math.max(1, caseSize);
  if (qty % cs !== 0) return `Order in cases of ${cs}`;
  if (qty < minQty) return `Minimum ${minQty}`;
  return null;
}

/** Smallest valid quantity ≥ `wanted` (multiple of case size, at least the minimum). */
export function roundUpQty(wanted: number, caseSize: number, minQty: number) {
  const cs = Math.max(1, caseSize);
  const target = Math.max(wanted, minQty, 1);
  return Math.ceil(target / cs) * cs;
}

/** The account's own minimum overrides its tier's when set (> 0). */
export const minimumOrderFor = (account: { minOrderValue: number }, tier: { minOrderValue: number } | null | undefined) =>
  account.minOrderValue > 0 ? account.minOrderValue : (tier?.minOrderValue ?? 0);

export type ShippingRateLike = { id: string; name: string; countries: string[]; price: number; freeOver: number | null; etaDays: string };

/** Mirrors the rate selection in quote() (src/server/orders.ts) so the UI can show options before the server re-quotes. */
export function ratesFor<T extends { countries: string[] }>(rates: T[], country: string) {
  const eligible = rates.filter((r) => r.countries.includes(country) || r.countries.includes("*"));
  const specific = eligible.filter((r) => !r.countries.includes("*"));
  return specific.length ? specific : eligible;
}

export type InvoiceState = "paid" | "overdue" | "due" | "void";

/** Payment state of a trade order's invoice. */
export function invoiceState(o: { status: string; paidAt: Date | string | null; dueDate: Date | string | null }, now = new Date()): InvoiceState {
  if (o.status === "CANCELLED" || o.status === "REFUNDED") return "void";
  if (o.paidAt) return "paid";
  if (o.dueDate && new Date(o.dueDate).getTime() < now.getTime()) return "overdue";
  return "due";
}

export const INVOICE_STATE_LABEL: Record<InvoiceState, string> = { paid: "Paid", overdue: "Overdue", due: "Due", void: "Void" };
export const invoiceStateTone = (s: InvoiceState): "gold" | "ember" | "muted" => (s === "paid" ? "gold" : s === "overdue" ? "ember" : "muted");

export const MAX_LINE_QTY = 100_000;
export const MAX_ORDER_LINES = 200;
