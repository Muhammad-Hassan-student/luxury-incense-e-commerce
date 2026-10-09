import type { ShipmentStatus } from "@/generated/prisma/enums";

/*
 * Courier status → our ShipmentStatus. Pure (no I/O) so the webhook, the poller and the tests share it.
 * Shiprocket sends both words ("IN TRANSIT", "RTO INITIATED") and numeric ids; the words are matched first
 * because ids differ between `current_status_id` and `shipment_status_id`, with the id table as a fallback.
 */

/** Shiprocket shipment_status_id → ours (null = informational, keeps the current status). */
const BY_ID: Record<number, ShipmentStatus | null> = {
  6: "IN_TRANSIT", // Shipped
  7: "DELIVERED",
  8: "CANCELLED",
  9: "RTO", // RTO initiated
  10: "RTO_DELIVERED",
  12: "LOST",
  13: null, // Pickup error
  14: "RTO", // RTO acknowledged
  15: "PICKUP_SCHEDULED", // Pickup rescheduled
  16: null, // Cancellation requested
  17: "OUT_FOR_DELIVERY",
  18: "IN_TRANSIT",
  19: "PICKUP_SCHEDULED", // Out for pickup
  20: null, // Pickup exception
  21: "FAILED_DELIVERY", // Undelivered
  22: "IN_TRANSIT", // Delayed
  23: "DELIVERED", // Partial delivered
  24: "LOST", // Destroyed
  25: "LOST", // Damaged
  26: "DELIVERED", // Fulfilled
  38: "IN_TRANSIT", // Reached destination hub
  39: "IN_TRANSIT", // Misrouted
  40: "RTO", // RTO NDR
  41: "RTO", // RTO out for delivery
  42: "IN_TRANSIT", // Picked up
  45: "CANCELLED", // Cancelled before dispatch
  46: "RTO", // RTO in transit
  48: "IN_TRANSIT", // Reached warehouse
  50: "IN_TRANSIT", // In flight
  51: "IN_TRANSIT", // Handover to courier
  52: "AWB_ASSIGNED", // Shipment booked
  75: "RTO", // RTO lock
  76: "LOST", // Untraceable
  77: "FAILED_DELIVERY", // Issue related to the recipient
  78: "RTO", // Reached back at seller city
};

export function mapCourierStatus(label: string | null | undefined, id?: number | null): ShipmentStatus | null {
  const t = ` ${(label ?? "").toUpperCase().replace(/[_\-./]+/g, " ").replace(/\s+/g, " ").trim()} `;
  if (t.trim()) {
    if (/ RTO |RETURN(ED)? TO (ORIGIN|SELLER|SHIPPER)|REACHED BACK AT SELLER/.test(t)) return / DELIVERED /.test(t) ? "RTO_DELIVERED" : "RTO";
    if (/OUT FOR DELIVERY| OFD /.test(t)) return "OUT_FOR_DELIVERY";
    if (/UNDELIVERED|NOT DELIVERED|DELIVERY (FAILED|ATTEMPTED)|FAILED DELIVERY| NDR |ISSUE RELATED TO THE RECIPIENT|CUSTOMER NOT AVAILABLE/.test(t)) return "FAILED_DELIVERY";
    if (/ DELIVERED |FULFILLED/.test(t)) return "DELIVERED";
    if (/CANCEL/.test(t)) return /REQUEST/.test(t) ? null : "CANCELLED";
    if (/ LOST |DESTROYED|DAMAGED|UNTRACEABLE|DISPOSED/.test(t)) return "LOST";
    if (/PICKUP (ERROR|EXCEPTION|FAILED)/.test(t)) return null;
    if (/OUT FOR PICKUP|PICKUP (SCHEDULED|GENERATED|RESCHEDULED|QUEUED|BOOKED)/.test(t)) return "PICKUP_SCHEDULED";
    if (/PICKED UP|IN TRANSIT|SHIPPED|REACHED|IN FLIGHT|HANDOVER|HANDED OVER|MISROUTED|DELAYED|DISPATCHED|ARRIVED|DEPARTED|CONNECTED/.test(t)) return "IN_TRANSIT";
    if (/AWB ASSIGNED|LABEL GENERATED|MANIFEST|SHIPMENT BOOKED|READY TO SHIP/.test(t)) return "AWB_ASSIGNED";
  }
  if (id != null && id in BY_ID) return BY_ID[id];
  return null;
}

const RANK: Record<ShipmentStatus, number> = {
  CREATED: 0,
  AWB_ASSIGNED: 1,
  PICKUP_SCHEDULED: 2,
  IN_TRANSIT: 3,
  OUT_FOR_DELIVERY: 3,
  FAILED_DELIVERY: 3,
  RTO: 4,
  DELIVERED: 5,
  RTO_DELIVERED: 5,
  CANCELLED: 5,
  LOST: 5,
};

export const TERMINAL_SHIPMENT: ShipmentStatus[] = ["DELIVERED", "RTO_DELIVERED", "CANCELLED", "LOST"];

/**
 * Whether a scan with status `incoming` may replace `current`. Never moves backwards (a late "in transit"
 * after "delivered" is kept as history only); within the transit band (transit / out for delivery / failed
 * attempt) the newer scan wins, which `newer` tells.
 */
export function shouldApply(current: ShipmentStatus, incoming: ShipmentStatus, newer: boolean) {
  if (TERMINAL_SHIPMENT.includes(current)) return false;
  if (RANK[incoming] > RANK[current]) return true;
  return RANK[incoming] === RANK[current] && newer && incoming !== current;
}

/** What the order should become for a shipment status (null = leave the order alone). */
export function orderTargetFor(s: ShipmentStatus): "SHIPPED" | "DELIVERED" | null {
  if (s === "DELIVERED") return "DELIVERED";
  if (s === "IN_TRANSIT" || s === "OUT_FOR_DELIVERY" || s === "FAILED_DELIVERY" || s === "RTO" || s === "RTO_DELIVERED") return "SHIPPED";
  return null;
}

export const isRto = (s: ShipmentStatus) => s === "RTO" || s === "RTO_DELIVERED";
