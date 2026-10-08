/**
 * Pure maths for the admin command centre (goal projection, heatmap grid, relative times).
 * Client-safe and side-effect free so the check script can exercise it directly.
 */

const DAY_MS = 86_400_000;

export type GoalProjection = {
  target: number;
  revenue: number;
  /** revenue ÷ target (0 when no target) */
  progress: number;
  /** share of the month elapsed, 0–1 */
  elapsed: number;
  /** revenue at the current daily pace extended to month end */
  projected: number;
  /** projected ÷ target (0 when no target) */
  projectedProgress: number;
  daysInMonth: number;
  /** whole days left after today */
  daysLeft: number;
  /** what's needed per remaining day (including today) to hit the target; 0 once met */
  neededPerDay: number;
  onTrack: boolean;
};

/**
 * Month-to-date progress against a target and the straight-line month-end projection.
 * `monthStart`/`monthEnd` are the UTC instants of the store-time month boundaries (end exclusive).
 */
export function goalProjection(opts: { revenue: number; target: number; now: Date; monthStart: Date; monthEnd: Date }): GoalProjection {
  const { revenue, target, now, monthStart, monthEnd } = opts;
  const span = Math.max(1, monthEnd.getTime() - monthStart.getTime());
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - monthStart.getTime()) / span));
  // Before an hour has passed the pace is noise; project the revenue so far rather than extrapolating wildly.
  const projected = elapsed > 1 / 720 ? Math.round(revenue / elapsed) : revenue;
  const daysInMonth = Math.round(span / DAY_MS);
  const remainingMs = Math.max(0, monthEnd.getTime() - now.getTime());
  const daysLeft = Math.max(0, Math.ceil(remainingMs / DAY_MS) - 1);
  const remainingDays = Math.max(1, Math.ceil(remainingMs / DAY_MS));
  return {
    target,
    revenue,
    progress: target > 0 ? revenue / target : 0,
    elapsed,
    projected,
    projectedProgress: target > 0 ? projected / target : 0,
    daysInMonth,
    daysLeft,
    neededPerDay: target > revenue ? Math.ceil((target - revenue) / remainingDays) : 0,
    onTrack: target > 0 && projected >= target,
  };
}

export type HeatCell = { orders: number; revenue: number };
export const HEAT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Rows keyed by ISO weekday (1 = Monday … 7 = Sunday) and hour (0–23) → a Monday-first 7 × 24 grid. */
export function heatmapGrid(rows: { dow: number; hour: number; orders: number; revenue: number }[]) {
  const grid: HeatCell[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ orders: 0, revenue: 0 })));
  for (const r of rows) {
    if (r.dow < 1 || r.dow > 7 || r.hour < 0 || r.hour > 23) continue;
    const cell = grid[r.dow - 1]![r.hour]!;
    cell.orders += r.orders;
    cell.revenue += r.revenue;
  }
  let maxOrders = 0;
  let total = 0;
  let peak: { day: number; hour: number } | null = null;
  grid.forEach((row, d) =>
    row.forEach((c, h) => {
      total += c.orders;
      if (c.orders > maxOrders) {
        maxOrders = c.orders;
        peak = { day: d, hour: h };
      }
    }),
  );
  return { grid, maxOrders, total, peak: peak as { day: number; hour: number } | null };
}

/** "just now", "4 min ago", "3 h ago", "2 d ago", else a short date. */
export function relativeTime(date: Date, now = new Date()) {
  const s = Math.round((now.getTime() - date.getTime()) / 1000);
  if (s < 0) {
    const m = Math.round(-s / 60);
    if (m < 60) return `in ${Math.max(1, m)} min`;
    const h = Math.round(m / 60);
    return h < 24 ? `in ${h} h` : `in ${Math.round(h / 24)} d`;
  }
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d} d ago`;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(date);
}

/** Age in whole days/hours, for "oldest waiting" hints. */
export function ageLabel(date: Date, now = new Date()) {
  const h = Math.floor((now.getTime() - date.getTime()) / 3_600_000);
  if (h < 1) return "under an hour";
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} days`;
}
