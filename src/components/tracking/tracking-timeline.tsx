import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import type { TrackingView } from "@/server/courier/tracking";
import { useIntlLocale } from "@/i18n/format";
import { cn } from "@/lib/utils";

/** Customer tracking timeline (server- and client-renderable). Times are shown in the store time zone so SSR and browser agree. */

const STEPS = ["step0", "step1", "step2", "step3", "step4"] as const;
const when = (locale: string, iso: string, timeZone: string) => new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone });
const dayOnly = (locale: string, iso: string, timeZone: string) => new Date(iso).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", timeZone });

/*
 * src/server/courier/tracking.ts builds English headlines and step titles. Rebuild them from the statuses where we can,
 * and map the server's fixed order-event titles to messages; anything else (raw courier scans) shows as sent.
 */
const EVENT_KEYS: Record<string, "eventPlaced" | "eventCodConfirmed" | "eventConfirmed" | "eventPacked" | "eventShipped" | "eventDelivered" | "eventCancelled" | "eventRefunded"> = {
  "Order placed": "eventPlaced",
  "Order confirmed — cash on delivery": "eventCodConfirmed",
  "Order confirmed": "eventConfirmed",
  "Packed and wrapped at the atelier": "eventPacked",
  "Handed to the courier": "eventShipped",
  Delivered: "eventDelivered",
  "Order cancelled": "eventCancelled",
  Refunded: "eventRefunded",
};
const HEADLINE_KEYS: Record<string, "headlineAwaitingPayment" | "headlinePreparing"> = {
  "Awaiting payment": "headlineAwaitingPayment",
  "Being prepared at the atelier": "headlinePreparing",
};

export function TrackingTimeline({ view, compact = false }: { view: TrackingView; compact?: boolean }) {
  const t = useTranslations("track");
  const ts = useTranslations("orderStatus");
  const locale = useIntlLocale();
  const cancelled = view.orderStatus === "CANCELLED" || view.orderStatus === "REFUNDED";
  const exception = view.shipmentStatus === "FAILED_DELIVERY" || view.shipmentStatus === "RTO" || view.shipmentStatus === "RTO_DELIVERED" || view.shipmentStatus === "LOST";
  const headline = cancelled
    ? t("headlineCancelled")
    : view.shipmentStatus
      ? ts(`shipment_${view.shipmentStatus}`)
      : view.orderStatus === "DELIVERED"
        ? t("headlineDelivered")
        : view.orderStatus === "SHIPPED"
          ? t("headlineOnItsWay")
          : view.orderStatus === "PACKED"
            ? t("headlinePacked")
            : HEADLINE_KEYS[view.headline]
              ? t(HEADLINE_KEYS[view.headline])
              : view.headline;
  const stepTitle = (s: TrackingView["steps"][number]) => (s.status ? ts(`shipment_${s.status}`) : EVENT_KEYS[s.title] ? t(EVENT_KEYS[s.title]) : s.title);
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        {!compact ? <p className="eyebrow">{t("order", { number: view.number })}</p> : null}
        <p className={cn("font-display font-light", compact ? "text-3xl" : "text-4xl sm:text-5xl", exception || cancelled ? "text-ember" : "text-fg")}>{headline}</p>
        <p className="text-sm text-muted">
          {view.deliveredAt
            ? t("deliveredOn", { date: dayOnly(locale, view.deliveredAt, view.timezone) })
            : view.etd && !cancelled
              ? t("expected", { date: dayOnly(locale, view.etd, view.timezone) })
              : view.destination
                ? t("deliveringTo", { place: view.destination })
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
        <ol className="grid grid-cols-5" aria-label={t("progress")}>
          {STEPS.map((s, i) => {
            const done = i <= view.progress;
            return (
              <li key={s} className="relative">
                <div className={cn("h-px", done ? "bg-gold" : "bg-line-strong")} />
                <span className={cn("absolute -top-1 size-2 rounded-full transition-colors", done ? "bg-gold" : "bg-line-strong", i === view.progress && !exception && "ring-4 ring-gold/20")} />
                <p className={cn("mt-4 pe-1.5 text-[0.5rem] uppercase leading-snug tracking-[0.06em] sm:pe-2 sm:text-[0.6875rem] sm:tracking-[0.16em]", done ? "text-fg" : "text-subtle")}>{t(s)}</p>
              </li>
            );
          })}
        </ol>
      ) : null}

      <ol className="space-y-0">
        {view.steps.map((s, i) => (
          <li key={`${s.at}-${i}`} className="relative border-s border-line py-3 ps-6">
            <span
              className={cn(
                "absolute -start-[4.5px] top-[1.15rem] size-2 rounded-full",
                i === 0 ? (exception || cancelled ? "bg-ember" : "bg-gold") : s.milestone ? "bg-gold/60" : "bg-line-strong",
              )}
              aria-hidden
            />
            <p className={cn("text-sm", i === 0 ? "text-fg" : "text-muted")}>{stepTitle(s)}</p>
            <p className="text-xs text-subtle">
              {when(locale, s.at, view.timezone)}
              {s.detail ? ` · ${s.detail}` : ""}
            </p>
          </li>
        ))}
      </ol>

      {view.courierTrackUrl ? (
        <a href={view.courierTrackUrl} target="_blank" rel="noopener noreferrer" className="link-draw inline-flex items-center gap-2 text-xs text-muted">
          {t("courierPage")} <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}
