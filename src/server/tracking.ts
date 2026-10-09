import "server-only";
import { createHash } from "node:crypto";
import { db } from "./db";
import { getIntegration } from "./integrations";
import { firstDelivery } from "./webhooks";
import { CONSENT_COOKIE, purchaseEventId } from "@/lib/analytics-shared";

/**
 * Server-side conversion events, sent once per order when it is confirmed:
 *   • GA4 Measurement Protocol `purchase` (deduplicated by GA on transaction_id)
 *   • Meta Conversions API `Purchase` (deduplicated with the browser pixel on event_id)
 * Only for shoppers who accepted cookies at checkout. Failures are logged and never reach the customer.
 */

export const META_GRAPH_VERSION = "v23.0";
const TIMEOUT_MS = 4000;

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
let fetchImpl: FetchLike = (url, init) => fetch(url, init);
/** Tests swap the network out. */
export function setTrackingFetch(f: FetchLike | null) {
  fetchImpl = f ?? ((url, init) => fetch(url, init));
}

// ─────────────────────────────── Attribution captured at checkout ───────────────────────────────

export type CheckoutTracking = {
  consent: boolean;
  ip?: string;
  ua?: string;
  fbp?: string;
  fbc?: string;
  /** GA client id from the _ga cookie ("123.456"). */
  gaClientId?: string;
  pageUrl?: string;
};

type CookieReader = { get(name: string): { value: string } | undefined };
type HeaderReader = { get(name: string): string | null };

/** What we may keep for server-side events: nothing at all without consent. */
export function attributionFrom(cookies: CookieReader, headers: HeaderReader): CheckoutTracking {
  if (cookies.get(CONSENT_COOKIE)?.value !== "granted") return { consent: false };
  const ga = cookies.get("_ga")?.value?.match(/^GA\d\.\d\.(\d+\.\d+)$/)?.[1];
  const ip = (headers.get("x-forwarded-for")?.split(",")[0] ?? headers.get("x-real-ip") ?? "").trim();
  const origin = headers.get("origin") ?? "";
  return {
    consent: true,
    ip: ip || undefined,
    ua: headers.get("user-agent")?.slice(0, 400) || undefined,
    fbp: cookies.get("_fbp")?.value?.slice(0, 200) || undefined,
    fbc: cookies.get("_fbc")?.value?.slice(0, 300) || undefined,
    gaClientId: ga,
    pageUrl: origin ? `${origin}/checkout` : undefined,
  };
}

// ─────────────────────────────── Hashing (Meta customer information parameters) ───────────────────────────────

export const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

/** Meta: trim + lowercase, then SHA-256. */
export const hashEmail = (email: string) => sha256(email.trim().toLowerCase());

/** Meta: digits only, including the country code, no leading zeros or "+", then SHA-256. */
export function normalizePhone(phone: string, country = "IN") {
  let d = phone.replace(/\D/g, "").replace(/^0+/, "");
  const cc: Record<string, string> = { IN: "91", AE: "971", SA: "966", QA: "974", OM: "968", KW: "965", BH: "973", PK: "92", GB: "44", US: "1", CA: "1", AU: "61", SG: "65", FR: "33", DE: "49" };
  const code = cc[country];
  if (code && !phone.trim().startsWith("+") && d.length <= 10) d = code + d;
  return d;
}
export const hashPhone = (phone: string, country?: string) => sha256(normalizePhone(phone, country));
const hashPlain = (v: string | undefined | null) => (v ? sha256(v.trim().toLowerCase().replace(/\s+/g, "")) : undefined);

// ─────────────────────────────── Payloads ───────────────────────────────

export type PurchaseOrder = {
  id: string;
  number: string;
  email: string;
  userId: string | null;
  currency: string;
  total: number;
  tax: number;
  shipping: number;
  couponCode: string | null;
  placedAt: Date;
  shippingAddress: unknown;
  items: { variantId: string | null; sku: string; name: string; label: string; unitPrice: number; quantity: number }[];
};

const major = (minor: number) => Math.round(minor) / 100;
const itemId = (i: PurchaseOrder["items"][number]) => i.variantId ?? i.sku;

