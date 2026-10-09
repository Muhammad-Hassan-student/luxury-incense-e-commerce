import { CONSENT_COOKIE, purchaseEventId } from "./analytics-shared";

/**
 * Browser e-commerce events for GA4 (gtag) and Meta Pixel. Calls made before the shopper has chosen are
 * queued; after "Decline" (or when tracking is off) they are dropped. Nothing is sent without consent.
 * Amounts are minor units in, major units out.
 */

export type TrackItem = { id: string; name: string; price: number; quantity: number; variant?: string };
export type TrackEvent = "view_item" | "add_to_cart" | "begin_checkout" | "add_payment_info" | "purchase";
type Payload = { items: TrackItem[]; value?: number; currency?: string; transactionId?: string; paymentType?: string; eventId?: string };

type Gtag = (...args: unknown[]) => void;
type Fbq = ((...args: unknown[]) => void) & { queue?: unknown[] };
declare global {
  interface Window {
    gtag?: Gtag;
    fbq?: Fbq;
    dataLayer?: unknown[];
    __moTrack?: { ready: boolean; queue: [TrackEvent, Payload][]; ga: boolean; meta: boolean };
  }
}

const META_NAMES: Record<TrackEvent, string> = {
  view_item: "ViewContent",
  add_to_cart: "AddToCart",
  begin_checkout: "InitiateCheckout",
  add_payment_info: "AddPaymentInfo",
  purchase: "Purchase",
};

export function readConsent(): "granted" | "denied" | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=(granted|denied)`));
  return (m?.[1] as "granted" | "denied" | undefined) ?? null;
}

export function writeConsent(v: "granted" | "denied") {
  document.cookie = `${CONSENT_COOKIE}=${v}; Max-Age=${60 * 60 * 24 * 365}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

const state = () => (window.__moTrack ??= { ready: false, queue: [], ga: false, meta: false });

const newEventId = (e: TrackEvent) => `${e}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

function send(event: TrackEvent, p: Payload) {
  const s = state();
  const currency = p.currency ?? "INR";
  const minor = p.value ?? p.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const value = minor / 100;
  // event_id: the same id goes to GA (as a param) and Meta (eventID) so a server copy can be deduplicated.
  const eventId = p.eventId ?? (event === "purchase" && p.transactionId ? purchaseEventId(p.transactionId) : newEventId(event));
  if (s.ga && window.gtag) {
    window.gtag("event", event, {
      currency,
      value,
      event_id: eventId,
      ...(p.transactionId ? { transaction_id: p.transactionId } : {}),
      ...(p.paymentType ? { payment_type: p.paymentType } : {}),
      items: p.items.map((i) => ({ item_id: i.id, item_name: i.name, item_variant: i.variant, price: i.price / 100, quantity: i.quantity })),
    });
  }
  if (s.meta && window.fbq) {
    window.fbq(
      "track",
      META_NAMES[event],
      {
        currency,
        value,
        content_type: "product",
        content_ids: p.items.map((i) => i.id),
        contents: p.items.map((i) => ({ id: i.id, quantity: i.quantity, item_price: i.price / 100 })),
        num_items: p.items.reduce((n, i) => n + i.quantity, 0),
        ...(p.transactionId ? { order_id: p.transactionId } : {}),
      },
      { eventID: eventId },
    );
  }
}

/** Fire an e-commerce event (queued until consent; dropped if declined). */
export function track(event: TrackEvent, payload: Payload) {
  if (typeof window === "undefined") return;
  const consent = readConsent();
  if (consent === "denied") return;
  const s = state();
  if (s.ready) send(event, payload);
  else if (s.queue.length < 50) s.queue.push([event, payload]);
}

/** Called by the loader once the tags are initialised. */
export function markTrackingReady(opts: { ga: boolean; meta: boolean }) {
  const s = state();
  Object.assign(s, opts, { ready: true });
  for (const [e, p] of s.queue.splice(0)) send(e, p);
}

/** Drop anything queued (declined, or tracking switched off). */
export function clearTrackingQueue() {
  if (typeof window !== "undefined") state().queue.length = 0;
}
