import "server-only";
import { getIntegration, type IntegrationValue } from "../integrations";
import { MockCourier } from "./mock";
import { ShiprocketClient } from "./shiprocket";
import type { CourierClient } from "./types";

export type CourierConfig = IntegrationValue<"courier">;

let override: { client: CourierClient; config: Partial<CourierConfig> } | null = null;

/** Tests: pin the courier (e.g. the mock, or a Shiprocket client over a fake transport). `null` restores. */
export function forceCourier(o: { client: CourierClient; config?: Partial<CourierConfig> } | null) {
  override = o ? { client: o.client, config: o.config ?? {} } : null;
}

const blank: CourierConfig = { enabled: false, email: "", password: "", pickupLocation: "", pickupPincode: "", webhookToken: "", liveRates: false, boxDimensions: "" };

/**
 * The courier to use now: Shiprocket when the integration is on and has an API user, otherwise the offline
 * mock (Test mode). Credentials only ever come from Admin → Integrations (encrypted in the database).
 */
export async function getCourier(): Promise<{ client: CourierClient; config: CourierConfig; live: boolean }> {
  if (override) {
    const config = { ...blank, ...override.config };
    return { client: override.client, config, live: override.client.mode === "live" };
  }
  const config = await getIntegration("courier");
  if (config.enabled && config.email && config.password) {
    return { client: new ShiprocketClient({ email: config.email, password: config.password, pickupLocation: config.pickupLocation, pickupPincode: config.pickupPincode }), config, live: true };
  }
  return { client: new MockCourier(), config, live: false };
}

/** A client able to handle shipments booked with `provider` (old test-mode parcels keep using the mock). */
export async function clientFor(provider: string): Promise<CourierClient | null> {
  const { client } = await getCourier();
  if (client.provider === provider) return client;
  if (provider === "mock") return new MockCourier();
  return null;
}

export function boxOf(config: Pick<CourierConfig, "boxDimensions">) {
  const m = /^(\d{1,3})x(\d{1,3})x(\d{1,3})$/i.exec(config.boxDimensions ?? "");
  return m ? { length: Number(m[1]), breadth: Number(m[2]), height: Number(m[3]) } : { length: 20, breadth: 15, height: 10 };
}

export { CourierError } from "./types";
export type { CourierClient, CourierRate } from "./types";
