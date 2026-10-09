"use client";

import { Truck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCurrency } from "@/components/money";
import { useClientValue } from "@/lib/use-client";

export type RateEta = { name: string; countries: string[]; etaDays: string };

/** The shopper's likely destination from their chosen currency (we don't ask for location). */
const countryFor: Record<string, string> = { INR: "IN", PKR: "PK", AED: "AE" };

function addWorkingDays(from: Date, days: number) {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

/**
 * "Arrives Tue 14 – Fri 17 Oct": the first matching shipping rate's ETA on top of our one-to-two working day
 * dispatch. Computed in the browser (local date), with the line's height reserved so nothing shifts.
 */
export function DeliveryEstimate({ rates }: { rates: RateEta[] }) {
  const t = useTranslations("product");
  const locale = useLocale();
  const currency = useCurrency();
  const country = countryFor[currency];
  const rate = rates.find((r) => country && r.countries.includes(country)) ?? rates.find((r) => r.countries.includes("*")) ?? rates[0];
  const days = rate?.etaDays.match(/\d+/g)?.map(Number) ?? [];
  const today = useClientValue(() => new Date().toDateString(), "");
  if (!rate || !days.length) return null;

  let text = " ";
  if (today) {
    const now = new Date(today);
    const from = addWorkingDays(now, 1 + days[0]);
    const to = addWorkingDays(now, 2 + (days[1] ?? days[0]));
    const fmt = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", { weekday: "short", day: "numeric", month: "short" });
    text = t("arrives", { from: fmt.format(from), to: fmt.format(to) });
  }
  return (
    <p className="mt-6 flex items-start gap-3 text-xs text-muted">
      <Truck className="mt-px size-4 shrink-0 text-gold" strokeWidth={1.2} aria-hidden />
      <span>
        <span className="text-fg">{text}</span>
        <span className="block text-subtle">{t("arrivesVia", { method: rate.name })}</span>
      </span>
    </p>
  );
}
