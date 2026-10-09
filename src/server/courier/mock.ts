import { createHash } from "node:crypto";
import {
  CourierError,
  type AssignedAwb,
  type CourierClient,
  type CourierRate,
  type CreateShipmentInput,
  type CreatedShipment,
  type ServiceabilityQuery,
  type TrackHint,
  type TrackingResult,
  type TrackingScan,
} from "./types";

/*
 * Test mode: a deterministic, offline stand-in for Shiprocket. Same interface, no network.
 *  - Rates depend on zone (pickup vs delivery pincode), weight slab and COD, from four familiar couriers.
 *  - AWBs are derived from the shipment id, so retries return the same number.
 *  - Tracking follows a scripted journey that unfolds with time after pickup is scheduled.
 *    Pincodes ending in 13 simulate a failed delivery that turns into an RTO.
 *  - Pincodes starting with 9 (Army Postal Service) or that aren't 6 digits are not serviceable.
 */

export const MOCK_PICKUP_PINCODE = "110001";
const MOCK_CITY: Record<string, string> = { "1": "New Delhi", "2": "Lucknow", "3": "Jaipur", "4": "Mumbai", "5": "Hyderabad", "6": "Chennai", "7": "Kolkata", "8": "Patna" };

const COURIERS = [
  { id: "mock-dlv", name: "Delhivery Surface", base: [45, 60, 80], slab: [20, 28, 38], days: [2, 4, 6], cod: true, rating: 4.3, recommended: true },
  { id: "mock-bd", name: "Blue Dart Air", base: [90, 120, 150], slab: [40, 50, 65], days: [1, 2, 3], cod: true, rating: 4.7, recommended: false },
  { id: "mock-xb", name: "Xpressbees", base: [40, 55, 70], slab: [18, 25, 34], days: [3, 4, 5], cod: true, rating: 3.9, recommended: false },
  { id: "mock-ekart", name: "Ekart Logistics", base: [38, 50, 68], slab: [18, 24, 32], days: [3, 5, 7], cod: false, rating: 3.6, recommended: false },
] as const;

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const digits = (s: string, n: number) => (parseInt(hash(s).slice(0, 12), 16) % 10 ** n).toString().padStart(n, "0");

export const mockServiceable = (pincode: string) => /^[1-8]\d{5}$/.test(pincode);
export const mockRtoPincode = (pincode: string) => pincode.endsWith("13");

function zone(pincode: string) {
  if (pincode.slice(0, 3) === MOCK_PICKUP_PINCODE.slice(0, 3)) return 0;
  if (pincode[0] === MOCK_PICKUP_PINCODE[0]) return 1;
  return 2;
}

/** Adds working days (skips Sundays). */
function addDays(from: Date, days: number) {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0) left--;
  }
  return d;
}

/** The scripted journey for a pincode: [hours after pickup scheduled, label, statusId, location]. */
export function mockScript(pincode: string): [number, string, number, string][] {
  const origin = MOCK_CITY[MOCK_PICKUP_PINCODE[0]] ?? "Origin";
  const dest = MOCK_CITY[pincode[0]] ?? "Destination";
  const head: [number, string, number, string][] = [
    [0, "PICKUP SCHEDULED", 19, origin],
    [2, "PICKED UP", 42, origin],
    [5, "IN TRANSIT", 18, `${origin} hub`],
    [20, "REACHED DESTINATION HUB", 38, `${dest} hub`],
    [30, "OUT FOR DELIVERY", 17, dest],
  ];
  if (!mockRtoPincode(pincode)) return [...head, [34, "DELIVERED", 7, dest]];
  return [
    ...head,
    [34, "UNDELIVERED", 21, `${dest} — customer not available`],
    [54, "OUT FOR DELIVERY", 17, dest],
    [58, "UNDELIVERED", 21, `${dest} — refused`],
    [60, "RTO INITIATED", 9, dest],
    [80, "RTO IN TRANSIT", 46, `${dest} hub`],
    [110, "RTO DELIVERED", 10, origin],
  ];
}

export class MockCourier implements CourierClient {
  readonly mode = "test" as const;
  readonly provider = "mock" as const;

  async serviceability(q: ServiceabilityQuery): Promise<CourierRate[]> {
    if (!mockServiceable(q.deliveryPincode)) return [];
    const z = zone(q.deliveryPincode);
    const slabs = Math.max(1, Math.ceil(q.weightGrams / 500));
    const now = new Date();
    return COURIERS.filter((c) => !q.cod || c.cod)
      .map((c) => ({
        courierId: c.id,
        courierName: c.name,
        rate: (c.base[z] + c.slab[z] * (slabs - 1) + (q.cod ? 35 : 0)) * 100,
        etdDays: c.days[z],
        etd: addDays(now, c.days[z]),
        cod: c.cod,
        rating: c.rating,
        recommended: c.recommended,
      }))
      .sort((a, b) => a.rate - b.rate);
  }

  async createShipment(i: CreateShipmentInput): Promise<CreatedShipment> {
    if (!mockServiceable(i.to.pincode)) throw new CourierError(`Pincode ${i.to.pincode} is not serviceable (test mode).`);
    const h = digits(i.reference, 9);
    return { providerOrderId: `MOCK-O-${h}`, providerShipmentId: `MOCK-S-${h}` };
  }

  async assignAwb(shipmentId: string, courierId?: string | null): Promise<AssignedAwb> {
    const c = COURIERS.find((x) => x.id === courierId) ?? COURIERS.find((x) => x.recommended)!;
    if (courierId && !COURIERS.some((x) => x.id === courierId)) throw new CourierError("That courier isn’t available for this shipment.");
    return { awb: `MOT${digits(`${shipmentId}:${c.id}`, 10)}`, courierId: c.id, courierName: c.name, charges: null };
  }

  async labels() {
    return null;
  }

  async manifest() {
    return null;
  }

  async schedulePickup(): Promise<{ scheduledAt: Date | null; token: string | null }> {
    // Today 3pm if booked before 2pm, else tomorrow 11am (IST-ish, server local time).
    const now = new Date();
    const at = new Date(now);
    if (now.getHours() < 14) at.setHours(15, 0, 0, 0);
    else {
      at.setDate(at.getDate() + 1);
      at.setHours(11, 0, 0, 0);
    }
    return { scheduledAt: at, token: `MOCK-PU-${digits(now.toISOString(), 6)}` };
  }

  async cancel() {}

  async track(awb: string, hint?: TrackHint): Promise<TrackingResult> {
    if (!hint?.pickupScheduledAt) return { current: { label: "AWB ASSIGNED", statusId: 52 }, scans: [], etd: null, trackUrl: null };
    const now = hint.now ?? new Date();
    const start = hint.pickupScheduledAt.getTime();
    const scans: TrackingScan[] = mockScript(hint.pincode)
      .map(([h, label, statusId, location]) => ({ at: new Date(start + h * 3600_000), label, statusId, location, raw: { mock: true, awb, label } }))
      .filter((s) => s.at.getTime() <= now.getTime());
    const last = scans.at(-1);
    return { current: last ? { label: last.label, statusId: last.statusId } : null, scans, etd: new Date(start + 34 * 3600_000), trackUrl: null };
  }
}
