import { ExternalLink } from "lucide-react";
import type { TrackingView } from "@/server/courier/tracking";
import { cn } from "@/lib/utils";

/** Customer tracking timeline (server- and client-renderable). Times are shown in IST so SSR and browser agree. */

const STEPS = ["Confirmed", "Packed", "Shipped", "Out for delivery", "Delivered"] as const;
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const dayOnly = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });

export function TrackingTimeline({ view, compact = false }: { view: TrackingView; compact?: boolean }) {
  const cancelled = view.orderStatus === "CANCELLED" || view.orderStatus === "REFUNDED";
  const exception = view.shipmentStatus === "FAILED_DELIVERY" || view.shipmentStatus === "RTO" || view.shipmentStatus === "RTO_DELIVERED" || view.shipmentStatus === "LOST";
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        {!compact ? <p className="eyebrow">Order {view.number}</p> : null}
        <p className={cn("font-display font-light", compact ? "text-3xl" : "text-4xl sm:text-5xl", exception || cancelled ? "text-ember" : "text-fg")}>{view.headline}</p>
        <p className="text-sm text-muted">
          {view.deliveredAt
            ? `Delivered ${dayOnly(view.deliveredAt)}`
            : view.etd && !cancelled
              ? `Expected ${dayOnly(view.etd)}`
              : view.destination
                ? `Delivering to ${view.destination}`
                : null}
          {view.courierName && view.awb ? (
            <>
              {" · "}
              {view.courierName} <span className="font-mono text-fg">{view.awb}</span>
            </>
          ) : null}
        </p>
      </div>

      {!cancelled ? (
        <ol className="grid grid-cols-5" aria-label="Delivery progress">
          {STEPS.map((s, i) => {
            const done = i <= view.progress;
            return (
              <li key={s} className="relative">
                <div className={cn("h-px", done ? "bg-gold" : "bg-line-strong")} />
                <span className={cn("absolute -top-1 size-2 rounded-full transition-colors", done ? "bg-gold" : "bg-line-strong", i === view.progress && !exception && "ring-4 ring-gold/20")} />
                <p className={cn("mt-4 pr-1.5 text-[0.5rem] uppercase leading-snug tracking-[0.06em] sm:pr-2 sm:text-[0.6875rem] sm:tracking-[0.16em]", done ? "text-fg" : "text-subtle")}>{s}</p>
              </li>
            );
          })}
        </ol>
      ) : null}

      <ol className="space-y-0">
        {view.steps.map((s, i) => (
          <li key={`${s.at}-${i}`} className="relative border-l border-line py-3 pl-6">
            <span
              className={cn(
                "absolute -left-[4.5px] top-[1.15rem] size-2 rounded-full",
                i === 0 ? (exception || cancelled ? "bg-ember" : "bg-gold") : s.milestone ? "bg-gold/60" : "bg-line-strong",
              )}
              aria-hidden
            />
            <p className={cn("text-sm", i === 0 ? "text-fg" : "text-muted")}>{s.title}</p>
            <p className="text-xs text-subtle">
              {when(s.at)}
              {s.detail ? ` · ${s.detail}` : ""}
            </p>
          </li>
        ))}
      </ol>

      {view.courierTrackUrl ? (
        <a href={view.courierTrackUrl} target="_blank" rel="noopener noreferrer" className="link-draw inline-flex items-center gap-2 text-xs text-muted">
          Courier’s tracking page <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}
