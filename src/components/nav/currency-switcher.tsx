"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { currencies, type Currency } from "@/config/brand";
import { setCurrency } from "@/actions/engagement";
import { useCurrency, useRegion } from "@/components/money";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Display-currency picker: every currency the store has switched on (Admin → Currencies), with flag and symbol.
 * The server action stores the choice in the `mo_currency` cookie and re-renders the layout, so every price
 * (cards, product page, bag, checkout) switches in place.
 */
function useChoose() {
  const [pending, start] = useTransition();
  return { pending, choose: (c: Currency) => start(() => setCurrency(c)) };
}

export function CurrencySwitcher({ placement = "down", className }: { placement?: "down" | "up"; className?: string }) {
  const currency = useCurrency();
  const { enabledCurrencies } = useRegion();
  const [open, setOpen] = useState(false);
  const { pending, choose } = useChoose();
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (enabledCurrencies.length < 2) return null;
  const meta = currencies[currency];
  return (
    <div ref={ref} lang="en" className={cn("relative", pending && "opacity-60", className)} data-currency-switcher>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`Currency: ${currency}`}
        className="inline-flex items-center gap-1.5 text-[0.6875rem] tracking-[0.12em] text-muted transition-colors hover:text-fg"
      >
        <span aria-hidden>{meta.flag}</span>
        <span>{currency}</span>
        <ChevronDown className={cn("size-3 transition-transform duration-500", (open ? placement === "down" : placement === "up") && "rotate-180")} strokeWidth={1.4} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            id={listId}
            role="listbox"
            aria-label="Currency"
            initial={{ opacity: 0, y: placement === "up" ? 6 : -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: placement === "up" ? 6 : -6, transition: { duration: 0.2 } }}
            transition={{ duration: 0.35, ease }}
            data-lenis-prevent
            className={cn(
              "absolute end-0 z-50 max-h-[60vh] min-w-56 overflow-y-auto border border-line bg-bg/95 py-2 shadow-luxe backdrop-blur-xl",
              placement === "up" ? "bottom-full mb-3" : "top-full mt-3",
            )}
          >
            {enabledCurrencies.map((c) => (
              <li key={c} role="option" aria-selected={c === currency}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (c !== currency) choose(c);
                  }}
                  className={cn("flex w-full items-center gap-3 px-4 py-2 text-start text-sm transition-colors hover:bg-fg/[0.04] hover:text-fg", c === currency ? "text-gold" : "text-muted")}
                >
                  <span aria-hidden>{currencies[c].flag}</span>
                  <span className="flex-1">
                    {c} <span className="text-xs text-subtle">{currencies[c].name}</span>
                  </span>
                  {c === currency ? <Check className="size-3.5" strokeWidth={1.4} /> : <span className="text-xs text-subtle">{currencies[c].symbol}</span>}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Inline list (mobile menu, mega-menu footer): every enabled currency as a code button. */
export function CurrencyList({ className }: { className?: string }) {
  const currency = useCurrency();
  const { enabledCurrencies } = useRegion();
  const { pending, choose } = useChoose();
  if (enabledCurrencies.length < 2) return null;
  return (
    <div lang="en" className={cn("flex flex-wrap gap-x-3 gap-y-2 text-[0.625rem] uppercase tracking-[0.24em] text-muted", pending && "opacity-50", className)} data-currency-list>
      {enabledCurrencies.map((c) => (
        <button key={c} type="button" onClick={() => c !== currency && choose(c)} aria-current={c === currency ? "true" : undefined} title={currencies[c].name} className={cn("transition-colors hover:text-fg", currency === c && "text-gold")}>
          <span aria-hidden className="me-1 normal-case">{currencies[c].flag}</span>
          {c}
        </button>
      ))}
    </div>
  );
}
