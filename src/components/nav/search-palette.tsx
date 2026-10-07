"use client";

import { Command } from "cmdk";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { searchProducts } from "@/actions/engagement";
import { useUI } from "@/store/ui";
import { ease } from "@/lib/motion";
import { ProductArt } from "@/components/product/product-art";
import { MediaImage } from "@/components/media";
import { useMoney } from "@/components/money";
import type { NavCategory } from "./header-client";
import { productHref } from "@/lib/product-href";

type Hit = Awaited<ReturnType<typeof searchProducts>>[number];

const suggestions = ["oud", "sandalwood", "rose", "amber", "vetiver", "jasmine"];

export function SearchPalette({ categories }: { categories: NavCategory[] }) {
  const open = useUI((s) => s.panel === "search");
  const close = useUI((s) => s.close);
  return (
    <AnimatePresence>
      {open && <PaletteBody categories={categories} close={close} />}
    </AnimatePresence>
  );
}

/** Mounted only while open, so the query resets every time the palette closes. */
function PaletteBody({ categories, close }: { categories: NavCategory[]; close: () => void }) {
  const router = useRouter();
  const money = useMoney();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ q: string; hits: Hit[] }>({ q: "", hits: [] });
  const [pending, start] = useTransition();
  const searching = q.trim().length >= 2;
  const hits = searching ? results.hits : [];

  useEffect(() => {
    if (!searching) return;
    const id = setTimeout(() => start(async () => setResults({ q, hits: await searchProducts(q) })), 180);
    return () => clearTimeout(id);
  }, [q, searching]);

  const go = (href: string) => {
    close();
    router.push(href);
  };

  return (
        <motion.div
          className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
          data-lenis-prevent
        >
          <motion.div
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.6, ease }}
            className="w-full max-w-2xl border border-line-strong bg-bg-elev shadow-luxe"
            onClick={(e) => e.stopPropagation()}
          >
            <Command shouldFilter={false} label="Search the house" onKeyDown={(e) => e.key === "Escape" && close()}>
              <div className="flex items-center gap-4 border-b border-line px-6">
                <Search className="size-4 text-muted" strokeWidth={1.2} />
                <Command.Input
                  autoFocus
                  value={q}
                  onValueChange={setQ}
                  placeholder="Search scents, notes, rituals…"
                  className="h-16 flex-1 bg-transparent font-display text-2xl placeholder:text-subtle focus:outline-none"
                />
                <kbd className="text-[0.625rem] tracking-widest text-subtle">ESC</kbd>
              </div>
              <Command.List className="max-h-[55vh] overflow-y-auto p-3">
                {q.trim().length < 2 ? (
                  <>
                    <Command.Group heading="Try" className="px-3 pb-2 pt-3 text-[0.625rem] uppercase tracking-[0.3em] text-subtle [&_[cmdk-group-items]]:mt-3 [&_[cmdk-group-items]]:flex [&_[cmdk-group-items]]:flex-wrap [&_[cmdk-group-items]]:gap-2">
                      {suggestions.map((s) => (
                        <Command.Item key={s} value={s} onSelect={() => setQ(s)} className="cursor-pointer border border-line-strong px-3 py-1.5 text-xs normal-case tracking-normal text-fg data-[selected=true]:border-gold data-[selected=true]:text-gold">
                          {s}
                        </Command.Item>
                      ))}
                    </Command.Group>
                    <Command.Group heading="Browse" className="px-3 pt-4 text-[0.625rem] uppercase tracking-[0.3em] text-subtle [&_[cmdk-group-items]]:mt-2">
                      {categories.map((c) => (
                        <Command.Item key={c.slug} value={c.slug} onSelect={() => go(`/shop/${c.slug}`)} className="flex cursor-pointer items-baseline justify-between px-3 py-3 font-display text-xl normal-case tracking-normal text-fg data-[selected=true]:bg-bg-soft data-[selected=true]:text-gold">
                          {c.name}
                          <span className="font-sans text-xs text-muted">{c.tagline}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  </>
                ) : (
                  <>
                    {!pending && hits.length === 0 && <Command.Empty className="px-3 py-10 text-center text-sm text-muted">Nothing matches “{q}”. Try a note like rose or oud.</Command.Empty>}
                    {hits.map((h) => (
                      <Command.Item key={h.slug} value={h.slug} onSelect={() => go(productHref(h.slug))} className="flex cursor-pointer items-center gap-4 px-3 py-2 data-[selected=true]:bg-bg-soft">
                        <span className="relative h-16 w-13 shrink-0 overflow-hidden bg-bg-soft">
                          {h.images[0] ? (
                            h.images[0].cutoutUrl && h.images[0].display !== "PHOTO" ? (
                              <MediaImage src={h.images[0].cutoutUrl} alt="" sizes="52px" className="!object-contain p-1" />
                            ) : (
                              <MediaImage src={h.images[0].url} alt="" sizes="52px" className="photo-grade" />
                            )
                          ) : (
                            <ProductArt model={h.model} palette={h.palette} animated={false} />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-display text-xl">{h.name}</span>
                          <span className="block truncate text-xs text-muted">
                            {h.category.name} · {h.subtitle}
                          </span>
                        </span>
                        {h.variants[0] && <span className="text-sm tabular-nums text-muted">{money(h.variants[0].price)}</span>}
                      </Command.Item>
                    ))}
                    {hits.length > 0 && (
                      <Command.Item value="all" onSelect={() => go(`/shop?q=${encodeURIComponent(q)}`)} className="mt-2 cursor-pointer px-3 py-3 text-[0.6875rem] uppercase tracking-[0.28em] text-gold data-[selected=true]:bg-bg-soft">
                        See all results for “{q}”
                      </Command.Item>
                    )}
                  </>
                )}
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
  );
}
