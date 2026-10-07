"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatMoney } from "@/lib/money";
import { brand } from "@/config/brand";

export type ChartPoint = { date: string; revenue: number; orders: number };

const H = 280;
const M = { top: 16, right: 16, bottom: 30, left: 60 };

const compactFmt = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: brand.baseCurrency,
  notation: "compact",
  maximumFractionDigits: 1,
});
const compact = (minor: number) => compactFmt.format(minor / 100);
const dayFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const longFmt = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** A round axis maximum: 1, 2, 2.5 or 5 × 10ⁿ at or above `v`. */
function niceMax(v: number) {
  if (v <= 0) return 100_00;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

/**
 * Hand-rolled SVG area chart: revenue for the period, with the previous period as a dashed line.
 * Hover / tap or focus + arrow keys for exact values; a screen-reader table carries the same data.
 */
export function SalesChart({
  data,
  previous,
  granularity,
  label,
}: {
  data: ChartPoint[];
  previous?: ChartPoint[];
  granularity: "day" | "week";
  label: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);
  const gradient = useId().replace(/:/g, "");

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setWidth(Math.max(280, Math.round(e!.contentRect.width))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = width < 480;
  const left = narrow ? 48 : M.left;
  const innerW = width - left - M.right;
  const innerH = H - M.top - M.bottom;
  const count = data.length;
  const prev = previous && previous.length === count ? previous : undefined;
  const all = [...data, ...(prev ?? [])].map((d) => d.revenue);
  const max = niceMax(Math.max(0, ...all));
  // Return refunds can push a day below zero; give the axis a matching floor.
  const lowest = Math.min(0, ...all);
  const min = lowest < 0 ? -niceMax(-lowest) : 0;
  const x = (i: number) => left + (count <= 1 ? innerW / 2 : (i * innerW) / (count - 1));
  const y = (v: number) => M.top + innerH - ((v - min) / (max - min)) * innerH;
  const line = (pts: ChartPoint[]) =>
    pts.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.revenue).toFixed(1)}`).join("");
  const area = count
    ? `${line(data)}L${x(count - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`
    : "";
  const ticks = min < 0 ? [min, 0, max / 2, max] : [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const labelEvery = Math.max(1, Math.ceil(count / (narrow ? 4 : 7)));
  // Evenly spaced dates, always the last one, never two crowding each other at the end.
  const showLabel = (i: number) =>
    i === count - 1 || (i % labelEvery === 0 && count - 1 - i >= labelEvery * 0.6);
  const xLabel = (iso: string) =>
    granularity === "week" ? `w/c ${dayFmt.format(asDate(iso))}` : dayFmt.format(asDate(iso));
  const total = data.reduce((s, d) => s + d.revenue, 0);

  const pick = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * innerW;
    setActive(
      Math.min(count - 1, Math.max(0, Math.round(count <= 1 ? 0 : (px / innerW) * (count - 1)))),
    );
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!count) return;
    const cur = active ?? count - 1;
    const next =
      e.key === "ArrowLeft"
        ? cur - 1
        : e.key === "ArrowRight"
          ? cur + 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? count - 1
              : null;
    if (next == null) return;
    e.preventDefault();
    setActive(Math.min(count - 1, Math.max(0, next)));
  };

  const a = active != null ? data[active] : undefined;
  const p = active != null ? prev?.[active] : undefined;
  const tipLeft = active != null ? Math.min(Math.max(x(active), 90), width - 90) : 0;

  return (
    <figure className="relative w-full">
      <div
        className="text-muted mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 px-1 text-xs"
        aria-hidden
      >
        <span className="inline-flex items-center gap-2">
          <span className="bg-gold h-0.5 w-5" /> This period
        </span>
        {prev ? (
          <span className="inline-flex items-center gap-2">
            <span className="border-subtle h-0 w-5 border-t border-dashed" /> Previous period
          </span>
        ) : null}
        <span className="text-subtle ms-auto">
          {granularity === "week" ? "Weekly" : "Daily"} · tap or use ← → for values
        </span>
      </div>
      <div
        ref={wrap}
        className="focus-visible:ring-gold relative w-full touch-pan-y outline-none focus-visible:ring-1"
        tabIndex={0}
        role="group"
        aria-label={`${label}. Total ${formatMoney(total)}. Use the arrow keys to read each ${granularity}.`}
        onKeyDown={onKey}
        onFocus={() => setActive((v) => v ?? (count ? count - 1 : null))}
        onBlur={() => setActive(null)}
      >
        <svg
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          className="text-gold block max-w-full"
          aria-hidden
        >
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.3} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={left}
                x2={width - M.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--line)"
                strokeDasharray={t === 0 ? undefined : "2 4"}
              />
              <text
                x={left - 8}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                className="fill-subtle text-[10px] tabular-nums"
              >
                {compact(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) =>
            showLabel(i) ? (
              <text
                key={d.date}
                x={x(i)}
                y={H - 8}
                textAnchor={i === 0 ? "start" : i === count - 1 ? "end" : "middle"}
                className="fill-subtle text-[10px]"
              >
                {xLabel(d.date)}
              </text>
            ) : null,
          )}
          {prev ? (
            <path
              d={line(prev)}
              fill="none"
              stroke="var(--fg-subtle)"
              strokeWidth={1.25}
              strokeDasharray="4 4"
            />
          ) : null}
          <path d={area} fill={`url(#${gradient})`} />
          <path
            d={line(data)}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {a && active != null ? (
            <g>
              <line
                x1={x(active)}
                x2={x(active)}
                y1={M.top}
                y2={M.top + innerH}
                stroke="var(--line-strong)"
              />
              {p ? (
                <circle
                  cx={x(active)}
                  cy={y(p.revenue)}
                  r={3.5}
                  fill="var(--bg-elev)"
                  stroke="var(--fg-subtle)"
                  strokeWidth={1.5}
                />
              ) : null}
              <circle
                cx={x(active)}
                cy={y(a.revenue)}
                r={4.5}
                fill="currentColor"
                stroke="var(--bg-elev)"
                strokeWidth={2}
              />
            </g>
          ) : null}
          <rect
            x={left}
            y={M.top}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
          />
        </svg>
        {a ? (
          <div
            className="border-line-strong bg-bg-elev text-fg pointer-events-none absolute top-1 z-10 w-44 -translate-x-1/2 border px-3 py-2 text-xs shadow-lg"
            style={{ left: tipLeft }}
            role="status"
            aria-live="polite"
          >
            <p className="text-muted">
              {granularity === "week"
                ? `Week of ${dayFmt.format(asDate(a.date))}`
                : longFmt.format(asDate(a.date))}
            </p>
            <p className="font-display mt-1 text-lg font-light tabular-nums">
              {formatMoney(a.revenue)}
            </p>
            <p className="text-muted">
              {a.orders} order{a.orders === 1 ? "" : "s"}
            </p>
            {p ? (
              <p className="border-line text-subtle mt-1 border-t pt-1">
                Previous: {formatMoney(p.revenue)}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {/* Tables ignore sr-only sizing, so the wrapper does the hiding. */}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">{granularity === "week" ? "Week starting" : "Date"}</th>
              <th scope="col">Net revenue</th>
              <th scope="col">Orders</th>
              {prev ? <th scope="col">Previous period revenue</th> : null}
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={d.date}>
                <th scope="row">{d.date}</th>
                <td>{formatMoney(d.revenue)}</td>
                <td>{d.orders}</td>
                {prev ? <td>{formatMoney(prev[i]!.revenue)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
