/**
 * Client-safe fulfilment helpers: board columns, SLA ageing and status wording.
 * Shared by the admin board, the customer tracking views and the server.
 */
import type { OrderStatus, ShipmentStatus } from "@/generated/prisma/enums";

export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  CREATED: "Booked",
  AWB_ASSIGNED: "Label ready",
  PICKUP_SCHEDULED: "Pickup scheduled",
  IN_TRANSIT: "In transit",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  FAILED_DELIVERY: "Delivery attempt failed",
  RTO: "Returning to us",
  RTO_DELIVERED: "Returned to us",
  CANCELLED: "Cancelled",
  LOST: "Lost / damaged",
};

/** Customer-facing wording (gentler; no courier jargon). */
export const CUSTOMER_STATUS_LABEL: Record<ShipmentStatus, string> = {
  CREATED: "Preparing your parcel",
  AWB_ASSIGNED: "Packed, awaiting courier",
  PICKUP_SCHEDULED: "Courier pickup scheduled",
  IN_TRANSIT: "On its way",
  OUT_FOR_DELIVERY: "Out for delivery today",
  DELIVERED: "Delivered",
  FAILED_DELIVERY: "Delivery attempted — we’ll try again",
  RTO: "Being returned to the atelier",
  RTO_DELIVERED: "Returned to the atelier",
  CANCELLED: "Shipment cancelled",
  LOST: "Delayed — our concierge is on it",
};

export const EXCEPTION_STATUSES: ShipmentStatus[] = ["FAILED_DELIVERY", "RTO", "RTO_DELIVERED", "LOST"];

export const BOARD_COLUMNS = [
  { key: "TO_PACK", label: "To pack", hint: "Paid or COD-confirmed" },
  { key: "PACKED", label: "Packed", hint: "Needs an AWB" },
  { key: "READY", label: "Ready for pickup", hint: "Labelled, awaiting courier" },
  { key: "IN_TRANSIT", label: "In transit", hint: "With the courier" },
  { key: "DELIVERED", label: "Delivered", hint: "Last 3 days" },
  { key: "EXCEPTIONS", label: "Exceptions", hint: "RTO, failed attempts, lost" },
] as const;

export type BoardColumn = (typeof BOARD_COLUMNS)[number]["key"];

type ColumnInput = {
  status: OrderStatus;
  reservedUntil: Date | string | null;
  rtoAt: Date | string | null;
  shipment: { status: ShipmentStatus; awb: string | null } | null;
};

/** Which board column an order sits in, or null when it doesn't belong on the board. */
export function boardColumn(o: ColumnInput): BoardColumn | null {
  const s = o.shipment;
  if (o.status === "CANCELLED" || o.status === "REFUNDED") return null;
  if (o.rtoAt || (s && EXCEPTION_STATUSES.includes(s.status))) return "EXCEPTIONS";
  if (o.status === "DELIVERED") return "DELIVERED";
  if (o.status === "SHIPPED") return "IN_TRANSIT";
  if (s?.awb && s.status !== "CANCELLED") return "READY";
  if (o.status === "PACKED") return "PACKED";
  if (o.status === "PAID" || (o.status === "PENDING" && !o.reservedUntil)) return "TO_PACK";
  return null;
}

export type SlaTone = "ok" | "warn" | "late";

/** "4h", "2d 3h"… with a tone: under 12h fine, 12–24h getting late, over a day overdue. */
export function slaAge(since: Date | string, now: Date = new Date(), thresholds: { warn: number; late: number } = { warn: 12, late: 24 }) {
  const hours = Math.max(0, (now.getTime() - new Date(since).getTime()) / 3_600_000);
  const label = hours < 1 ? `${Math.max(1, Math.round(hours * 60))}m` : hours < 24 ? `${Math.floor(hours)}h` : `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h`;
  const tone: SlaTone = hours >= thresholds.late ? "late" : hours >= thresholds.warn ? "warn" : "ok";
  return { hours, label, tone };
}

export type PickItem = { sku: string; name: string; label: string; quantity: number; digital?: boolean; components?: { sku: string; name: string; label: string }[] };
export type PickRow = { sku: string; name: string; label: string; quantity: number; orders: string[]; inCoffret: boolean };

/**
 * Aggregated pick list: one row per SKU with total units and the orders that need it. Coffrets are picked
 * as their pieces; gift cards (digital) are skipped.
 */
export function buildPickList(orders: { number: string; items: PickItem[] }[]): PickRow[] {
  const rows = new Map<string, PickRow>();
  const add = (sku: string, name: string, label: string, qty: number, number: string, inCoffret: boolean) => {
    const r = rows.get(sku) ?? { sku, name, label, quantity: 0, orders: [], inCoffret: false };
    r.quantity += qty;
    r.inCoffret ||= inCoffret;
    if (!r.orders.includes(number)) r.orders.push(number);
    rows.set(sku, r);
  };
  for (const o of orders) {
    for (const i of o.items) {
      if (i.digital) continue;
      if (i.components?.length) for (const c of i.components) add(c.sku, c.name, c.label, i.quantity, o.number, true);
      else add(i.sku, i.name, i.label, i.quantity, o.number, false);
    }
  }
  return [...rows.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}
