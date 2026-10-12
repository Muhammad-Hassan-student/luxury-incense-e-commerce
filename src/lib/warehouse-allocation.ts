// Pure order-allocation maths for multi-warehouse stock (no server imports; unit-testable).
//
// Rules, in order:
//   1. Ship everything from ONE warehouse when any active warehouse can: the closest by delivery pincode wins
//      (longest shared pincode prefix: same sorting district > same region > same zone), then lower priority number,
//      then the default warehouse.
//   2. Otherwise split: repeatedly take the warehouse that can send the most remaining lines in full (ties → rank),
//      then fill whatever is left line by line in rank order.
//   3. Not enough across all warehouses → null (out of stock).

export type AllocationCandidate = {
  id: string;
  code: string;
  pincode: string;
  priority: number;
  isDefault: boolean;
  /** Free units (on hand − reserved, never negative) per variant id */
  available: Record<string, number>;
};

export type AllocationMove = { variantId: string; qty: number };
export type AllocationChunk = { warehouseId: string; variantId: string; qty: number };
export type AllocationPlan = { chunks: AllocationChunk[]; split: boolean; warehouses: string[] };

/** Shared leading digits of two Indian pincodes (0–6); 0 when either is missing/invalid. */
export function pincodeAffinity(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b || !/^\d{6}$/.test(a) || !/^\d{6}$/.test(b)) return 0;
  let n = 0;
  while (n < 6 && a[n] === b[n]) n++;
  return n;
}

/**
 * Best first: warehouses in `prefer` (already used by the order), then nearest by pincode prefix,
 * then priority (lower first), then the default, then code.
 */
export function rankWarehouses<T extends Pick<AllocationCandidate, "pincode" | "priority" | "isDefault" | "code"> & { id?: string }>(
  cands: T[],
  destPincode?: string | null,
  prefer: readonly string[] = [],
): T[] {
  const pref = (w: T) => (w.id && prefer.includes(w.id) ? 1 : 0);
  return [...cands].sort(
    (a, b) =>
      pref(b) - pref(a) ||
      pincodeAffinity(b.pincode, destPincode) - pincodeAffinity(a.pincode, destPincode) ||
      a.priority - b.priority ||
      Number(b.isDefault) - Number(a.isDefault) ||
      a.code.localeCompare(b.code),
  );
}

function merge(moves: AllocationMove[]) {
  const m = new Map<string, number>();
  for (const x of moves) if (x.qty > 0) m.set(x.variantId, (m.get(x.variantId) ?? 0) + x.qty);
  return [...m.entries()].map(([variantId, qty]) => ({ variantId, qty }));
}

export function planAllocation(moves: AllocationMove[], cands: AllocationCandidate[], destPincode?: string | null, prefer: readonly string[] = []): AllocationPlan | null {
  const wanted = merge(moves);
  if (!wanted.length) return { chunks: [], split: false, warehouses: [] };
  const ranked = rankWarehouses(cands, destPincode, prefer);
  const free = new Map(ranked.map((w) => [w.id, { ...w.available }]));
  const avail = (wid: string, vid: string) => Math.max(0, free.get(wid)?.[vid] ?? 0);

  // 1. Single warehouse.
  const single = ranked.find((w) => wanted.every((m) => avail(w.id, m.variantId) >= m.qty));
  if (single) return { chunks: wanted.map((m) => ({ warehouseId: single.id, variantId: m.variantId, qty: m.qty })), split: false, warehouses: [single.id] };

  // 2. Greedy cover with whole lines.
  const chunks: AllocationChunk[] = [];
  const take = (wid: string, vid: string, qty: number) => {
    const f = free.get(wid)!;
    f[vid] = (f[vid] ?? 0) - qty;
    const prev = chunks.find((c) => c.warehouseId === wid && c.variantId === vid);
    if (prev) prev.qty += qty;
    else chunks.push({ warehouseId: wid, variantId: vid, qty });
  };
  let remaining = wanted.map((m) => ({ ...m }));
  for (;;) {
    let best: { id: string; lines: AllocationMove[] } | null = null;
    for (const w of ranked) {
      const lines = remaining.filter((m) => avail(w.id, m.variantId) >= m.qty);
      if (lines.length && (!best || lines.length > best.lines.length)) best = { id: w.id, lines };
    }
    if (!best) break;
    for (const l of best.lines) take(best.id, l.variantId, l.qty);
    const done = new Set(best.lines.map((l) => l.variantId));
    remaining = remaining.filter((m) => !done.has(m.variantId));
    if (!remaining.length) break;
  }

  // 3. Lines no single warehouse can cover: fill across warehouses in rank order (prefer ones already used).
  const used = () => new Set(chunks.map((c) => c.warehouseId));
  for (const m of remaining) {
    let need = m.qty;
    const order = [...ranked].sort((a, b) => Number(used().has(b.id)) - Number(used().has(a.id)));
    for (const w of order) {
      if (need <= 0) break;
      const n = Math.min(need, avail(w.id, m.variantId));
      if (n > 0) {
        take(w.id, m.variantId, n);
        need -= n;
      }
    }
    if (need > 0) return null;
  }
  const warehouses = [...new Set(chunks.map((c) => c.warehouseId))];
  return { chunks, split: warehouses.length > 1, warehouses };
}
