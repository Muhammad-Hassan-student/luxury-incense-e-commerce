"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "framer-motion";
import { Menu, Moon, Search, ShoppingBag, Sun, User, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { brand, currencies } from "@/config/brand";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useUI } from "@/store/ui";
import { setCurrency, setLocale } from "@/actions/engagement";
import { useCurrency } from "@/components/money";
import { useTheme } from "@/lib/use-client";

export type NavCategory = { slug: string; name: string; tagline: string };

export function HeaderClient({
  categories,
  count,
  signedIn,
  locale,
  announcement,
}: {
  categories: NavCategory[];
  count: number;
  signedIn: boolean;
  locale: string;
  announcement: string;
}) {
  const t = useTranslations("nav");
  const { scrollY } = useScroll();
  const [solid, setSolid] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [megaFor, setMegaFor] = useState<string | null>(null);
  const toggle = useUI((s) => s.toggle);
  const panel = useUI((s) => s.panel);
  const pathname = usePathname();
  const overHero = pathname === "/";
  const mega = megaFor === pathname;
  const setMega = (open: boolean) => setMegaFor(open ? pathname : null);

  useMotionValueEvent(scrollY, "change", (y) => {
    const prev = scrollY.getPrevious() ?? 0;
    setSolid(y > 40);
    setHidden(y > 400 && y > prev && !mega);
  });

  // ⌘K / Ctrl+K opens search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle("search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const links = [
    { href: "/collections", label: t("collections") },
    { href: "/ritual", label: t("ritual") },
    { href: "/gifts/coffret", label: t("gifts") },
    { href: "/journal", label: t("journal") },
  ];

  return (
    <>
      {announcement && (
        <div className="relative z-50 overflow-hidden truncate border-b border-line bg-bg px-4 py-2 text-center text-[0.5625rem] uppercase tracking-[0.18em] text-muted sm:text-[0.625rem] sm:tracking-[0.3em]">
          {announcement}
        </div>
      )}
      <motion.header
        animate={{ y: hidden ? "-100%" : "0%" }}
        transition={{ duration: 0.7, ease }}
        onMouseLeave={() => setMega(false)}
        className={cn(
          "sticky top-0 z-40 transition-[background-color,border-color,backdrop-filter] duration-700",
          solid || mega || !overHero ? "border-b border-line bg-bg/80 backdrop-blur-xl" : "border-b border-transparent",
        )}
      >
        <div className="container-luxe grid h-18 grid-cols-[1fr_auto_1fr] items-center md:h-20">
          <nav className="flex items-center gap-8" aria-label="Primary">
            <button className="md:hidden" onClick={() => toggle("menu")} aria-label={t("menu")}>
              {panel === "menu" ? <X className="size-5" strokeWidth={1.2} /> : <Menu className="size-5" strokeWidth={1.2} />}
            </button>
            <Link
              href="/shop"
              onMouseEnter={() => setMega(true)}
              onFocus={() => setMega(true)}
              className="link-draw hidden text-[0.6875rem] uppercase tracking-[0.28em] md:inline"
            >
              {t("shop")}
            </Link>
            {links.slice(0, 2).map((l) => (
              <Link key={l.href} href={l.href} onMouseEnter={() => setMega(false)} className="link-draw hidden text-[0.6875rem] uppercase tracking-[0.28em] lg:inline">
                {l.label}
              </Link>
            ))}
          </nav>

          <Link href="/" className="group flex flex-col items-center" aria-label={brand.name}>
            <span className="whitespace-nowrap font-display text-base tracking-[0.24em] sm:text-xl sm:tracking-[0.36em] md:text-2xl md:tracking-[0.42em]">{brand.name.toUpperCase()}</span>
            <span className="mt-0.5 hidden h-px w-0 bg-gold transition-all duration-700 ease-luxe group-hover:w-full md:block" />
          </Link>

          <div className="flex items-center justify-end gap-3 sm:gap-4 md:gap-6">
            {links.slice(2).map((l) => (
              <Link key={l.href} href={l.href} className="link-draw hidden text-[0.6875rem] uppercase tracking-[0.28em] xl:inline">
                {l.label}
              </Link>
            ))}
            <button onClick={() => toggle("search")} aria-label={t("search")} className="transition-colors hover:text-gold">
              <Search className="size-[18px]" strokeWidth={1.2} />
            </button>
            <span className="hidden sm:contents">
              <ThemeToggle label={t("theme")} />
            </span>
            <Link href={signedIn ? "/account" : "/signin"} aria-label={t("account")} className="hidden transition-colors hover:text-gold sm:block">
              <User className="size-[18px]" strokeWidth={1.2} />
            </Link>
            <button onClick={() => toggle("cart")} aria-label={`${t("bag")} (${count})`} className="relative transition-colors hover:text-gold">
              <ShoppingBag className="size-[18px]" strokeWidth={1.2} />
              <AnimatePresence>
                {count > 0 && (
                  <motion.span
                    key={count}
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.4, opacity: 0 }}
                    className="absolute -end-2 -top-2 grid size-4 place-items-center rounded-full bg-gold text-[0.5625rem] font-medium text-bg"
                  >
                    {count}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </div>
        </div>

        <AnimatePresence>
          {mega && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.6, ease }}
              className="hidden overflow-hidden border-t border-line md:block"
            >
              <div className="container-luxe grid grid-cols-6 gap-6 py-10">
                {categories.map((c, i) => (
                  <motion.div key={c.slug} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i, duration: 0.6, ease }}>
                    <Link href={`/shop/${c.slug}`} className="group block">
                      <span className="font-display text-2xl transition-colors group-hover:text-gold">{c.name}</span>
                      <span className="mt-2 block text-xs text-muted">{c.tagline}</span>
                    </Link>
                  </motion.div>
                ))}
              </div>
              <div className="container-luxe flex items-center justify-between border-t border-line py-4">
                <Prefs locale={locale} />
                <Link href="/shop" className="link-draw eyebrow">
                  View everything
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.header>

      <MobileMenu categories={categories} links={links} signedIn={signedIn} locale={locale} />
    </>
  );
}

