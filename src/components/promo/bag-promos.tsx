"use client";

import { Sparkles, Tag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMoney } from "@/components/money";
import { FreeShippingBar } from "@/components/cart/cart-line";
import type { BagPromoView } from "@/server/promotions";
import { cn } from "@/lib/utils";

/** Applied promotions, "add 1 more to get 1 free" nudges and the tiered-discount progress, for the bag and drawer. */
export function BagPromos({ view, className }: { view: BagPromoView | null; className?: string }) {
  const t = useTranslations("promo");
  const money = useMoney();
  if (!view || (!view.applied.length && !view.nudges.length)) return null;
  const tierNudge = view.nudges.find((n) => n.kind === "TIERED");
  const unlocked = view.tier && view.tier.percent > 0 ? view.tier.percent : null;
  const others = view.nudges.filter((n) => n.kind !== "TIERED");
  const list = (xs: string[]) => xs.join(", ");

  return (
    <div className={cn("space-y-3 text-xs", className)} aria-live="polite" data-bag-promos>
      {tierNudge && tierNudge.kind === "TIERED" ? (
        <div>
          <p className="mb-2 text-muted">
            {unlocked ? <span className="me-2 text-gold">{t("tierUnlocked", { percent: unlocked })} ·</span> : null}
            {t("nudgeTier", { amount: money(tierNudge.remaining), percent: tierNudge.percent })}
          </p>
          <FreeShippingBar subtotal={Math.max(0, tierNudge.threshold - tierNudge.remaining)} threshold={tierNudge.threshold} />
        </div>
      ) : unlocked ? (
        <p className="text-gold">{t("tierUnlocked", { percent: unlocked })}</p>
      ) : null}
      {others.map((n) => (
        <p key={`${n.promotionId}-${n.kind}`} className="flex items-start gap-2 text-muted">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-gold" strokeWidth={1.4} aria-hidden />
          <span className="min-w-0">
            {n.kind === "BUY_X_GET_Y"
              ? n.products.length
                ? t("nudgeBuyProducts", { products: list(n.products) })
                : n.percentOff >= 100
                  ? t("nudgeBuy", { count: n.addQty, get: n.getQty })
                  : t("nudgeBuyPct", { count: n.addQty, get: n.getQty, percent: n.percentOff })
              : n.kind === "MULTI_BUY"
                ? t("nudgeMulti", { count: n.addQty, quantity: n.quantity, price: money(n.price) })
                : n.kind === "FIXED_BUNDLE"
                  ? t("nudgeBundle", { name: n.name, price: money(n.price), products: list(n.products) })
                  : null}
          </span>
        </p>
      ))}
      {view.applied.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {view.applied.map((a) => (
            <li key={a.id} className="inline-flex max-w-full items-center gap-1.5 border border-gold/40 px-2 py-1 text-gold">
              <Tag className="size-3 shrink-0" strokeWidth={1.4} aria-hidden />
              <span className="truncate">{t("applied", { name: a.name })}</span>
              <span className="tabular-nums">−{money(a.discount)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
