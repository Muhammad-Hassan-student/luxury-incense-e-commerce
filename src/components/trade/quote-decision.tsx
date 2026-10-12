"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { acceptQuoteAction, declineQuoteAction } from "@/actions/trade";
import { brand } from "@/config/brand";
import { price } from "@/lib/pricing";
import { formatMoney } from "@/lib/money";
import { useRegion } from "@/components/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TradeCheckoutFields, chosenRate, type TradeAddressValue, type TradeCheckoutValue } from "./checkout-fields";
import type { ShippingRateLike } from "./trade-rules";

/** Accept (with PO, address and shipping) or decline a priced quote; withdraw an unpriced request. */
export function QuoteDecision({
  number,
  status,
  lines,
  problem,
  rates,
  tax,
  defaultAddress,
  creditAvailable,
}: {
  number: string;
  status: "REQUESTED" | "QUOTED";
  lines: { unitPrice: number; quantity: number }[];
  problem: string | null;
  rates: ShippingRateLike[];
  tax: { ratePercent: number; inclusive: boolean };
  defaultAddress: TradeAddressValue;
  creditAvailable: number | null;
}) {
  const t = useTranslations("tradeQuote.decision");
  const tq = useTranslations("tradePortal.quickOrder");
  const { taxLabel } = useRegion();
  const tc = useTranslations("trade.checkout");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [value, setValue] = useState<TradeCheckoutValue>({ poNumber: "", shippingRateId: "", address: defaultAddress });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const { rate } = chosenRate(rates, value);
  const pricing = price({ lines, shipping: rate, pointValue: brand.loyalty.pointValue, taxRatePercent: tax.ratePercent, taxInclusive: tax.inclusive });
  const overCredit = creditAvailable !== null && pricing.total > creditAvailable;

  function accept() {
    setError(null);
    if (!rate) return setErrors({ shippingRateId: tc("chooseShipping") });
    start(async () => {
      const res = await acceptQuoteAction({ number, poNumber: value.poNumber, address: value.address, shippingRateId: rate.id });
      if (res.ok) {
        toast(t("accepted", { number: res.number }));
        router.push(`/trade/portal/orders/${res.number}`);
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? {});
        setError(res.error);
      }
    });
  }

  function decline() {
    setError(null);
    start(async () => {
      const res = await declineQuoteAction({ number });
      if (res.ok) {
        toast(status === "QUOTED" ? t("declined") : t("withdrawn"));
        setConfirmDecline(false);
        router.refresh();
      } else setError(res.error);
    });
  }

  return (
    <section className="space-y-8 border border-line bg-bg-elev p-6 md:p-8" aria-label={t("label")}>
      {status === "QUOTED" && problem ? (
        <p role="note" className="border border-ember/40 p-4 text-sm leading-relaxed text-ember">
          {problem}
        </p>
      ) : null}

      {status === "QUOTED" && !problem ? (
        open ? (
          <div className="space-y-8">
            <TradeCheckoutFields value={{ ...value, shippingRateId: rate?.id ?? "" }} onChange={setValue} rates={rates} errors={errors} disabled={pending} idPrefix="quote" />
            <dl className="space-y-2 border-t border-line pt-6 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">{t("goods")}</dt>
                <dd className="tabular-nums">{formatMoney(pricing.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">{tq("shipping")}</dt>
                <dd className="tabular-nums">{rate ? (pricing.shipping ? formatMoney(pricing.shipping) : tq("free")) : "—"}</dd>
              </div>
              <div className={cn("flex justify-between", tax.inclusive && "text-xs text-subtle")}>
                <dt>{tax.inclusive ? tq("taxIncluded", { label: taxLabel, rate: tax.ratePercent }) : tq("taxLine", { label: taxLabel, rate: tax.ratePercent })}</dt>
                <dd className="tabular-nums">{formatMoney(pricing.tax)}</dd>
              </div>
              <div className="flex items-baseline justify-between border-t border-line pt-3">
                <dt className="eyebrow !text-muted">{tq("total")}</dt>
                <dd className="font-display text-3xl tabular-nums">{formatMoney(pricing.total)}</dd>
              </div>
            </dl>
            {overCredit ? <p className="text-xs text-ember">{t("overCredit", { amount: formatMoney(creditAvailable!) })}</p> : null}
            <div className="flex flex-wrap items-center gap-6">
              <Button onClick={accept} disabled={pending || !rate || overCredit}>
                <span>{pending ? t("placing") : t("acceptPlace")}</span>
              </Button>
              <button type="button" className="link-draw eyebrow !text-muted" onClick={() => setOpen(false)} disabled={pending}>
                {t("notYet")}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-6">
            <p className="max-w-md text-sm text-muted">{t("acceptNote")}</p>
            <Button onClick={() => setOpen(true)}>
              <span>{t("accept")}</span>
            </Button>
          </div>
        )
      ) : null}

      <div className="border-t border-line pt-6">
        {confirmDecline ? (
          <div className="flex flex-wrap items-center gap-4">
            <p className="text-sm">{status === "QUOTED" ? t("confirmDecline", { number }) : t("confirmWithdraw", { number })}</p>
            <Button size="sm" variant="danger" onClick={decline} disabled={pending}>
              <span>{status === "QUOTED" ? t("yesDecline") : t("yesWithdraw")}</span>
            </Button>
            <button type="button" className="link-draw text-xs uppercase tracking-[0.2em] text-muted" onClick={() => setConfirmDecline(false)}>
              {t("keepIt")}
            </button>
          </div>
        ) : (
          <button type="button" className="link-draw text-xs uppercase tracking-[0.2em] text-muted hover:text-ember" onClick={() => setConfirmDecline(true)} disabled={pending}>
            {status === "QUOTED" ? t("declineThis") : t("withdrawThis")}
          </button>
        )}
      </div>

      {error ? (
        <p role="alert" className="border border-ember/40 p-4 text-sm text-ember">
          {error}
        </p>
      ) : null}
    </section>
  );
}
