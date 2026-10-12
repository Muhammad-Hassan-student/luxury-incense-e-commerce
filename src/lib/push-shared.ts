/* Web push: client-safe constants shared by the account page, admin and server. */

export const PUSH_CHANNELS = ["orders", "back_in_stock", "price_drop", "abandoned_bag", "broadcast"] as const;
export type PushChannel = (typeof PUSH_CHANNELS)[number] | "test";

/** Channels that are marketing: they honour the email marketing opt-out and the per-customer frequency caps. */
export const MARKETING_CHANNELS: readonly PushChannel[] = ["price_drop", "abandoned_bag", "broadcast"];

/** NotificationPreference column for each channel. */
export const PREF_FIELD = {
  orders: "orders",
  back_in_stock: "backInStock",
  price_drop: "priceDrop",
  abandoned_bag: "abandonedBag",
  broadcast: "news",
} as const satisfies Record<(typeof PUSH_CHANNELS)[number], string>;

export type PrefField = (typeof PREF_FIELD)[keyof typeof PREF_FIELD];
export type NotificationPrefs = Record<PrefField, boolean>;
export const DEFAULT_PREFS: NotificationPrefs = { orders: true, backInStock: true, priceDrop: true, abandonedBag: true, news: true };

/** Broadcast audiences. RFM segments come from src/lib/segments.ts. */
export const BROADCAST_SEGMENTS = [
  { value: "all", label: "Everyone with notifications on" },
  { value: "customers", label: "Customers who have ordered" },
  { value: "no_orders", label: "Subscribers who haven’t ordered yet" },
  { value: "wishlist", label: "Customers with a wishlist" },
  { value: "segment:Champions", label: "RFM: Champions" },
  { value: "segment:Loyal", label: "RFM: Loyal" },
  { value: "segment:New", label: "RFM: New" },
  { value: "segment:At risk", label: "RFM: At risk" },
  { value: "segment:Lost", label: "RFM: Lost" },
] as const;
export type BroadcastSegment = (typeof BROADCAST_SEGMENTS)[number]["value"];
export const isBroadcastSegment = (v: string): v is BroadcastSegment => BROADCAST_SEGMENTS.some((s) => s.value === v);

/** Push services we deliver to (the subscription endpoint is a URL our server POSTs to, so it is allow-listed). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
export function isPushEndpoint(endpoint: string) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.some((r) => r.test(u.hostname));
  } catch {
    return false;
  }
}
