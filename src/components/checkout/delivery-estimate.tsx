"use client";

import { useEffect, useState } from "react";
import { Truck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/i18n/format";
import { useRegion } from "@/components/money";
import { deliveryEstimateAction } from "@/actions/tracking";
import type { DeliveryEstimate as Estimate } from "@/server/courier/checkout";

/** "Arrives Tue 14 – Thu 16 Oct" for the entered pincode. Silent when there's nothing useful to say. */
export function DeliveryEstimate({ postalCode, country }: { postalCode: string | undefined; country: string | undefined }) {
  const tr = useTranslations("checkout");
  const tp = useTranslations("product");
  const locale = useIntlLocale();
  const region = useRegion();
  const pin = (postalCode ?? "").trim();
  const valid = (country ?? "IN") === "IN" && /^\d{6}$/.test(pin);
  const [result, setResult] = useState<{ pin: string; est: Estimate | null } | null>(null);

  useEffect(() => {
    if (!valid) return;
    let alive = true;
    const t = setTimeout(async () => {
      const est = await deliveryEstimateAction({ postalCode: pin, country: country ?? "IN" }).catch(() => null);
      if (alive) setResult({ pin, est });
    }, 450);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [pin, valid, country]);

  const est = valid && result?.pin === pin ? result.est : null;
  if (!est) return null;
  // The server's label is English: rebuild it from the dates in the shopper's language (store time zone, like the server).
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: region.timezone });
  const label = !est.serviceable
    ? tr("notServiceable")
    : fmt.format(new Date(est.from)) === fmt.format(new Date(est.to))
      ? tr("arrivesBy", { date: fmt.format(new Date(est.from)) })
      : tp("arrives", { from: fmt.format(new Date(est.from)), to: fmt.format(new Date(est.to)) });
  return (
    <p role="status" className={est.serviceable ? "flex items-center gap-3 border border-line px-5 py-4 text-sm text-fg" : "flex items-center gap-3 border border-ember/40 px-5 py-4 text-sm text-ember"}>
      <Truck className="size-4 shrink-0 text-gold" aria-hidden />
      <span>
        {label}
        {est.serviceable ? <span className="block text-xs text-muted">{est.source === "courier" ? tr("estimateToLive", { pin }) : tr("estimateTo", { pin })}</span> : null}
      </span>
    </p>
  );
}
