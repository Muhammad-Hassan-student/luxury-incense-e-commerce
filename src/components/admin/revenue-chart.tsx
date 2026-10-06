"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/money";

export type RevenuePoint = { date: string; revenue: number; orders: number };

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

function compact(minor: number) {
  const major = minor / 100;
  if (major >= 100_000) return `₹${(major / 100_000).toFixed(1)}L`;
  if (major >= 1000) return `₹${(major / 1000).toFixed(major >= 10_000 ? 0 : 1)}k`;
  return `₹${Math.round(major)}`;
}

type TooltipProps = { active?: boolean; label?: string | number; payload?: ReadonlyArray<{ payload?: RevenuePoint }> };

function ChartTooltip({ active, payload }: TooltipProps) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="border border-line-strong bg-bg-elev px-3 py-2 text-xs text-fg">
      <p className="text-muted">{dayLabel(p.date)}</p>
      <p className="mt-1 font-display text-lg font-light tabular-nums">{formatMoney(p.revenue)}</p>
      <p className="text-muted">
        {p.orders} order{p.orders === 1 ? "" : "s"}
      </p>
    </div>
  );
}

export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  const total = data.reduce((s, d) => s + d.revenue, 0);
  return (
    <figure className="h-72 w-full text-gold" aria-label={`Revenue over the last 30 days, total ${formatMoney(total)}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="admin-revenue-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.28} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
          <XAxis
            dataKey="date"
            tickFormatter={dayLabel}
            tick={{ fontSize: 11, className: "fill-subtle" }}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis tickFormatter={compact} tick={{ fontSize: 11, className: "fill-subtle" }} tickLine={false} axisLine={false} width={56} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: "currentColor", strokeOpacity: 0.3 }} />
          <Area type="monotone" dataKey="revenue" stroke="currentColor" strokeWidth={1.5} fill="url(#admin-revenue-fill)" />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}