export function buildMetaPurchase(order: PurchaseOrder, t: CheckoutTracking, testEventCode?: string) {
  const a = (order.shippingAddress ?? {}) as { phone?: string; city?: string; state?: string; postalCode?: string; country?: string; fullName?: string };
  const [fn, ...rest] = (a.fullName ?? "").trim().split(/\s+/);
  const user_data: Record<string, unknown> = {
    em: [hashEmail(order.email)],
    ...(a.phone ? { ph: [hashPhone(a.phone, a.country)] } : {}),
    ...(fn ? { fn: [hashPlain(fn)] } : {}),
    ...(rest.length ? { ln: [hashPlain(rest[rest.length - 1])] } : {}),
    ...(a.city ? { ct: [hashPlain(a.city)] } : {}),
    ...(a.state ? { st: [hashPlain(a.state)] } : {}),
    ...(a.postalCode ? { zp: [hashPlain(a.postalCode)] } : {}),
    ...(a.country ? { country: [hashPlain(a.country)] } : {}),
    ...(order.userId ? { external_id: [sha256(order.userId)] } : {}),
    ...(t.ip ? { client_ip_address: t.ip } : {}),
    ...(t.ua ? { client_user_agent: t.ua } : {}),
    ...(t.fbp ? { fbp: t.fbp } : {}),
    ...(t.fbc ? { fbc: t.fbc } : {}),
  };
  return {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(order.placedAt.getTime() / 1000),
        event_id: purchaseEventId(order.number),
        action_source: "website",
        ...(t.pageUrl ? { event_source_url: t.pageUrl } : {}),
        user_data,
        custom_data: {
          currency: order.currency,
          value: major(order.total),
          order_id: order.number,
          content_type: "product",
          content_ids: order.items.map(itemId),
          contents: order.items.map((i) => ({ id: itemId(i), quantity: i.quantity, item_price: major(i.unitPrice) })),
          num_items: order.items.reduce((s, i) => s + i.quantity, 0),
        },
      },
    ],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };
}

export function buildGa4Purchase(order: PurchaseOrder, t: CheckoutTracking) {
  // GA requires a client id; without the _ga cookie we derive a stable one from the order.
  const clientId = t.gaClientId ?? `${parseInt(sha256(order.id).slice(0, 8), 16)}.${Math.floor(order.placedAt.getTime() / 1000)}`;
  return {
    client_id: clientId,
    ...(order.userId ? { user_id: order.userId } : {}),
    events: [
      {
        name: "purchase",
        params: {
          transaction_id: order.number,
          event_id: purchaseEventId(order.number),
          currency: order.currency,
          value: major(order.total),
          tax: major(order.tax),
          shipping: major(order.shipping),
          ...(order.couponCode ? { coupon: order.couponCode } : {}),
          items: order.items.map((i) => ({ item_id: itemId(i), item_name: i.name, item_variant: i.label, price: major(i.unitPrice), quantity: i.quantity })),
          engagement_time_msec: 1,
        },
      },
    ],
  };
}

// ─────────────────────────────── Senders ───────────────────────────────

async function post(url: string, body: unknown) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ac.signal });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, text: text.slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}

export const metaEndpoint = (pixelId: string, token: string) =>
  `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(token)}`;
