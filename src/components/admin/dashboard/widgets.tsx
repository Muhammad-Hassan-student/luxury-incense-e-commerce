import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronRight, ClipboardList, Package, ShoppingBag, Star, Undo2, Users, type LucideIcon, Building2, FileText } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { HEAT_DAYS, relativeTime, type GoalProjection, type HeatCell } from "@/lib/dashboard";
import { fmtPct } from "@/components/admin/reports/report-ui";
import { cn } from "@/lib/utils";
import type { Activity, ActivityKind, AttentionItem, Mover } from "@/server/dashboard";

/** Server-safe presentational pieces for the admin command centre. */

export function Panel({ title, actions, children, className }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col border border-line bg-bg-elev", className)}>
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-3">
        <h2 className="eyebrow">{title}</h2>
        {actions}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}

/** Headline number with an optional comparison line. */
export function PulseTile({ label, value, sub, href, accent }: { label: string; value: ReactNode; sub?: ReactNode; href?: string; accent?: boolean }) {
  const body = (
    <>
      <p className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">{label}</p>
      <p className={cn("mt-3 truncate font-display text-[1.75rem] font-light leading-none tabular-nums sm:text-3xl", accent ? "text-gold" : "text-fg")}>{value}</p>
      {sub ? <div className="mt-2 min-h-4 text-xs text-muted">{sub}</div> : null}
    </>
  );
  const cls = "relative flex min-w-0 flex-col border border-line bg-bg-elev px-4 py-4 sm:px-5 sm:py-5";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-gold/60")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** ▲/▼ against a comparison value, "vs this time yesterday" style. */
export function Versus({ cur, prev, label, money = false }: { cur: number; prev: number; label: string; money?: boolean }) {
  const diff = cur - prev;
  if (prev === 0 && cur === 0) return <span className="text-subtle">Nothing yet · {label} also quiet</span>;
  const up = diff > 0;
  const flat = diff === 0;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 tabular-nums">
      <span className={flat ? "text-subtle" : up ? "text-gold" : "text-ember"}>
        <span aria-hidden>{flat ? "–" : up ? "▲" : "▼"}</span> {money ? formatMoney(Math.abs(diff)) : Math.abs(diff)}
        {prev ? ` (${fmtPct(Math.abs(diff) / prev)})` : ""}
      </span>
      <span className="text-subtle">vs {label}</span>
    </span>
  );
}

// ─────────────────────────────── Goal ring ───────────────────────────────

