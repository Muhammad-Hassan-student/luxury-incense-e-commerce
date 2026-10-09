/**
 * The courier interface shared by the live Shiprocket client and the offline mock (Test mode).
 * Money is in minor units (paise); weights in grams.
 */

export type CourierMode = "live" | "test";

export type CourierRate = {
  courierId: string;
  courierName: string;
  /** Freight incl. COD charge when `cod` was requested, minor units */
  rate: number;
  /** Estimated transit days (null when the courier gave none) */
  etdDays: number | null;
  /** Estimated delivery date */
  etd: Date | null;
  cod: boolean;
  rating: number | null;
  recommended: boolean;
};

export type ServiceabilityQuery = {
  deliveryPincode: string;
  weightGrams: number;
  cod: boolean;
  /** Declared value, minor units */
  declaredValue: number;
};

export type ShipmentParty = {
  name: string;
  phone: string;
  email: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
};

export type CreateShipmentInput = {
  /** Our unique reference (order number, suffixed when re-booked) */
  reference: string;
  orderDate: Date;
  to: ShipmentParty;
  items: { name: string; sku: string; units: number; unitPrice: number }[];
  cod: boolean;
  /** Amount to collect (COD) or order value (prepaid), minor units */
  amount: number;
  shippingCharges: number;
  discount: number;
  weightGrams: number;
  box: { length: number; breadth: number; height: number };
};

export type CreatedShipment = { providerOrderId: string; providerShipmentId: string };

export type AssignedAwb = { awb: string; courierId: string; courierName: string; charges: number | null };

/** A tracking scan, newest last. `statusId` is the courier's numeric code when it gave one. */
export type TrackingScan = { at: Date; label: string; statusId: number | null; location: string | null; raw: unknown };

export type TrackingResult = {
  current: { label: string; statusId: number | null } | null;
  scans: TrackingScan[];
  etd: Date | null;
  trackUrl: string | null;
};

/** Hints only the mock uses to simulate progress (the live client ignores them). */
export type TrackHint = { pickupScheduledAt: Date | null; pincode: string; now?: Date };

export interface CourierClient {
  readonly mode: CourierMode;
  readonly provider: "shiprocket" | "mock";
  serviceability(q: ServiceabilityQuery): Promise<CourierRate[]>;
  createShipment(input: CreateShipmentInput): Promise<CreatedShipment>;
  assignAwb(providerShipmentId: string, courierId?: string | null): Promise<AssignedAwb>;
  /** One merged label PDF for all shipments. `null` = render locally (mock). */
  labels(providerShipmentIds: string[]): Promise<string | null>;
  manifest(providerShipmentIds: string[], providerOrderIds: string[]): Promise<string | null>;
  schedulePickup(providerShipmentIds: string[]): Promise<{ scheduledAt: Date | null; token: string | null }>;
  cancel(providerOrderIds: string[]): Promise<void>;
  track(awb: string, hint?: TrackHint): Promise<TrackingResult>;
}

export class CourierError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "CourierError";
  }
}
