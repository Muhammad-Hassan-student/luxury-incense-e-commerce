"use client";

import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { ShoppingBag, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useUI } from "@/store/ui";
import { ease, easeIn } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { CartLine, FreeShippingBar, type CartLineView } from "./cart-line";
import { CartSuggestions, type SuggestionView } from "./cart-suggestions";
import { RecentlyViewedStrip } from "@/components/product/recently-viewed";
import { useMoney } from "@/components/money";

/**
 * The bag drawer. Radix Dialog gives it a real modal: focus is trapped and restored, Escape closes,
 * the page behind is inert. It slides in from the inline end, so it comes from the left in Arabic.
 */
export function CartDrawerClient({
  lines,
  subtotal,
  goodsSubtotal,
  freeShippingOver,
  suggestions = [],
}: {
  lines: CartLineView[];
  subtotal: number;
  goodsSubtotal: number;
  freeShippingOver: number;
  suggestions?: SuggestionView[];
}) {
  const t = useTranslations("cart");
  const tc = useTranslations("common");
  const open = useUI((s) => s.panel === "cart");
  const close = useUI((s) => s.close);
  const money = useMoney();
  const off = useLocale() === "ar" ? "-100%" : "100%";
  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const remaining = freeShippingOver - goodsSubtotal;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.5, ease } }}
                exit={{ opacity: 0, transition: { duration: 0.35, ease: easeIn } }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.aside
                className="fixed inset-y-0 end-0 z-50 flex w-full max-w-md flex-col border-s border-line bg-bg-elev shadow-luxe outline-none"
                initial={{ x: off }}
                animate={{ x: 0, transition: { duration: 0.7, ease } }}
                exit={{ x: off, transition: { duration: 0.4, ease: easeIn } }}
                data-lenis-prevent
              >
                <header className="flex items-center justify-between border-b border-line px-6 py-5">
                  <Dialog.Title className="font-display text-2xl">
                    {t("title")} <span className="text-sm text-muted tabular-nums">({count})</span>
                  </Dialog.Title>
                  <Dialog.Close aria-label={tc("close")} className="press grid size-10 place-items-center -me-2 transition-colors hover:text-gold">
                    <X className="size-5" strokeWidth={1.2} />
                  </Dialog.Close>
                </header>

                {lines.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center overflow-y-auto px-8 py-12 text-center">
                    <motion.div
                      className="flex flex-1 flex-col items-center justify-center gap-4"
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0, transition: { duration: 0.7, ease, delay: 0.2 } }}
                    >
                      <span className="grid size-16 place-items-center rounded-full border border-line text-gold">
                        <ShoppingBag className="size-6" strokeWidth={1} />
                      </span>
                      <p className="font-display text-3xl">{t("empty")}</p>
                      <p className="text-sm text-muted">{t("emptyBody")}</p>
                      <Button variant="outline" className="mt-4" asChild>
                        <Link href="/shop" onClick={close}>
                          {t("continue")}
                        </Link>
                      </Button>
                    </motion.div>
                    <RecentlyViewedStrip onNavigate={close} className="mt-10 border-t border-line pt-6" />
                  </div>
                ) : (
                  <>
                    {goodsSubtotal > 0 && (
                      <div className="px-6 pt-5 text-xs text-muted" aria-live="polite">
                        <p className="mb-3">{remaining > 0 ? t("freeShippingAway", { amount: money(remaining) }) : <span className="text-gold">{t("freeShippingUnlocked")}</span>}</p>
                        <FreeShippingBar subtotal={goodsSubtotal} threshold={freeShippingOver} />
                      </div>
                    )}
                    <div className="flex-1 overflow-y-auto overscroll-contain">
                      <ul className="divide-y divide-line px-6">
                        <AnimatePresence initial={false}>
                          {lines.map((l) => (
                            <CartLine key={l.id} line={l} compact />
                          ))}
                        </AnimatePresence>
                      </ul>
                      {suggestions.length > 0 && <CartSuggestions items={suggestions} title={t("alsoLike")} onNavigate={close} />}
                    </div>
                    <footer className="space-y-4 border-t border-line px-6 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
                      <div className="flex items-baseline justify-between">
                        <span className="eyebrow !text-muted">{t("subtotal")}</span>
                        <motion.span key={subtotal} initial={{ opacity: 0.4, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }} className="font-display text-2xl tabular-nums">
                          {money(subtotal)}
                        </motion.span>
                      </div>
                      <p className="text-xs text-subtle">{t("taxNote")}</p>
                      <div className="grid grid-cols-2 gap-3">
                        <Button variant="outline" asChild>
                          <Link href="/cart" onClick={close}>
                            {t("viewBag")}
                          </Link>
                        </Button>
                        <Button asChild>
                          <Link href="/checkout" onClick={close}>
                            {t("checkout")}
                          </Link>
                        </Button>
                      </div>
                    </footer>
                  </>
                )}
              </motion.aside>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
