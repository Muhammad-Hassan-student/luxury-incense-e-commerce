import "server-only";
import type { OrderStatus, ShipmentStatus } from "@/generated/prisma/client";
import { CUSTOMER_STATUS_LABEL } from "@/lib/fulfilment";
import { db } from "../db";
import { addrOf } from "./fulfilment";
import { validTrackKey } from "./track-key";

/*
 * Customer-facing tracking. Lookup needs the order number plus the email or phone on the order (or a signed
 * link from our emails). Wrong guesses are counted per order number so one order can't be brute-forced from
 * many IPs; the action adds a per-IP limit on top. Both failure kinds give the same answer.
 */

export type TrackingStep = { at: string; title: string; detail: string | null; status: ShipmentStatus | null; milestone: boolean };

export type TrackingView = {
  number: string;
  orderStatus: OrderStatus;
  placedAt: string;
  destination: string;
  courierName: string | null;
  awb: string | null;
  headline: string;
  shipmentStatus: ShipmentStatus | null;
  etd: string | null;
  deliveredAt: string | null;
  courierTrackUrl: string | null;
  progress: number; // 0 placed · 1 packed · 2 shipped · 3 out for delivery · 4 delivered
  steps: TrackingStep[];
};

const ORDER_MILESTONE: Partial<Record<OrderStatus, string>> = {
  PAID: "Order confirmed",
  PACKED: "Packed and wrapped at the atelier",
  SHIPPED: "Handed to the courier",
  DELIVERED: "Delivered",
  CANCELLED: "Order cancelled",
  REFUNDED: "Refunded",
};

export async function trackingView(orderId: string): Promise<TrackingView | null> {
  const o = await db.order.findUnique({
    where: { id: orderId },
    include: {
      events: { orderBy: { createdAt: "asc" }, select: { status: true, message: true, createdAt: true } },
      shipments: { orderBy: { createdAt: "desc" }, include: { events: { orderBy: { at: "asc" } } } },
    },
  });
  if (!o) return null;
  const s = o.shipments.find((x) => x.active) ?? o.shipments[0] ?? null;
  const a = addrOf(o.shippingAddress);

  const steps: TrackingStep[] = [{ at: o.placedAt.toISOString(), title: "Order placed", detail: null, status: null, milestone: true }];
  const seen = new Set<string>();
  for (const e of o.events) {
    const confirmCod = e.status === "PENDING" && e.message.startsWith("Confirmed");
    const title = confirmCod ? "Order confirmed — cash on delivery" : ORDER_MILESTONE[e.status];
    // Courier milestones come from the scans below; keep the order's own first "shipped/delivered" only without scans.
    if (!title || seen.has(title) || ((e.status === "SHIPPED" || e.status === "DELIVERED") && s?.events.length)) continue;
    seen.add(title);
    steps.push({ at: e.createdAt.toISOString(), title, detail: null, status: null, milestone: true });
  }
  for (const ev of s?.events ?? []) {
    if (ev.rawStatus === "AWB ASSIGNED" || ev.status === "CANCELLED") continue;
    steps.push({
      at: ev.at.toISOString(),
      title: ev.status ? CUSTOMER_STATUS_LABEL[ev.status] : titleCase(ev.rawStatus),
      detail: ev.location,
      status: ev.status,
      milestone: Boolean(ev.status && ["IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"].includes(ev.status)),
    });
  }
  steps.sort((x, y) => x.at.localeCompare(y.at));
  // Our own booking events and the courier's first scan often say the same thing: keep one.
  const unique = steps.filter((st, i) => i === 0 || st.title !== steps[i - 1].title);

  const st = s?.active ? s.status : null;
  const progress =
    o.status === "DELIVERED" || st === "DELIVERED" ? 4 : st === "OUT_FOR_DELIVERY" ? 3 : o.status === "SHIPPED" || st === "IN_TRANSIT" || st === "FAILED_DELIVERY" ? 2 : o.status === "PACKED" || st ? 1 : 0;
  const headline =
    o.status === "CANCELLED" || o.status === "REFUNDED"
      ? "This order was cancelled"
      : st
        ? CUSTOMER_STATUS_LABEL[st]
        : o.status === "DELIVERED"
          ? "Delivered"
          : o.status === "SHIPPED"
            ? "On its way"
            : o.status === "PACKED"
              ? "Packed, awaiting courier"
              : o.reservedUntil
                ? "Awaiting payment"
                : "Being prepared at the atelier";

  return {
    number: o.number,
    orderStatus: o.status,
    placedAt: o.placedAt.toISOString(),
    destination: [a.city, a.state].filter(Boolean).join(", "),
    courierName: s?.active ? s.courierName : (o.carrier ?? null),
    awb: s?.active ? s.awb : (o.trackingNumber ?? null),
    headline,
    shipmentStatus: st,
    etd: s?.active && st !== "DELIVERED" ? (s.etd?.toISOString() ?? null) : null,
    deliveredAt: s?.deliveredAt?.toISOString() ?? null,
    courierTrackUrl: s?.active ? s.trackUrl : null,
    progress,
    steps: unique.reverse(),
  };
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

// ─────────────────────────────── Lookup ───────────────────────────────

const failures = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILS = 8;
const WINDOW_MS = 3600_000;

export const NOT_FOUND = "We couldn’t find an order with those details. Check the order number and use the email or phone you ordered with.";
export const LOCKED = "Too many attempts for this order. Please try again in an hour, or write to our concierge.";

const normNumber = (n: string) => n.trim().toUpperCase().replace(/\s+/g, "");
const lastTen = (s: string) => s.replace(/\D/g, "").slice(-10);

function locked(number: string) {
  const f = failures.get(number);
  if (!f) return false;
  if (f.resetAt < Date.now()) {
    failures.delete(number);
    return false;
  }
  return f.count >= MAX_FAILS;
}
function fail(number: string) {
  const f = failures.get(number);
  if (!f || f.resetAt < Date.now()) failures.set(number, { count: 1, resetAt: Date.now() + WINDOW_MS });
  else f.count++;
}

/**
 * Finds an order for the tracking page. `contact` is the order email (any case) or the delivery phone
 * (last 10 digits must match); `key` is a signed link key instead of contact details.
 */
export async function lookupTracking(input: { number: string; contact?: string; key?: string }): Promise<{ ok: true; view: TrackingView } | { ok: false; error: string }> {
  const number = normNumber(input.number);
  if (!/^[A-Z0-9-]{4,40}$/.test(number)) return { ok: false, error: NOT_FOUND };
  if (locked(number)) return { ok: false, error: LOCKED };
  const order = await db.order.findUnique({ where: { number }, select: { id: true, email: true, shippingAddress: true } });

  let match = false;
  if (order && input.key) match = validTrackKey(number, input.key);
  else if (order && input.contact) {
    const c = input.contact.trim();
    if (c.includes("@")) match = c.toLowerCase() === order.email.toLowerCase();
    else {
      const digits = lastTen(c);
      match = digits.length === 10 && digits === lastTen(addrOf(order.shippingAddress).phone ?? "");
    }
  }
  if (!order || !match) {
    fail(number);
    return { ok: false, error: NOT_FOUND };
  }
  failures.delete(number);
  const view = await trackingView(order.id);
  return view ? { ok: true, view } : { ok: false, error: NOT_FOUND };
}

/** Tests: forget lookup failures. */
export const resetTrackingLimits = () => failures.clear();
