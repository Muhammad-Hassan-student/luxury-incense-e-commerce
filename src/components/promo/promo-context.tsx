"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/i18n/format";
import { pickSale, type StorefrontSale } from "@/lib/promotions";
import { cn } from "@/lib/utils";

/**
 * Storefront promotions for display: flash-sale prices + countdowns and pre-order buttons on cards, quick view and
 * the product page. Display only — the server re-prices every bag line (src/server/promotions.ts → priceCart).
 * Times follow the server clock: the offset between server and browser is measured once on mount.
 */
export type PromoData = {
  serverNow: number;
  maxDiscountPercent: number;
  sales: StorefrontSale[];
  preorders: Record<string, { shipDate: string; remaining: number }>;
};

type Ctx = PromoData & { now: number };
const EMPTY: Ctx = { serverNow: 0, now: 0, maxDiscountPercent: 100, sales: [], preorders: {} };
const PromoCtx = createContext<Ctx>(EMPTY);

export function PromoProvider({ value, children }: { value: PromoData; children: ReactNode }) {
  // During SSR and hydration everyone agrees on the server's render time; afterwards the (server-corrected) clock.
  // The provider re-renders only when a sale starts or ends, so prices flip on time without ticking every card.
  const offset = useRef<number | null>(null);
  const [now, setNow] = useState(value.serverNow);
  useEffect(() => {
    if (offset.current === null) offset.current = value.serverNow - Date.now();
    const off = offset.current;
    const clientNow = Date.now() + off;
    const edges = value.sales.flatMap((s) => [s.startsAt, s.endsAt]).filter((x): x is string => Boolean(x)).map(Date.parse).filter((e) => e > clientNow);
    const wait = Math.abs(clientNow - now) > 1000 ? 0 : edges.length ? Math.min(...edges) - clientNow + 50 : null;
    if (wait === null || wait > 2 ** 31 - 1) return;
    const id = setTimeout(() => setNow(Date.now() + off), wait);
    return () => clearTimeout(id);
  }, [now, value.sales, value.serverNow]);
  const ctx = useMemo(() => ({ ...value, now }), [value, now]);
  return <PromoCtx.Provider value={ctx}>{children}</PromoCtx.Provider>;
}

export const usePromos = () => useContext(PromoCtx);

export type VariantOffer = {
  price: number;
  compareAt: number | null;
  sale: { name: string; endsAt: string | null } | null;
  preorder: { shipDate: string; remaining: number } | null;
  /** Units that can be added: the pre-order allocation for pre-order variants, else free stock. */
  available: number;
};

/** Sale price / pre-order state for a product's variants. `categoryKey` is the category slug (or id). */
export function useOffers(productId: string, categoryKey: string) {
  const p = usePromos();
  return useCallback(
    (v: { id: string; price: number; compareAtPrice: number | null; available?: number; stock?: number; reserved?: number }): VariantOffer => {
      const sale = pickSale(p.sales, productId, categoryKey, v.price, p.now, p.maxDiscountPercent);
      const pre = p.preorders[v.id] ?? null;
      const free = v.available ?? Math.max(0, (v.stock ?? 0) - (v.reserved ?? 0));
      return {
        price: sale?.price ?? v.price,
        compareAt: sale ? v.price : v.compareAtPrice,
        sale: sale ? { name: sale.sale.badge || sale.sale.name, endsAt: sale.sale.endsAt } : null,
        preorder: pre,
        available: pre ? pre.remaining : free,
      };
    },
    [p, productId, categoryKey],
  );
}

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** "Ends in 2d 04h" / "Ends in 03:12:09". Renders nothing until mounted (no hydration mismatch) and after the end. */
export function SaleCountdown({ endsAt, className, compact = false }: { endsAt: string | null; className?: string; compact?: boolean }) {
  const t = useTranslations("promo");
  const { serverNow } = usePromos();
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!endsAt) return;
    const end = Date.parse(endsAt);
    const off = serverNow ? serverNow - Date.now() : 0;
    const tick = () => setLeft(end - (Date.now() + off));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt, serverNow]);
  if (!endsAt || left === null || left <= 0) return null;
  const { d, h, m, s } = parts(left);
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = d > 0 ? t("countdownDays", { d, h: pad(h) }) : `${pad(h)}:${pad(m)}:${pad(s)}`;
  return (
    <span className={cn("tabular-nums", className)} role="timer" aria-live="off" dir="ltr">
      {compact ? time : t("endsIn", { time })}
    </span>
  );
}

/** Small "Pre-order · ships 12 Nov" line. */
export function PreorderNote({ shipDate, className }: { shipDate: string; className?: string }) {
  const t = useTranslations("promo");
  const date = new Date(shipDate).toLocaleDateString(useIntlLocale(), { day: "numeric", month: "short" });
  return <span className={className}>{t("preorderShips", { date })}</span>;
}
