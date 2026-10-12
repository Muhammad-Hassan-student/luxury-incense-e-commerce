// Pre-order markers on order lines — client-safe, no server imports.
//
// A pre-ordered line carries `OrderItem.meta.preorder = { shipDate, releasedAt? }`. Until `releasedAt` is set the
// units never touch on-hand stock (no reserve / sale / restock), and the order is HELD for fulfilment:
//   • src/server/courier/fulfilment.ts → bookingProblem() refuses to book it (the board shows the reason);
//   • use `orderPreorderHold(items)` anywhere else that must not ship it yet.
// Staff release pre-orders from /admin/promotions (src/server/preorders.ts → releasePreorders), which takes the units
// from stock oldest-order-first and stamps `releasedAt`; the hold lifts on its own once every line is released.

export type PreorderMeta = { shipDate: string; releasedAt?: string | null };

export function preorderOf(meta: unknown): PreorderMeta | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const p = (meta as { preorder?: unknown }).preorder;
  if (!p || typeof p !== "object" || typeof (p as PreorderMeta).shipDate !== "string") return null;
  return p as PreorderMeta;
}

/** Pre-ordered and not yet released: no stock was taken for it, and it can't ship. */
export const preorderPending = (meta: unknown) => {
  const p = preorderOf(meta);
  return Boolean(p && !p.releasedAt);
};

/** Fulfilment hold for an order: the latest expected ship date among unreleased pre-order lines, or null. */
export function orderPreorderHold(items: { meta: unknown }[]): { shipDate: Date } | null {
  let latest: number | null = null;
  for (const i of items) {
    const p = preorderOf(i.meta);
    if (!p || p.releasedAt) continue;
    const t = Date.parse(p.shipDate);
    if (Number.isFinite(t) && (latest === null || t > latest)) latest = t;
  }
  return latest === null ? null : { shipDate: new Date(latest) };
}
