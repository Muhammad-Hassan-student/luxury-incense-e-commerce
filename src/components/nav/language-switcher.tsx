"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { setLocale } from "@/actions/engagement";
import { LOCALES, localeInfo, type Locale } from "@/i18n/locales";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Switches the cookie locale in place: the server action sets NEXT_LOCALE and revalidates the layout, so the page
 * re-renders in the new language (and direction) without a navigation or losing scroll position.
 * A `?lang=` in the address (an hreflang link) is dropped first, otherwise the proxy would switch straight back.
 */
function useSwitch() {
  const [pending, start] = useTransition();
  const choose = (code: Locale) =>
    start(async () => {
      const url = new URL(window.location.href);
      if (url.searchParams.has("lang")) {
        url.searchParams.delete("lang");
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      }
      await setLocale(code);
    });
  return { pending, choose };
}

/** Header (opens downward) and footer (opens upward) dropdown. Names are always shown in their own language. */
export function LanguageSwitcher({ placement = "down", className }: { placement?: "down" | "up"; className?: string }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const current = localeInfo(locale);
  const [open, setOpen] = useState(false);
  const { pending, choose } = useSwitch();
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

  return (
    <div ref={ref} className={cn("relative", pending && "opacity-60", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${t("language")}: ${current.native}`}
        className="inline-flex items-center gap-1.5 text-[0.6875rem] tracking-[0.12em] text-muted transition-colors hover:text-fg"
      >
        <span lang={current.code}>{current.native}</span>
        <ChevronDown className={cn("size-3 transition-transform duration-500", open && "rotate-180", placement === "up" && "rotate-180", open && placement === "up" && "rotate-0")} strokeWidth={1.4} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            id={listId}
            role="listbox"
            aria-label={t("language")}
            initial={{ opacity: 0, y: placement === "up" ? 6 : -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: placement === "up" ? 6 : -6, transition: { duration: 0.2 } }}
            transition={{ duration: 0.35, ease }}
            className={cn(
              "absolute end-0 z-50 min-w-48 border border-line bg-bg/95 py-2 shadow-luxe backdrop-blur-xl",
              placement === "up" ? "bottom-full mb-3" : "top-full mt-3",
            )}
          >
            {LOCALES.map((l) => (
              <li key={l.code} role="option" aria-selected={l.code === current.code}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (l.code !== current.code) choose(l.code);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-6 px-4 py-2 text-start text-sm transition-colors hover:bg-fg/[0.04] hover:text-fg",
                    l.code === current.code ? "text-gold" : "text-muted",
                  )}
                >
                  <span lang={l.code} dir={l.dir}>
                    {l.native}
                  </span>
                  {l.code === current.code ? <Check className="size-3.5" strokeWidth={1.4} /> : <span lang="en" className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">{l.code}</span>}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Mobile menu: every language visible at once, as a calm grid of native names. */
export function LanguageList({ className }: { className?: string }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const { pending, choose } = useSwitch();
  return (
    <div className={cn(pending && "opacity-60", className)}>
      <p className="eyebrow mb-4">{t("language")}</p>
      <ul className="grid grid-cols-3 gap-x-4 gap-y-3">
        {LOCALES.map((l) => (
          <li key={l.code}>
            <button
              type="button"
              lang={l.code}
              dir={l.dir}
              aria-current={l.code === locale ? "true" : undefined}
              onClick={() => l.code !== locale && choose(l.code)}
              className={cn("text-sm transition-colors hover:text-fg", l.code === locale ? "text-gold" : "text-muted")}
            >
              {l.native}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
