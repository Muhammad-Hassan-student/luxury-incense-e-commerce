import "server-only";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { z } from "zod";
import { env } from "@/env";
import { db } from "../db";
import {
  CourierError,
  type AssignedAwb,
  type CourierClient,
  type CourierRate,
  type CreateShipmentInput,
  type CreatedShipment,
  type ServiceabilityQuery,
  type TrackingResult,
} from "./types";

/*
 * Shiprocket API v1 ("external") over fetch.
 *  - Token auth: POST /auth/login gives a 10-day bearer token. It is cached for 9 days in memory and in the
 *    `Setting` table (encrypted, keyed to the API user) and refreshed once on a 401.
 *  - Every call has a timeout; reads (and idempotent writes) retry on 5xx / network errors with backoff.
 *    Creating an order never retries blindly (it could book twice) — the caller re-checks instead.
 *  - Responses are parsed with zod; anything unexpected becomes a CourierError with a readable message.
 *  - Credentials and tokens never appear in logs or error messages.
 */

const BASE = "https://apiv2.shiprocket.in/v1/external";
const TOKEN_TTL_MS = 9 * 24 * 3600_000;
const TOKEN_KEY = "courier:shiprocket-token";

export type ShiprocketCreds = { email: string; password: string; pickupLocation: string; pickupPincode: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
let transport: FetchLike | null = null;
/** Tests swap the network for a fake Shiprocket. Also drops cached tokens. */
export function setCourierTransport(f: FetchLike | null) {
  transport = f;
  tokenMemo = null;
  pincodeMemo = null;
}
const doFetch: FetchLike = (url, init) => (transport ?? fetch)(url, init);

// ─────────────────────────────── Token cache ───────────────────────────────

let tokenMemo: { sig: string; token: string; exp: number } | null = null;
let pincodeMemo: { sig: string; pin: string } | null = null;

const credSig = (c: ShiprocketCreds) => createHash("sha256").update(`${c.email}\n${c.password}`).digest("hex").slice(0, 32);

function boxKey() {
  return Buffer.from(hkdfSync("sha256", env.AUTH_SECRET, "maison-oud/courier", "courier-token-v1", 32));
}
function seal(text: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", boxKey(), iv);
  const ct = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64") };
}
function unseal(v: unknown): string | null {
  const p = z.object({ iv: z.string(), tag: z.string(), ct: z.string() }).safeParse(v);
  if (!p.success) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", boxKey(), Buffer.from(p.data.iv, "base64"));
    d.setAuthTag(Buffer.from(p.data.tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(p.data.ct, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

async function loadToken(sig: string) {
  if (tokenMemo?.sig === sig && tokenMemo.exp > Date.now()) return tokenMemo.token;
  if (transport) return null; // tests: never read a real cached token
  const row = await db.setting.findUnique({ where: { key: TOKEN_KEY } }).catch(() => null);
  const v = row?.value as { sig?: string; exp?: number; box?: unknown } | null;
  if (v?.sig === sig && typeof v.exp === "number" && v.exp > Date.now()) {
    const token = unseal(v.box);
    if (token) {
      tokenMemo = { sig, token, exp: v.exp };
      return token;
    }
  }
  return null;
}

async function storeToken(sig: string, token: string) {
  const exp = Date.now() + TOKEN_TTL_MS;
  tokenMemo = { sig, token, exp };
  if (transport) return;
  const value = { sig, exp, box: seal(token) };
  await db.setting.upsert({ where: { key: TOKEN_KEY }, create: { key: TOKEN_KEY, value }, update: { value } }).catch(() => {});
}

async function forgetToken() {
  tokenMemo = null;
  if (!transport) await db.setting.deleteMany({ where: { key: TOKEN_KEY } }).catch(() => {});
}

// ─────────────────────────────── HTTP ───────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errorText(body: unknown, status: number) {
  if (body && typeof body === "object") {
    const b = body as { message?: unknown; errors?: unknown };
    const parts: string[] = [];
    if (typeof b.message === "string" && b.message) parts.push(b.message);
    if (b.errors && typeof b.errors === "object") {
      for (const [k, v] of Object.entries(b.errors as Record<string, unknown>)) parts.push(`${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
    }
    if (parts.length) return parts.join(" · ").slice(0, 300);
  }
  if (status === 401 || status === 403) return "Shiprocket rejected the API credentials — check Admin → Integrations → Courier.";
  if (status === 429) return "Shiprocket rate limit hit — try again in a minute.";
  if (status >= 500) return `Shiprocket is having trouble (HTTP ${status}). Try again shortly.`;
  return `Shiprocket returned HTTP ${status}.`;
}

type CallOpts<T> = {
  body?: unknown;
  query?: Record<string, string | number>;
  schema: z.ZodType<T>;
  /** Extra attempts on 5xx / network errors */
  retries?: number;
  timeoutMs?: number;
  /** Return null instead of throwing on 404 (e.g. pincode not serviceable) */
  allow404?: boolean;
};

export class ShiprocketClient implements CourierClient {
  readonly mode = "live" as const;
  readonly provider = "shiprocket" as const;
  constructor(private readonly creds: ShiprocketCreds) {}

  private async token(fresh = false): Promise<string> {
    const sig = credSig(this.creds);
    if (!fresh) {
      const cached = await loadToken(sig);
      if (cached) return cached;
    }
    const res = await this.raw("POST", "/auth/login", { email: this.creds.email, password: this.creds.password }, null, 15_000, 1);
    const parsed = z.object({ token: z.string().min(10) }).safeParse(res.body);
    if (!res.ok || !parsed.success) {
      throw new CourierError(res.status === 400 || res.status === 401 || res.status === 403 ? "Shiprocket login failed — check the API user email and password in Admin → Integrations." : errorText(res.body, res.status), res.status);
    }
    await storeToken(sig, parsed.data.token);
    return parsed.data.token;
  }

  /** One request with timeout + retry on 5xx/network. Returns status and parsed JSON (or text). */
  private async raw(method: "GET" | "POST", path: string, body: unknown, token: string | null, timeoutMs: number, retries: number, query?: Record<string, string | number>) {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) await sleep(Math.min(4000, 400 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 150));
      try {
        const res = await doFetch(url.toString(), {
          method,
          headers: { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        });
        if (res.status >= 500 && attempt < retries) {
          lastErr = new CourierError(errorText(null, res.status), res.status, true);
          continue;
        }
        const text = await res.text();
        let json: unknown = text;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          /* non-JSON body (HTML error page) */
        }
        return { ok: res.ok, status: res.status, body: json };
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr instanceof CourierError) throw lastErr;
    const timedOut = lastErr instanceof Error && (lastErr.name === "TimeoutError" || lastErr.name === "AbortError");
    throw new CourierError(timedOut ? "Shiprocket did not answer in time." : "Could not reach Shiprocket (network error).", undefined, true);
  }

  private async call<T>(method: "GET" | "POST", path: string, o: CallOpts<T>): Promise<T | null> {
    const retries = o.retries ?? (method === "GET" ? 2 : 0);
    const timeoutMs = o.timeoutMs ?? 15_000;
    let token = await this.token();
    let res = await this.raw(method, path, o.body, token, timeoutMs, retries, o.query);
    if (res.status === 401) {
      // Token expired or revoked early: log in again once.
      await forgetToken();
      token = await this.token(true);
      res = await this.raw(method, path, o.body, token, timeoutMs, retries, o.query);
    }
    if (res.status === 404 && o.allow404) return null;
    if (!res.ok) throw new CourierError(errorText(res.body, res.status), res.status, res.status >= 500);
    const parsed = o.schema.safeParse(res.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new CourierError(`Unexpected Shiprocket response from ${path} (${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}).`);
    }
    return parsed.data;
  }

  // ─────────────────────────────── Endpoints ───────────────────────────────

  private async pickupPincode(): Promise<string> {
    if (this.creds.pickupPincode) return this.creds.pickupPincode;
    const sig = `${credSig(this.creds)}:${this.creds.pickupLocation}`;
    if (pincodeMemo?.sig === sig) return pincodeMemo.pin;
    const data = await this.call("GET", "/settings/company/pickup", {
      schema: z.object({ data: z.object({ shipping_address: z.array(z.object({ pickup_location: z.string(), pin_code: numStr })).default([]) }) }),
    });
    const list = data?.data.shipping_address ?? [];
    const hit = list.find((a) => a.pickup_location.toLowerCase() === this.creds.pickupLocation.toLowerCase()) ?? list[0];
    if (!hit) throw new CourierError("No pickup address in Shiprocket — add one under Settings → Pickup addresses.");
    pincodeMemo = { sig, pin: hit.pin_code };
    return hit.pin_code;
  }

  async serviceability(q: ServiceabilityQuery): Promise<CourierRate[]> {
    const pickup = await this.pickupPincode();
    const data = await this.call("GET", "/courier/serviceability/", {
      query: { pickup_postcode: pickup, delivery_postcode: q.deliveryPincode, weight: kg(q.weightGrams), cod: q.cod ? 1 : 0, declared_value: Math.round(q.declaredValue / 100) },
      allow404: true,
      timeoutMs: 8_000,
      retries: 1,
      schema: serviceabilitySchema,
    });
    const list = data?.data?.available_courier_companies ?? [];
    const rec = data?.data?.shiprocket_recommended_courier_id ?? data?.data?.recommended_courier_company_id ?? null;
    return list
      .filter((c) => !q.cod || c.cod === 1)
      .map((c) => {
        const days = c.estimated_delivery_days != null && c.estimated_delivery_days !== "" ? Number(c.estimated_delivery_days) : null;
        const etd = c.etd ? new Date(c.etd) : null;
        return {
          courierId: String(c.courier_company_id),
          courierName: c.courier_name,
          rate: Math.round(Number(c.rate ?? c.freight_charge ?? 0) * 100),
          etdDays: days != null && Number.isFinite(days) ? days : null,
          etd: etd && !Number.isNaN(etd.getTime()) ? etd : null,
          cod: c.cod === 1,
          rating: c.rating != null && Number.isFinite(Number(c.rating)) ? Number(c.rating) : null,
          recommended: rec != null && String(rec) === String(c.courier_company_id),
        };
      })
      .sort((a, b) => a.rate - b.rate);
  }

  async createShipment(i: CreateShipmentInput): Promise<CreatedShipment> {
    const [first, ...rest] = i.to.name.trim().split(/\s+/);
    const ist = new Date(i.orderDate.getTime() + 330 * 60_000).toISOString();
    const rupees = (m: number) => Math.round(m) / 100;
    const data = await this.call("POST", "/orders/create/adhoc", {
      timeoutMs: 20_000,
      body: {
        order_id: i.reference,
        order_date: `${ist.slice(0, 10)} ${ist.slice(11, 16)}`,
        pickup_location: this.creds.pickupLocation || "Primary",
        billing_customer_name: first ?? i.to.name,
        billing_last_name: rest.join(" "),
        billing_address: i.to.line1,
        billing_address_2: i.to.line2 ?? "",
        billing_city: i.to.city,
        billing_pincode: i.to.pincode,
        billing_state: i.to.state,
        billing_country: i.to.country === "IN" ? "India" : i.to.country,
        billing_email: i.to.email,
        billing_phone: i.to.phone.replace(/\D/g, "").slice(-10),
        shipping_is_billing: true,
        order_items: i.items.map((it) => ({ name: it.name.slice(0, 200), sku: it.sku, units: it.units, selling_price: rupees(it.unitPrice), discount: 0, tax: 0, hsn: "" })),
        payment_method: i.cod ? "COD" : "Prepaid",
        shipping_charges: rupees(i.shippingCharges),
        giftwrap_charges: 0,
        transaction_charges: 0,
        total_discount: rupees(i.discount),
        sub_total: rupees(i.amount),
        length: i.box.length,
        breadth: i.box.breadth,
        height: i.box.height,
        weight: kg(i.weightGrams),
      },
      schema: z.looseObject({ order_id: numStr.optional(), shipment_id: numStr.optional(), status: z.string().nullish(), message: z.string().nullish() }),
    });
    if (!data?.order_id || !data.shipment_id) throw new CourierError(data?.message || "Shiprocket did not return a shipment id.");
    return { providerOrderId: data.order_id, providerShipmentId: data.shipment_id };
  }

  async assignAwb(shipmentId: string, courierId?: string | null): Promise<AssignedAwb> {
    const data = await this.call("POST", "/courier/assign/awb", {
      body: { shipment_id: Number(shipmentId) || shipmentId, ...(courierId ? { courier_id: Number(courierId) || courierId } : {}) },
      retries: 1,
      timeoutMs: 25_000,
      schema: z.looseObject({
        awb_assign_status: z.coerce.number().optional(),
        message: z.string().nullish(),
        response: z
          .looseObject({
            data: z.looseObject({
              awb_code: z.union([z.string(), z.number()]).transform(String).nullish(),
              courier_company_id: numStr.nullish(),
              courier_name: z.string().nullish(),
              freight_charges: z.union([z.number(), z.string()]).nullish(),
              awb_assign_error: z.string().nullish(),
            }),
          })
          .nullish(),
      }),
    });
    const d = data?.response?.data;
    if (!d?.awb_code || data?.awb_assign_status === 0) throw new CourierError(d?.awb_assign_error || data?.message || "Shiprocket could not assign an AWB for this courier.");
    const freight = d.freight_charges != null ? Number(d.freight_charges) : NaN;
    return { awb: d.awb_code, courierId: d.courier_company_id ?? String(courierId ?? ""), courierName: d.courier_name ?? "Courier", charges: Number.isFinite(freight) ? Math.round(freight * 100) : null };
  }

  async labels(shipmentIds: string[]) {
    const data = await this.call("POST", "/courier/generate/label", {
      body: { shipment_id: shipmentIds.map((s) => Number(s) || s) },
      retries: 2,
      timeoutMs: 30_000,
      schema: z.looseObject({ label_created: z.coerce.number().optional(), label_url: z.string().nullish(), response: z.string().nullish(), message: z.string().nullish() }),
    });
    if (!data?.label_url) throw new CourierError(data?.response || data?.message || "Shiprocket could not generate the labels.");
    return data.label_url;
  }

  async manifest(shipmentIds: string[], orderIds: string[]) {
    try {
      const data = await this.call("POST", "/manifests/generate", {
        body: { shipment_id: shipmentIds.map((s) => Number(s) || s) },
        timeoutMs: 30_000,
        schema: z.looseObject({ manifest_url: z.string().nullish(), message: z.string().nullish() }),
      });
      if (data?.manifest_url) return data.manifest_url;
    } catch (e) {
      // Already generated: print the existing one instead.
      if (!(e instanceof CourierError) || !/already/i.test(e.message)) throw e;
    }
    const printed = await this.call("POST", "/manifests/print", {
      body: { order_ids: orderIds.map((s) => Number(s) || s) },
      retries: 2,
      schema: z.looseObject({ manifest_url: z.string().nullish(), message: z.string().nullish() }),
    });
    if (!printed?.manifest_url) throw new CourierError(printed?.message || "Shiprocket could not generate the manifest.");
    return printed.manifest_url;
  }

  async schedulePickup(shipmentIds: string[]) {
    try {
      const data = await this.call("POST", "/courier/generate/pickup", {
        body: { shipment_id: shipmentIds.map((s) => Number(s) || s) },
        retries: 1,
        timeoutMs: 25_000,
        schema: z.looseObject({
          pickup_status: z.coerce.number().optional(),
          message: z.string().nullish(),
          response: z.looseObject({ pickup_scheduled_date: z.string().nullish(), pickup_token_number: z.union([z.string(), z.number()]).transform(String).nullish() }).nullish(),
        }),
      });
      const when = data?.response?.pickup_scheduled_date ? new Date(data.response.pickup_scheduled_date.replace(" ", "T") + "+05:30") : null;
      return { scheduledAt: when && !Number.isNaN(when.getTime()) ? when : null, token: data?.response?.pickup_token_number ?? null };
    } catch (e) {
      // "Already in pickup queue" is success for our purposes.
      if (e instanceof CourierError && /already/i.test(e.message)) return { scheduledAt: null, token: null };
      throw e;
    }
  }

  async cancel(orderIds: string[]) {
    await this.call("POST", "/orders/cancel", {
      body: { ids: orderIds.map((s) => Number(s) || s) },
      retries: 1,
      schema: z.unknown(),
    });
  }

  async track(awb: string): Promise<TrackingResult> {
    const data = await this.call("GET", `/courier/track/awb/${encodeURIComponent(awb)}`, { schema: trackSchema, allow404: true });
    const t = data?.tracking_data;
    if (!t) return { current: null, scans: [], etd: null, trackUrl: null };
    const scans = (t.shipment_track_activities ?? [])
      .map((a) => {
        const label = a["sr-status-label"] && a["sr-status-label"] !== "NA" ? a["sr-status-label"] : (a.activity ?? a.status ?? "");
        const id = a["sr-status"] != null && a["sr-status"] !== "NA" ? Number(a["sr-status"]) : null;
        return { at: parseCourierDate(a.date) ?? new Date(), label: label || "Update", statusId: Number.isFinite(id) ? id : null, location: a.location || null, raw: a };
      })
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    const head = t.shipment_track?.[0];
    const etd = parseCourierDate(t.etd ?? head?.edd ?? null);
    return {
      current: head?.current_status ? { label: head.current_status, statusId: t.shipment_status ?? null } : null,
      scans,
      etd,
      trackUrl: t.track_url ?? null,
    };
  }
}

// ─────────────────────────────── Schemas & helpers ───────────────────────────────

const numStr = z.union([z.number(), z.string()]).transform((v) => String(v));
const kg = (grams: number) => Math.max(0.1, Math.round(grams) / 1000).toFixed(2);

const serviceabilitySchema = z.looseObject({
  status: z.coerce.number().optional(),
  data: z
    .looseObject({
      available_courier_companies: z
        .array(
          z.looseObject({
            courier_company_id: numStr,
            courier_name: z.string(),
            rate: z.union([z.number(), z.string()]).nullish(),
            freight_charge: z.union([z.number(), z.string()]).nullish(),
            etd: z.string().nullish(),
            estimated_delivery_days: z.union([z.number(), z.string()]).nullish(),
            cod: z.coerce.number().optional(),
            rating: z.union([z.number(), z.string()]).nullish(),
          }),
        )
        .default([]),
      recommended_courier_company_id: numStr.nullish(),
      shiprocket_recommended_courier_id: numStr.nullish(),
    })
    .nullish(),
});

const trackSchema = z.looseObject({
  tracking_data: z
    .looseObject({
      track_status: z.coerce.number().nullish(),
      shipment_status: z.coerce.number().nullish(),
      shipment_track: z.array(z.looseObject({ current_status: z.string().nullish(), edd: z.string().nullish() })).nullish(),
      shipment_track_activities: z
        .array(
          z.looseObject({
            date: z.string().nullish(),
            status: z.string().nullish(),
            activity: z.string().nullish(),
            location: z.string().nullish(),
            "sr-status": z.union([z.string(), z.number()]).nullish(),
            "sr-status-label": z.string().nullish(),
          }),
        )
        .nullish(),
      track_url: z.string().nullish(),
      etd: z.string().nullish(),
    })
    .nullish(),
});

/**
 * Courier timestamps come as "2026-10-09 14:05:00" (IST, no zone), "09 10 2026 14:05:00" (webhook
 * current_timestamp) or ISO. Returns null when unparseable.
 */
export function parseCourierDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const v = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}+05:30`);
  m = /^(\d{2})[ -](\d{2})[ -](\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] ?? "00"}+05:30`);
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return new Date(`${v}T18:00:00+05:30`);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
