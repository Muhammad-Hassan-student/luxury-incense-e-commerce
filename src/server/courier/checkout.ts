import "server-only";
import type { ShippingRate } from "@/generated/prisma/client";
import { db } from "../db";
import { getCourier } from "./index";
import type { CourierRate } from "./types";

/*
 * Checkout side of the courier: a delivery estimate by pincode and (optionally) the live courier price for
 * the standard shipping option. Never blocks checkout: anything slow or failing falls back to the
 * ShippingRate table. Results are cached briefly per pincode + weight slab so the quote shown and the
 * quote charged at placement agree.
 */

const BUDGET_MS = 3500;
const TTL_MS = 30 * 60_000;
const cache = new Map<string, { at: number; rates: CourierRate[] | null }>();

function withTimeout<T>(p: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error("courier timeout")), ms);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

/** Live rates (null = courier off or failed). Prepaid rates; COD charges are the store's business. */
async function liveRates(pincode: string, weightGrams: number, declaredValue: number): Promise<CourierRate[] | null> {
  const { client, live } = await getCourier();
  if (!live) return null;
  const slab = Math.max(1, Math.ceil(weightGrams / 500));
  const key = `${pincode}:${slab}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rates;
  try {
    const rates = await withTimeout(client.serviceability({ deliveryPincode: pincode, weightGrams: slab * 500, cod: false, declaredValue }), BUDGET_MS);
    cache.set(key, { at: Date.now(), rates });
    return rates;
  } catch (e) {
    console.warn("[courier] live rates unavailable, using the rates table:", e instanceof Error ? e.message : e);
    cache.set(key, { at: Date.now() - TTL_MS + 60_000, rates: null }); // retry in a minute
    return null;
  }
}

/** Tests: drop cached quotes. */
export const forgetCheckoutRates = () => cache.clear();

type QuoteLine = { variantId: string; quantity: number; unitPrice: number; digital: boolean; bundle: { variantId: string }[] | null };

async function cartWeight(lines: QuoteLine[]) {
  const physical = lines.filter((l) => !l.digital);
  const ids = [...new Set(physical.flatMap((l) => (l.bundle?.length ? l.bundle.map((b) => b.variantId) : [l.variantId])))];
  const v = ids.length ? await db.productVariant.findMany({ where: { id: { in: ids } }, select: { id: true, weightGrams: true } }) : [];
  const w = new Map(v.map((x) => [x.id, x.weightGrams]));
  return physical.reduce((g, l) => g + (l.bundle?.length ? l.bundle : [{ variantId: l.variantId }]).reduce((s, b) => s + (w.get(b.variantId) ?? 100), 0) * l.quantity, 0) + 150;
}

const pick = (rates: CourierRate[]) => rates.find((r) => r.recommended) ?? [...rates].sort((a, b) => a.rate - b.rate)[0];
/** Rounded up to the next ₹10 so prices look intentional. */
const roundPrice = (minor: number) => Math.ceil(minor / 1000) * 1000;

/**
 * Shipping options for the quote. When "Charge live courier rates" is on and the address is an Indian
 * pincode, the first (standard) option is priced from the courier; free-shipping thresholds still apply.
 */
export async function withLiveCourierRate<R extends Pick<ShippingRate, "id" | "price" | "etaDays" | "freeOver">>(
  options: R[],
  ctx: { country: string; postalCode?: string | null; lines: QuoteLine[] },
): Promise<R[]> {
  if (!options.length || ctx.country !== "IN" || !/^\d{6}$/.test(ctx.postalCode ?? "") || ctx.lines.every((l) => l.digital)) return options;
  const { config, live } = await getCourier();
  if (!live || !config.liveRates) return options;
  try {
    const weight = await cartWeight(ctx.lines);
    const value = ctx.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    const rates = await liveRates(ctx.postalCode!, weight, value);
    const best = rates?.length ? pick(rates) : null;
    if (!best) return options;
    const [first, ...rest] = options;
    const eta = best.etdDays != null ? `${best.etdDays}–${best.etdDays + 1} business days` : first.etaDays;
    return [{ ...first, price: roundPrice(best.rate), etaDays: eta }, ...rest];
  } catch {
    return options;
  }
}

export type DeliveryEstimate =
  | { serviceable: true; from: string; to: string; label: string; source: "courier" | "table"; cod: boolean | null }
  | { serviceable: false; label: string; source: "courier" };

function addBusinessDays(from: Date, days: number) {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0) left--;
  }
  return d;
}

const fmt = (d: Date) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

function rangeLabel(a: Date, b: Date) {
  return a.toDateString() === b.toDateString() ? `Arrives by ${fmt(a)}` : `Arrives ${fmt(a)} – ${fmt(b)}`;
}

/** Dispatch: same day before 2pm IST, else next business day. */
function dispatchDay(now: Date) {
  const istHour = (now.getUTCHours() + 5.5) % 24;
  return istHour < 14 ? now : addBusinessDays(now, 1);
}

/**
 * Delivery estimate for a pincode. Courier ETDs when Shiprocket is connected; otherwise (or on any error)
 * the default rate's "3–5 business days" from the rates table.
 */
export async function deliveryEstimate(postalCode: string, country = "IN", now = new Date()): Promise<DeliveryEstimate | null> {
  const start = dispatchDay(now);
  if (country === "IN" && /^\d{6}$/.test(postalCode)) {
    const rates = await liveRates(postalCode, 500, 0);
    if (rates && !rates.length) return { serviceable: false, label: "We can’t deliver to this pincode by courier yet — write to our concierge.", source: "courier" };
    const days = rates?.map((r) => r.etdDays).filter((d): d is number => d != null) ?? [];
    if (days.length) {
      const from = addBusinessDays(start, Math.min(...days));
      const to = addBusinessDays(start, pick(rates!).etdDays ?? Math.max(...days));
      const [a, b] = from <= to ? [from, to] : [to, from];
      return { serviceable: true, from: a.toISOString(), to: b.toISOString(), label: rangeLabel(a, b), source: "courier", cod: rates!.some((r) => r.cod) };
    }
  }
  const all = await db.shippingRate.findMany({ orderBy: { position: "asc" } });
  const rate = all.find((r) => r.countries.includes(country)) ?? all.find((r) => r.countries.includes("*"));
  if (!rate) return null;
  const nums = (rate.etaDays.match(/\d+/g) ?? []).map(Number);
  if (!nums.length) return null;
  const from = addBusinessDays(start, Math.min(...nums));
  const to = addBusinessDays(start, Math.max(...nums));
  return { serviceable: true, from: from.toISOString(), to: to.toISOString(), label: rangeLabel(from, to), source: "table", cod: null };
}
