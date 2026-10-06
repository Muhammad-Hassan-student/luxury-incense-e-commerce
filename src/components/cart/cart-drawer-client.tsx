"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useUI } from "@/store/ui";
import { ease } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { useMoney } from "@/components/money";
import { CartLine, FreeShippingBar, type CartLineView } from "./cart-line";

export function CartDrawerClient({ lines, subtotal, goodsSubtotal, freeShippingOver }: { lines: CartLineView[]; subtotal: number; goodsSubtotal: number; freeShippingOver: number }) {
  const t = useTranslations("cart");
  const open = useUI((s) => s.panel === "cart");
  const close = useUI((s) => s.close);
  const money = useMoney();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const remaining = freeShippingOver - goodsSubtotal;
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            onClick={close}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={t("title")}
            className="fixed inset-y-0 end-0 z-50 flex w-full max-w-md flex-col border-s border-line bg-bg-elev"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.8, ease }}
            data-lenis-prevent
          >
            <header className="flex items-center justify-between border-b border-line px-6 py-5">
              <h2 className="font-display text-2xl">
                {t("title")} <span className="text-sm text-muted">({lines.reduce((n, l) => n + l.quantity, 0)})</span>
              </h2>
              <button onClick={close} aria-label="Close" className="hover:text-gold">
                <X className="size-5" strokeWidth={1.2} />
              </button>
            </header>

            {lines.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
                <p className="font-display text-3xl">{t("empty")}</p>
                <p className="text-sm text-muted">{t("emptyBody")}</p>
                <Button variant="outline" className="mt-4" onClick={close} asChild>
                  <Link href="/shop">{t("continue")}</Link>
                </Button>
              </div>
            ) : (
              <>
                {goodsSubtotal > 0 && <div className="px-6 pt-5 text-xs text-muted">
                  <p className="mb-3">{remaining > 0 ? t("freeShippingAway", { amount: money(remaining) }) : t("freeShippingUnlocked")}</p>
                  <FreeShippingBar subtotal={goodsSubtotal} threshold={freeShippingOver} />
                </div>}
                <ul className="flex-1 divide-y divide-line overflow-y-auto px-6">
                  <AnimatePresence initial={false}>
                    {lines.map((l) => (
                      <CartLine key={l.id} line={l} compact />
                    ))}
                  </AnimatePresence>
                </ul>
                <footer className="space-y-4 border-t border-line px-6 py-6">
                  <div className="flex items-baseline justify-between">
                    <span className="eyebrow !text-muted">{t("subtotal")}</span>
                    <span className="font-display text-2xl tabular-nums">{money(subtotal)}</span>
                  </div>
                  <p className="text-xs text-subtle">{t("taxNote")}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Button variant="outline" asChild onClick={close}>
                      <Link href="/cart">{t("viewBag")}</Link>
                    </Button>
                    <Button asChild onClick={close}>
                      <Link href="/checkout">{t("checkout")}</Link>
                    </Button>
                  </div>
                </footer>
              </>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