function ThemeToggle({ label }: { label: string }) {
  const theme = useTheme();
  const flip = () => {
    const next = theme === "nuit" ? "ivoire" : "nuit";
    const apply = () => {
      document.documentElement.dataset.theme = next;
    };
    // Read by the root layout on the next request, so reloads render the right theme server-side.
    document.cookie = `mo-theme=${next}; path=/; max-age=31536000; samesite=lax`;
    // Cross-fade the whole page when supported.
    const d = document as Document & { startViewTransition?: (cb: () => void) => void };
    if (d.startViewTransition) d.startViewTransition(apply);
    else apply();
  };
  return (
    <button onClick={flip} aria-label={label} className="transition-colors hover:text-gold">
      {theme === "nuit" ? <Sun className="size-[18px]" strokeWidth={1.2} /> : <Moon className="size-[18px]" strokeWidth={1.2} />}
    </button>
  );
}

export function Prefs({ locale }: { locale: string }) {
  const currency = useCurrency();
  const [pending, start] = useTransition();
  return (
    <div className={cn("flex items-center gap-6 text-[0.625rem] uppercase tracking-[0.24em] text-muted", pending && "opacity-50")}>
      <div className="flex gap-3">
        {(["en", "ar"] as const).map((l) => (
          <button key={l} onClick={() => start(() => setLocale(l))} className={cn("transition-colors hover:text-fg", locale === l && "text-gold")}>
            {l === "en" ? "English" : "العربية"}
          </button>
        ))}
      </div>
      <span className="h-3 w-px bg-line-strong" />
      <div className="flex gap-3">
        {Object.keys(currencies).map((c) => (
          <button key={c} onClick={() => start(() => setCurrency(c))} className={cn("transition-colors hover:text-fg", currency === c && "text-gold")}>
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

function MobileMenu({ categories, links, signedIn, locale }: { categories: NavCategory[]; links: { href: string; label: string }[]; signedIn: boolean; locale: string }) {
  const open = useUI((s) => s.panel === "menu");
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ clipPath: "inset(0 0 100% 0)" }}
          animate={{ clipPath: "inset(0 0 0% 0)" }}
          exit={{ clipPath: "inset(0 0 100% 0)" }}
          transition={{ duration: 0.8, ease }}
          className="fixed inset-0 top-18 z-30 overflow-y-auto bg-bg md:hidden"
          data-lenis-prevent
        >
          <div className="container-luxe flex min-h-full flex-col py-10">
            <p className="eyebrow mb-6">Shop</p>
            {categories.map((c, i) => (
              <motion.div key={c.slug} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.05, duration: 0.7, ease }}>
                <Link href={`/shop/${c.slug}`} className="block border-b border-line py-3 font-display text-4xl">
                  {c.name}
                </Link>
              </motion.div>
            ))}
            <div className="mt-10 grid gap-4">
              {[...links, { href: signedIn ? "/account" : "/signin", label: signedIn ? "Account" : "Sign in" }, { href: signedIn ? "/account/security" : "/signin?callbackUrl=%2Faccount%2Fsecurity", label: "Security lock" }].map((l) => (
                <Link key={l.href} href={l.href} className="text-[0.6875rem] uppercase tracking-[0.28em] text-muted">
                  {l.label}
                </Link>
              ))}
            </div>
            <div className="mt-auto flex items-center justify-between gap-6 pt-12">
              <Prefs locale={locale} />
              <ThemeToggle label="Toggle theme" />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
