"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Currency } from "@/config/brand";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const CurrencyContext = createContext<Currency>("INR");

export function CurrencyProvider({ currency, children }: { currency: Currency; children: ReactNode }) {
  return <CurrencyContext.Provider value={currency}>{children}</CurrencyContext.Provider>;
}

export const useCurrency = () => useContext(CurrencyContext);

export function useMoney() {
  const currency = useContext(CurrencyContext);
  return (minor: number) => formatMoney(minor, currency);
}

/** Price with optional strike-through compare-at. */
export function Price({ amount, compareAt, className }: { amount: number; compareAt?: number | null; className?: string }) {
  const money = useMoney();
  return (
    <span className={cn("inline-flex items-baseline gap-2 tabular-nums", className)}>
      <span>{money(amount)}</span>
      {compareAt && compareAt > amount ? <s className="text-subtle text-[0.85em]">{money(compareAt)}</s> : null}
    </span>
  );
}
