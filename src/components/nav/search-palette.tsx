"use client";

import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Clock, CornerDownLeft, Search, X } from "lucide-react";
import { searchProducts } from "@/actions/engagement";
import { useUI } from "@/store/ui";
import { ease, easeIn } from "@/lib/motion";
import { ProductArt } from "@/components/product/product-art";
import { MediaImage } from "@/components/media";
import { useMoney } from "@/components/money";
import type { NavCategory } from "./header-client";
import { productHref } from "@/lib/product-href";

type Hit = Awaited<ReturnType<typeof searchProducts>>[number];

const suggestions = ["oud", "sandalwood", "rose", "amber", "vetiver", "jasmine"];

/** Recent searches stay in this browser only. */
const RECENT_KEY = "mo-recent-searches";
function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}
function writeRecent(list: string[]) {
  try {
    if (list.length) localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
    else localStorage.removeItem(RECENT_KEY);
  } catch {}
}

/** Wraps each case-insensitive occurrence of the query in a gold <mark>. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (q.length < 2) return <>{text}</>;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <mark key={i} className="bg-transparent text-gold">
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

export function SearchPalette({ categories }: { categories: NavCategory[] }) {
  const open = useUI((s) => s.panel === "search");
  const close = useUI((s) => s.close);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <AnimatePresence>{open && <PaletteBody categories={categories} close={close} />}</AnimatePresence>
    </Dialog.Root>
  );
}

/** Mounted only while open, so the query resets every time the palette closes. */
function PaletteBody({ categories, close }: { categories: NavCategory[]; close: () => void }) {
  const t = useTranslations("search");
  const router = useRouter();
  const money = useMoney();
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [results, setResults] = useState<{ q: string; hits: Hit[] }>({ q: "", hits: [] });
  const [pending, start] = useTransition();
  const searching = q.trim().length >= 2;
  const hits = searching ? results.hits : [];

  useEffect(() => {
    if (!searching) return;
    const id = setTimeout(() => start(async () => setResults({ q, hits: await searchProducts(q) })), 180);
    return () => clearTimeout(id);
  }, [q, searching]);

  const remember = (term: string) => {
    const v = term.trim().toLowerCase();
    if (v.length < 2) return;
    const next = [v, ...recent.filter((r) => r !== v)].slice(0, 5);
    setRecent(next);
    writeRecent(next);
  };

  const go = (href: string, term?: string) => {
    if (term) remember(term);
    close();
    router.push(href);
  };

  const itemCls = "cursor-pointer px-3 normal-case tracking-normal text-fg data-[selected=true]:bg-bg-soft data-[selected=true]:text-gold";
  const groupCls = "px-3 pt-4 text-[0.625rem] uppercase tracking-[0.3em] text-subtle [&_[cmdk-group-heading]]:mb-2";

  return (
    <Dialog.Portal forceMount>
      <Dialog.Overlay asChild forceMount>
        <motion.div
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-[3px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.4, ease } }}
          exit={{ opacity: 0, transition: { duration: 0.25, ease: easeIn } }}
        />
      </Dialog.Overlay>
      <div className="pointer-events-none fixed inset-0 z-[61] flex items-start justify-center px-4 pt-[10vh] md:pt-[12vh]">
        <Dialog.Content asChild forceMount aria-describedby={undefined}>
          <motion.div
            initial={{ y: 24, opacity: 0, scale: 0.985 }}
            animate={{ y: 0, opacity: 1, scale: 1, transition: { duration: 0.5, ease } }}
            exit={{ y: 12, opacity: 0, transition: { duration: 0.22, ease: easeIn } }}
            className="pointer-events-auto w-full max-w-2xl overflow-hidden border border-line-strong bg-bg-elev shadow-luxe"
            data-lenis-prevent
          >
            <Dialog.Title className="sr-only">{t("label")}</Dialog.Title>
            <Command shouldFilter={false} label={t("label")} loop>
              <div className="relative flex items-center gap-4 border-b border-line px-5 md:px-6">
                <Search className="size-4 shrink-0 text-muted" strokeWidth={1.2} />
                <Command.Input
                  autoFocus
                  value={q}
                  onValueChange={setQ}
                  placeholder={t("placeholder")}
                  className="h-16 min-w-0 flex-1 bg-transparent font-display text-xl placeholder:text-subtle focus:outline-none md:text-2xl"
                />
                {q && (
                  <button type="button" onClick={() => setQ("")} aria-label={t("clearQuery")} className="press grid size-8 shrink-0 place-items-center text-subtle hover:text-fg">
                    <X className="size-4" strokeWidth={1.2} />
                  </button>
                )}
                <Dialog.Close className="press hidden shrink-0 border border-line px-2 py-1 text-[0.625rem] tracking-widest text-subtle hover:text-fg sm:block" aria-label={t("close")}>
                  ESC
                </Dialog.Close>
                {/* A thread of gold runs while results are on their way. */}
                <AnimatePresence>
                  {pending && (
                    <motion.span
                      aria-hidden
                      className="absolute inset-x-0 -bottom-px h-px origin-left bg-gold rtl:origin-right"
                      initial={{ scaleX: 0, opacity: 1 }}
                      animate={{ scaleX: 0.85, transition: { duration: 1.2, ease } }}
                      exit={{ scaleX: 1, opacity: 0, transition: { duration: 0.3 } }}
                    />
                  )}
                </AnimatePresence>
              </div>
              <Command.List className="max-h-[min(55vh,32rem)] overflow-y-auto overscroll-contain p-3">
                {!searching ? (
                  <>
                    {recent.length > 0 && (
                      <Command.Group heading={t("recent")} className={groupCls}>
                        {recent.map((r) => (
                          <Command.Item key={r} value={`recent-${r}`} onSelect={() => setQ(r)} className={`${itemCls} flex items-center gap-3 py-2.5 text-sm`}>
                            <Clock className="size-3.5 text-subtle" strokeWidth={1.2} />
                            <span className="flex-1">{r}</span>
                          </Command.Item>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            setRecent([]);
                            writeRecent([]);
                          }}
                          className="link-draw mt-1 px-3 py-1 text-[0.625rem] uppercase tracking-[0.24em] text-subtle hover:text-fg"
                        >
                          {t("clearRecent")}
                        </button>
                      </Command.Group>
                    )}
                    <Command.Group heading={t("try")} className={`${groupCls} [&_[cmdk-group-items]]:flex [&_[cmdk-group-items]]:flex-wrap [&_[cmdk-group-items]]:gap-2`}>
                      {suggestions.map((s) => (
                        <Command.Item key={s} value={s} onSelect={() => setQ(s)} className="press cursor-pointer border border-line-strong px-3 py-1.5 text-xs normal-case tracking-normal text-fg data-[selected=true]:border-gold data-[selected=true]:text-gold">
                          {s}
                        </Command.Item>
                      ))}
                    </Command.Group>
                    <Command.Group heading={t("browse")} className={groupCls}>
                      {categories.map((c) => (
                        <Command.Item key={c.slug} value={c.slug} onSelect={() => go(`/shop/${c.slug}`)} className={`${itemCls} flex items-baseline justify-between gap-4 py-3 font-display text-xl`}>
                          {c.name}
                          <span className="truncate font-sans text-xs text-muted">{c.tagline}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  </>
                ) : (
                  <>
                    {!pending && hits.length === 0 && results.q === q && <Command.Empty className="px-3 py-10 text-center text-sm text-muted">{t("noResults", { q })}</Command.Empty>}
                    {hits.map((h, i) => (
                      <Command.Item key={h.slug} value={h.slug} onSelect={() => go(productHref(h.slug), q)} className={`${itemCls} flex items-center gap-4 py-2`}>
                        <motion.span
                          className="relative h-16 w-13 shrink-0 overflow-hidden bg-bg-soft"
                          initial={{ opacity: 0, scale: 0.94 }}
                          animate={{ opacity: 1, scale: 1, transition: { duration: 0.4, ease, delay: i * 0.03 } }}
                        >
                          {h.images[0] ? (
                            h.images[0].cutoutUrl && h.images[0].display !== "PHOTO" ? (
                              <MediaImage src={h.images[0].cutoutUrl} alt="" sizes="52px" className="!object-contain p-1" />
                            ) : (
                              <MediaImage src={h.images[0].url} alt="" sizes="52px" className="photo-grade" />
                            )
                          ) : (
                            <ProductArt model={h.model} palette={h.palette} animated={false} />
                          )}
                        </motion.span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-display text-xl">
                            <Highlight text={h.name} query={q} />
                          </span>
                          <span className="block truncate text-xs text-muted">
                            {h.category.name} · <Highlight text={h.subtitle} query={q} />
                          </span>
                        </span>
                        {h.variants[0] && <span className="text-sm tabular-nums text-muted">{money(h.variants[0].price)}</span>}
                      </Command.Item>
                    ))}
                    {hits.length > 0 && (
                      <Command.Item value="all" onSelect={() => go(`/shop?q=${encodeURIComponent(q)}`, q)} className="mt-2 cursor-pointer px-3 py-3 text-[0.6875rem] uppercase tracking-[0.28em] text-gold data-[selected=true]:bg-bg-soft">
                        {t("seeAll", { q })}
                      </Command.Item>
                    )}
                  </>
                )}
              </Command.List>
              <div className="hidden items-center gap-5 border-t border-line px-6 py-3 text-[0.625rem] uppercase tracking-[0.2em] text-subtle sm:flex" aria-hidden>
                <span className="flex items-center gap-1.5">
                  <kbd className="border border-line px-1.5 py-0.5 font-sans">↑</kbd>
                  <kbd className="border border-line px-1.5 py-0.5 font-sans">↓</kbd>
                  {t("hintNavigate")}
                </span>
                <span className="flex items-center gap-1.5">
                  <kbd className="grid place-items-center border border-line px-1.5 py-0.5">
                    <CornerDownLeft className="size-3 rtl:-scale-x-100" />
                  </kbd>
                  {t("hintOpen")}
                </span>
                <span className="flex items-center gap-1.5">
                  <kbd className="border border-line px-1.5 py-0.5 font-sans">esc</kbd>
                  {t("hintClose")}
                </span>
                <span className="ms-auto flex items-center gap-1.5">
                  <kbd className="border border-line px-1.5 py-0.5 font-sans">⌘K</kbd>
                  {t("hintToggle")}
                </span>
              </div>
            </Command>
          </motion.div>
        </Dialog.Content>
      </div>
    </Dialog.Portal>
  );
}