export const ga4Endpoint = (measurementId: string, apiSecret: string) =>
  `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;

/** Never print access tokens: strip the query string from anything we log. */
const redact = (s: string) => s.replace(/(access_token|api_secret)=[^&\s"]+/g, "$1=…");

export type ServerPurchaseResult = { sent: false; reason: string } | { sent: true; ga4?: boolean; meta?: boolean };

/**
 * Sends the purchase to GA4 + Meta once per order (claim recorded before sending, so concurrent confirmations
 * and retries never double count). Safe to call from anywhere; it never throws.
 */
export async function sendServerPurchase(orderId: string): Promise<ServerPurchaseResult> {
  try {
    const cfg = await getIntegration("pixels");
    const ga4 = Boolean(cfg.ga4MeasurementId && cfg.ga4ApiSecret);
    const meta = Boolean(cfg.metaPixelId && cfg.metaCapiToken);
    if (!cfg.enabled || (!ga4 && !meta)) return { sent: false, reason: "not configured" };

    const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true, payments: { orderBy: { createdAt: "asc" }, take: 1 } } });
    if (!order) return { sent: false, reason: "no order" };
    const tracking = ((order.payments[0]?.raw as { tracking?: CheckoutTracking } | null)?.tracking ?? { consent: false }) as CheckoutTracking;
    if (!tracking.consent) return { sent: false, reason: "no consent" };
    if (!(await firstDelivery(`purchase:${order.id}`, "pixels"))) return { sent: false, reason: "already sent" };

    const result: { sent: true; ga4?: boolean; meta?: boolean } = { sent: true };
    await Promise.all([
      ga4 &&
        post(ga4Endpoint(cfg.ga4MeasurementId, cfg.ga4ApiSecret), buildGa4Purchase(order, tracking))
          .then((r) => {
            result.ga4 = r.ok;
            if (!r.ok) console.error(`[tracking] GA4 purchase for ${order.number} failed: HTTP ${r.status} ${redact(r.text)}`);
          })
          .catch((e) => {
            result.ga4 = false;
            console.error(`[tracking] GA4 purchase for ${order.number} failed:`, redact(String((e as Error)?.message ?? e)));
          }),
      meta &&
        post(metaEndpoint(cfg.metaPixelId, cfg.metaCapiToken), buildMetaPurchase(order, tracking, cfg.metaTestEventCode || undefined))
          .then((r) => {
            result.meta = r.ok;
            if (!r.ok) console.error(`[tracking] Meta CAPI purchase for ${order.number} failed: HTTP ${r.status} ${redact(r.text)}`);
          })
          .catch((e) => {
            result.meta = false;
            console.error(`[tracking] Meta CAPI purchase for ${order.number} failed:`, redact(String((e as Error)?.message ?? e)));
          }),
    ]);
    return result;
  } catch (e) {
    console.error("[tracking] server purchase failed:", redact(String((e as Error)?.message ?? e)));
    return { sent: false, reason: "error" };
  }
}

/** Admin → Integrations "Send test event": a test Purchase that shows under Events Manager → Test events. */
export async function sendMetaTestEvent(): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  const cfg = await getIntegration("pixels");
  if (!cfg.metaPixelId || !cfg.metaCapiToken) return { ok: false, error: "Add the Meta Pixel ID and Conversions API token first." };
  if (!cfg.metaTestEventCode) return { ok: false, error: "Add a test event code (Events Manager → Test events) so this doesn't count as a real sale." };
  const now = new Date();
  const fake: PurchaseOrder = {
    id: `test-${now.getTime()}`,
    number: `TEST-${now.getTime()}`,
    email: "test-event@maisonoud.invalid",
    userId: null,
    currency: "INR",
    total: 100,
    tax: 0,
    shipping: 0,
    couponCode: null,
    placedAt: now,
    shippingAddress: { country: "IN" },
    items: [{ variantId: "test", sku: "TEST", name: "Test event", label: "", unitPrice: 100, quantity: 1 }],
  };
  try {
    const r = await post(metaEndpoint(cfg.metaPixelId, cfg.metaCapiToken), buildMetaPurchase(fake, { consent: true, ua: "MaisonOud-Admin-Test" }, cfg.metaTestEventCode));
    if (!r.ok) {
      let msg = r.text;
      try {
        msg = (JSON.parse(r.text) as { error?: { message?: string } }).error?.message ?? r.text;
      } catch {}
      return { ok: false, error: `Meta said (HTTP ${r.status}): ${redact(msg)}` };
    }
    const received = (JSON.parse(r.text || "{}") as { events_received?: number }).events_received ?? 0;
    return { ok: true, detail: `Meta received ${received} test event — check Events Manager → Test events (${cfg.metaTestEventCode}).` };
  } catch (e) {
    return { ok: false, error: redact(String((e as Error)?.message ?? e)) };
  }
}
