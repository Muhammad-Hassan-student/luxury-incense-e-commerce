"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { updateMySubscription } from "@/actions/subscriptions";
import { useIntlLocale } from "@/i18n/format";
import { Button } from "@/components/ui/button";
import { Badge, Field, Select } from "@/components/ui/field";
import { useMoney } from "@/components/money";
import { productHref } from "@/lib/product-href";

export type SubscriptionView = {
  id: string;
  name: string;
  slug: string;
  label: string;
  quantity: number;
  intervalMonths: 1 | 2 | 3;
  intervalLabel: string;
  status: "ACTIVE" | "PAUSED" | "CANCELLED";
  pauseReason: string | null;
  nextRunAt: string;
  unitPrice: number;
  fullPrice: number;
  discountPercent: number;
  lastError: string | null;
  payPath: string | null;
  savedCard: boolean;
};

type Change =
  | { type: "skip" }
  | { type: "interval"; months: 1 | 2 | 3 }
  | { type: "quantity"; quantity: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "cancel" };

const addMonths = (iso: string, m: number) => {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + m);
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString();
};
/** One subscription with its changes; every change asks for confirmation first. */
export function SubscriptionCard({ sub }: { sub: SubscriptionView }) {
  const t = useTranslations("subscriptions");
  const locale = useIntlLocale();
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
  const money = useMoney();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<{ change: Change; text: string; cta: string; danger?: boolean } | null>(null);
  const [months, setMonths] = useState(sub.intervalMonths);
  const [qty, setQty] = useState(sub.quantity);
  const [error, setError] = useState<string | null>(null);
  const live = sub.status !== "CANCELLED";

  const ask = (change: Change, text: string, cta: string, danger = false) => {
    setError(null);
    setConfirm({ change, text, cta, danger });
  };
  const run = () =>
    confirm &&
    start(async () => {
      const res = await updateMySubscription({ id: sub.id, change: confirm.change, confirm: true });
      if (res.ok) {
        toast(res.message);
        setConfirm(null);
        router.refresh();
      } else setError(res.error);
    });

  return (
    <article className="border border-line p-6" data-subscription={sub.id}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href={productHref(sub.slug)} className="font-display text-2xl leading-tight hover:text-gold">
            {sub.name}
          </Link>
          <p className="mt-1 text-sm text-muted">
            {sub.label} · {sub.quantity} × {money(sub.unitPrice)}
            {sub.discountPercent ? <span className="text-gold"> {t("save", { percent: sub.discountPercent })}</span> : null} · {t("every", { months: sub.intervalMonths })}
          </p>
        </div>
        <Badge tone={sub.status === "ACTIVE" ? "gold" : sub.status === "PAUSED" ? "muted" : "ember"}>{t(`status_${sub.status}`)}</Badge>
      </div>

      {live && (
        <p className="mt-4 text-sm">
          {sub.status === "ACTIVE" ? (
            t.rich(sub.savedCard ? "nextRenewalCard" : "nextRenewalLink", {
              date: fmt(sub.nextRunAt),
              amount: money(sub.unitPrice * sub.quantity),
              gold: (c) => <span className="text-gold">{c}</span>,
            })
          ) : sub.pauseReason === "payment_failed" ? (
            t("pausedFailed")
          ) : (
            t("paused")
          )}
        </p>
      )}
      {sub.payPath && (
        <p className="mt-3 border border-gold/40 p-3 text-sm">
          {t.rich("waitingPayment", {
            link: (c) => (
              <Link href={sub.payPath!} className="link-draw text-gold">
                {c}
              </Link>
            ),
          })}
        </p>
      )}
      {sub.lastError && live && <p className="mt-3 text-xs text-ember">{t("lastAttempt", { error: sub.lastError })}</p>}

      {live && !confirm && (
        <div className="mt-6 grid gap-6 border-t border-line pt-6 md:grid-cols-[1fr_auto]">
          <div className="flex flex-wrap items-end gap-4">
            <Field label={t("deliver")} className="w-44">
              <Select value={months} onChange={(e) => setMonths(Number(e.target.value) as 1 | 2 | 3)} disabled={pending}>
                {([1, 2, 3] as const).map((m) => (
                  <option key={m} value={m}>
                    {t("everyOption", { months: m })}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("quantity")} className="w-28">
              <Select value={qty} onChange={(e) => setQty(Number(e.target.value))} disabled={pending}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
            {(months !== sub.intervalMonths || qty !== sub.quantity) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  months !== sub.intervalMonths
                    ? ask(
                        { type: "interval", months },
                        `${t("confirmInterval", { to: months, from: sub.intervalMonths })}${qty !== sub.quantity ? ` ${t("saveQtySeparately")}` : ""}`,
                        t("yesSchedule"),
                      )
                    : ask({ type: "quantity", quantity: qty }, t("confirmQuantity", { quantity: qty, amount: money(sub.unitPrice * qty) }), t("yesQuantity"))
                }
              >
                {t("saveChange")}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {sub.status === "ACTIVE" && (
              <>
                <Button size="sm" variant="outline" disabled={Boolean(sub.payPath)} onClick={() => ask({ type: "skip" }, t("confirmSkip", { date: fmt(sub.nextRunAt), next: fmt(addMonths(sub.nextRunAt, sub.intervalMonths)) }), t("yesSkip"))}>
                  {t("skipNext")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => ask({ type: "pause" }, t("confirmPause"), t("yesPause"))}>
                  {t("pause")}
                </Button>
              </>
            )}
            {sub.status === "PAUSED" && (
              <Button size="sm" onClick={() => ask({ type: "resume" }, t("confirmResume"), t("yesResume"))}>
                {t("resume")}
              </Button>
            )}
            <Button size="sm" variant="danger" onClick={() => ask({ type: "cancel" }, t("confirmCancel", { name: sub.name }), t("yesCancel"), true)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}

      {confirm && (
        <div className="mt-6 space-y-4 border-t border-line pt-6" role="alertdialog" aria-label={t("confirmLabel")}>
          <p className="text-sm text-fg">{confirm.text}</p>
          {error && (
            <p role="alert" className="border border-ember/40 p-3 text-sm text-ember">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button size="sm" variant={confirm.danger ? "danger" : "primary"} onClick={run} disabled={pending}>
              {pending ? t("saving") : confirm.cta}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)} disabled={pending}>
              {t("neverMind")}
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
