import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Server-safe presentational pieces for the sales reports. */

const pctFmt = new Intl.NumberFormat("en-IN", { style: "percent", maximumFractionDigits: 1 });
export const fmtPct = (v: number | null | undefined) => (v == null ? "—" : pctFmt.format(v));
export const fmtInt = (v: number) => v.toLocaleString("en-IN");

/** ▲/▼ change versus the previous period. `invert` for metrics where down is good (refund rate). */
export function Delta({ change, invert = false, points = false, className }: { change: number | null; invert?: boolean; points?: boolean; className?: string }) {
  if (change == null) return <span className={cn("text-xs text-subtle", className)}>New vs previous</span>;
  const flat = Math.abs(change) < 0.0005;
  const up = change > 0;
  const good = flat ? null : up !== invert;
  const value = points ? `${(Math.abs(change) * 100).toFixed(1)} pts` : pctFmt.format(Math.abs(change));
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs tabular-nums", good == null ? "text-subtle" : good ? "text-gold" : "text-ember", className)}>
      <span aria-hidden>{flat ? "–" : up ? "▲" : "▼"}</span>
      <span className="sr-only">{flat ? "Unchanged" : up ? "Up" : "Down"}</span>
      {flat ? "0%" : value}
      <span className="text-subtle">vs prev.</span>
    </span>
  );
}

export function DeltaKpi({ label, value, delta, hint }: { label: string; value: ReactNode; delta?: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col border border-line bg-bg-elev px-4 py-4 sm:px-5 sm:py-5">
      <p className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">{label}</p>
      <p className="mt-3 truncate font-display text-2xl font-light tabular-nums text-fg sm:text-3xl">{value}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {delta}
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </div>
    </div>
  );
}

/** Tiny static trend line (no axes). Scales to its box; the stroke stays crisp. */
export function Sparkline({ values, label, className }: { values: number[]; label: string; className?: string }) {
  const w = 240;
  const h = 56;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [values.length <= 1 ? w / 2 : (i * w) / (values.length - 1), h - 3 - (v / max) * (h - 6)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("block h-14 w-full overflow-visible text-gold", className)} role="img" aria-label={label}>
      <path d={`${d}L${w},${h}L0,${h}Z`} fill="currentColor" fillOpacity={0.08} />
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {last ? <circle cx={last[0]} cy={last[1]} r={2.5} fill="currentColor" vectorEffect="non-scaling-stroke" /> : null}
    </svg>
  );
}

/** Horizontal share bars with label, value and percentage. */
export function SplitBars({ rows, empty = "No sales in this period." }: { rows: { key: string; label: ReactNode; value: ReactNode; share: number; detail?: ReactNode }[]; empty?: string }) {
  if (!rows.length || rows.every((r) => r.share === 0)) return <p className="px-5 py-8 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-5 px-5 py-5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-fg">{r.label}</span>
            <span className="shrink-0 tabular-nums text-fg">
              {r.value} <span className="ms-1 text-xs text-subtle">{fmtPct(r.share)}</span>
            </span>
          </div>
          <div className="h-1.5 w-full bg-bg-soft" aria-hidden>
            <div className="h-full bg-gold" style={{ width: `${Math.max(r.share > 0 ? 1 : 0, r.share * 100)}%` }} />
          </div>
          {r.detail ? <p className="mt-1.5 text-xs text-muted">{r.detail}</p> : null}
        </li>
      ))}
    </ul>
  );
}

const chip = "inline-flex h-9 items-center border px-3 text-[0.6875rem] uppercase tracking-[0.2em] transition-colors sm:px-4";

/** Preset links plus a plain GET form for a custom range — works without JavaScript. */
export function RangePicker({ presets, current, from, to, max }: { presets: { key: string; label: string }[]; current: string; from: string; to: string; max: string }) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <nav aria-label="Date range" className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <Link
            key={p.key}
            href={`/admin/reports?range=${p.key}`}
            aria-current={current === p.key ? "page" : undefined}
            className={cn(chip, current === p.key ? "border-gold text-gold" : "border-line text-muted hover:border-gold hover:text-gold")}
          >
            {p.label}
          </Link>
        ))}
      </nav>
      <form action="/admin/reports" method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="range" value="custom" />
        <label className="flex flex-col text-[0.625rem] uppercase tracking-[0.2em] text-subtle">
          From
          <input type="date" name="from" defaultValue={from} max={max} required className="mt-1 h-9 border border-line bg-transparent px-2 text-sm normal-case tracking-normal text-fg focus:border-gold focus:outline-none" />
        </label>
        <label className="flex flex-col text-[0.625rem] uppercase tracking-[0.2em] text-subtle">
          To
          <input type="date" name="to" defaultValue={to} max={max} required className="mt-1 h-9 border border-line bg-transparent px-2 text-sm normal-case tracking-normal text-fg focus:border-gold focus:outline-none" />
        </label>
        <button type="submit" className={cn(chip, current === "custom" ? "border-gold text-gold" : "border-line-strong text-fg hover:border-gold hover:text-gold")}>
          Apply
        </button>
      </form>
    </div>
  );
}
