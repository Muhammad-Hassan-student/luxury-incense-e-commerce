// Shared by the browser tracker and the server-side purchase events (no server imports).

/** "granted" | "denied"; unset = not asked yet. Read by the server at checkout too. */
export const CONSENT_COOKIE = "mo_consent";

/** One id for the browser Purchase and the server-side Purchase, so Meta counts it once. */
export const purchaseEventId = (orderNumber: string) => `purchase-${orderNumber}`;