export function GoalRing({ g, editor, monthLabel }: { g: GoalProjection; editor?: ReactNode; monthLabel: string }) {
  const R = 54;
  const C = 2 * Math.PI * R;
  const has = g.target > 0;
  const prog = Math.min(1, g.progress);
  const proj = Math.min(1, g.projectedProgress);
  const elapsedAngle = g.elapsed * 360 - 90;
  const ex = 70 + (R + 9) * Math.cos((elapsedAngle * Math.PI) / 180);
  const ey = 70 + (R + 9) * Math.sin((elapsedAngle * Math.PI) / 180);
  return (
    <div className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center lg:flex-col lg:items-stretch xl:flex-row xl:items-center">
      <div className="relative mx-auto size-40 shrink-0">
        <svg viewBox="0 0 140 140" className="size-full -rotate-0" role="img" aria-label={has ? `${fmtPct(g.progress)} of the ${monthLabel} goal; projected ${fmtPct(g.projectedProgress)} at month end` : `No goal set for ${monthLabel}`}>
          <circle cx="70" cy="70" r={R} fill="none" stroke="var(--bg-soft)" strokeWidth="10" />
          {has ? (
            <>
              <circle cx="70" cy="70" r={R} fill="none" stroke="var(--gold)" strokeOpacity={0.25} strokeWidth="10" strokeDasharray={`${proj * C} ${C}`} transform="rotate(-90 70 70)" />
              <circle cx="70" cy="70" r={R} fill="none" stroke="var(--gold)" strokeWidth="10" strokeLinecap={prog > 0 && prog < 1 ? "round" : "butt"} strokeDasharray={`${prog * C} ${C}`} transform="rotate(-90 70 70)" />
              <circle cx={ex} cy={ey} r="2.5" fill="var(--fg-muted)">
                <title>{`Month elapsed: ${fmtPct(g.elapsed)}`}</title>
              </circle>
            </>
          ) : null}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {has ? (
            <>
              <span className="font-display text-3xl font-light tabular-nums text-fg">{Math.round(g.progress * 100)}%</span>
              <span className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">of goal</span>
            </>
          ) : (
            <span className="px-6 text-xs text-muted">No goal set</span>
          )}
        </div>
      </div>
      <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-4 text-sm">
        <div className="col-span-2">
          <dt className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">Month to date</dt>
          <dd className="mt-1 font-display text-2xl font-light tabular-nums text-fg">
            {formatMoney(g.revenue)}
            {has ? <span className="ms-2 text-sm text-muted">of {formatMoney(g.target)}</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">Projected</dt>
          <dd className={cn("mt-1 tabular-nums", has ? (g.onTrack ? "text-gold" : "text-ember") : "text-fg")}>{formatMoney(g.projected)}</dd>
        </div>
        <div>
          <dt className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">{has && g.neededPerDay ? "Need / day" : "Days left"}</dt>
          <dd className="mt-1 tabular-nums text-fg">{has && g.neededPerDay ? formatMoney(g.neededPerDay) : g.daysLeft}</dd>
        </div>
        <div className="col-span-2 text-xs text-muted">
          {has ? (g.progress >= 1 ? "Goal reached — anything more is a bonus." : g.onTrack ? "On pace to beat the goal." : `Behind pace · ${g.daysLeft} day${g.daysLeft === 1 ? "" : "s"} left after today.`) : "Net revenue after refunds, as in reports."}
          {editor ? <div className="mt-2">{editor}</div> : null}
        </div>
      </dl>
    </div>
  );
}

// ─────────────────────────────── Needs attention ───────────────────────────────

const ATTENTION_ICON: Record<string, LucideIcon> = {
  pack: Package,
  ship: Package,
  returns: Undo2,
  "trade-apps": Building2,
  overdue: FileText,
  quotes: ClipboardList,
  reviews: Star,
  "low-stock": Package,
  visits: Users,
  drafts: ClipboardList,
};

export function AttentionInbox({ items }: { items: AttentionItem[] }) {
  const open = items.filter((i) => i.count > 0);
  const clear = items.filter((i) => i.count === 0);
  return (
    <div>
      {open.length ? (
        <ul className="divide-y divide-line">
          {open.map((i) => {
            const Icon = ATTENTION_ICON[i.key] ?? ChevronRight;
            return (
              <li key={i.key}>
                <Link href={i.href} className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-bg-soft">
                  <span className={cn("flex size-9 shrink-0 items-center justify-center border", i.urgent ? "border-ember/50 text-ember" : "border-line-strong text-gold")}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{i.label}</span>
                    {i.hint ? <span className={cn("block truncate text-xs", i.urgent ? "text-ember" : "text-subtle")}>{i.hint}</span> : null}
                  </span>
                  <span className={cn("font-display text-2xl font-light tabular-nums", i.urgent ? "text-ember" : "text-fg")}>{i.count}</span>
                  <ChevronRight className="size-4 shrink-0 text-subtle transition-colors group-hover:text-gold" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-5 py-10 text-center text-sm text-muted">All clear. Nothing is waiting on the team.</p>
      )}
      {clear.length ? (
        <p className="border-t border-line px-5 py-3 text-xs text-subtle">
          <span className="text-gold" aria-hidden>
            ✓
          </span>{" "}
          Clear: {clear.map((i) => i.label.toLowerCase()).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

// ─────────────────────────────── Activity feed ───────────────────────────────

const KIND: Record<ActivityKind, { icon: LucideIcon; label: string }> = {
  order: { icon: ShoppingBag, label: "Order" },
  return: { icon: Undo2, label: "Return" },
  trade: { icon: Building2, label: "Trade" },
  quote: { icon: ClipboardList, label: "Quote" },
  visit: { icon: Users, label: "Visit" },
  review: { icon: Star, label: "Review" },
};

export function ActivityFeed({ items, now }: { items: Activity[]; now: Date }) {
  if (!items.length) return <p className="px-5 py-10 text-center text-sm text-muted">No activity yet.</p>;
  return (
    <ol className="relative px-5 py-2">
      {items.map((a, i) => {
        const k = KIND[a.kind];
        return (
          <li key={a.id} className="relative flex gap-4 py-2.5">
            {i < items.length - 1 ? <span className="absolute left-[0.9375rem] top-10 bottom-0 w-px bg-line" aria-hidden /> : null}
            <span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border border-line-strong bg-bg-elev text-gold">
              <k.icon className="size-3.5" aria-hidden />
              <span className="sr-only">{k.label}</span>
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <Link href={a.href} className="min-w-0 truncate text-sm text-fg transition-colors hover:text-gold">
                  {a.title}
                </Link>
                <time dateTime={a.at.toISOString()} className="shrink-0 text-xs tabular-nums text-subtle">
                  {relativeTime(a.at, now)}
                </time>
              </div>
              <p className="truncate text-xs text-muted">
                {a.detail}
                {a.amount != null ? <span className="tabular-nums text-fg"> · {formatMoney(a.amount)}</span> : null}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ─────────────────────────────── Heatmap ───────────────────────────────

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);

/** Day-of-week × hour grid of orders; colour strength = orders relative to the busiest hour. */
export function SalesHeatmap({ grid, maxOrders, total, peak, weeks, tz }: { grid: HeatCell[][]; maxOrders: number; total: number; peak: { day: number; hour: number } | null; weeks: number; tz: string }) {
  const summary = peak ? `Busiest: ${HEAT_DAYS[peak.day]} around ${hourLabel(peak.hour)}m (${maxOrders} orders over ${weeks} weeks)` : `No orders in the last ${weeks} weeks`;
  return (
    <figure className="p-4 sm:p-5">
      <div role="img" aria-label={`Orders by weekday and hour, ${tz}. ${summary}.`} className="grid grid-cols-[2rem_repeat(24,minmax(0,1fr))] gap-[2px] sm:grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] sm:gap-[3px]">
        {grid.map((row, d) => (
          <div key={d} className="contents">
            <span className="flex items-center text-[0.625rem] uppercase tracking-[0.12em] text-subtle">{HEAT_DAYS[d]}</span>
            {row.map((c, h) => {
              const t = maxOrders ? c.orders / maxOrders : 0;
              return (
                <span
                  key={h}
                  title={`${HEAT_DAYS[d]} ${String(h).padStart(2, "0")}:00 · ${c.orders} order${c.orders === 1 ? "" : "s"}${c.orders ? ` · ${formatMoney(c.revenue)}` : ""}`}
                  className="aspect-square min-h-2 rounded-[2px]"
                  style={{ backgroundColor: c.orders ? `color-mix(in srgb, var(--gold) ${Math.round(18 + t * 82)}%, var(--bg-soft))` : "var(--bg-soft)" }}
                />
              );
            })}
          </div>
        ))}
        <span />
        {HOURS.map((h) => (
          <span key={h} className="pt-1 text-center text-[0.5625rem] tabular-nums text-subtle" aria-hidden>
            {h % 6 === 0 ? hourLabel(h) : ""}
          </span>
        ))}
      </div>
      <figcaption className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span>{summary}</span>
        <span className="inline-flex items-center gap-2 text-subtle" aria-hidden>
          Fewer
          {[0.18, 0.45, 0.72, 1].map((s) => (
            <span key={s} className="size-2.5 rounded-[2px]" style={{ backgroundColor: `color-mix(in srgb, var(--gold) ${Math.round(s * 100)}%, var(--bg-soft))` }} />
          ))}
          More · {total} orders
        </span>
      </figcaption>
    </figure>
  );
}

// ─────────────────────────────── Top movers ───────────────────────────────

export function TopMovers({ movers }: { movers: Mover[] }) {
  if (!movers.length) return <p className="px-5 py-8 text-center text-sm text-muted">No product sales in the last two weeks.</p>;
  return (
    <ul className="divide-y divide-line">
      {movers.map((m) => {
        const up = m.change > 0;
        const Icon = up ? ArrowUpRight : ArrowDownRight;
        const name = m.productId ? (
          <Link href={`/admin/products/${m.productId}`} className="truncate text-fg transition-colors hover:text-gold">
            {m.name}
          </Link>
        ) : (
          <span className="truncate text-fg">{m.name}</span>
        );
        return (
          <li key={m.key} className="flex items-center gap-3 px-5 py-3 text-sm">
            <Icon className={cn("size-4 shrink-0", up ? "text-gold" : "text-ember")} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0">{name}</span>
              <span className="block text-xs text-subtle tabular-nums">
                {formatMoney(m.current)} this week · {formatMoney(m.previous)} last
              </span>
            </span>
            <span className={cn("shrink-0 text-xs tabular-nums", up ? "text-gold" : "text-ember")}>
              <span className="sr-only">{up ? "Up" : "Down"} </span>
              {up ? "+" : "−"}
              {formatMoney(Math.abs(m.change))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
