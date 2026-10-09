"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Minus, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLenis } from "lenis/react";
import { toast } from "sonner";
import { quickViewProduct, type QuickViewData } from "@/actions/engagement";
import { Button } from "@/components/ui/button";
import { Price } from "@/components/money";
import { useAddToBag } from "@/components/cart/add-to-bag";
import { useStoreConfig } from "@/components/store-config";
import { ease, easeIn } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { productHref } from "@/lib/product-href";
import { rememberVisual } from "@/lib/morph";
import { closeQuickView, forgetQuickView, QUICK_VIEW_PARAM } from "@/lib/quick-view";
import { useClientValue } from "@/lib/use-client";
import { Stars } from "./reviews";
import { ProductArt } from "./product-art";
import { ProductPhoto } from "./product-photo";
import { cardImage } from "./product-card";

const cache = new Map<string, Promise<QuickViewData | null>>();
const load = (slug: string) => {
  if (!cache.has(slug)) {
    const p = quickViewProduct(slug).catch(() => null);
    cache.set(slug, p);
    // Don't keep failures around.
    p.then((d) => d || cache.delete(slug));
  }
  return cache.get(slug)!;
};

const desktopQuery = "(min-width: 768px)";
const subscribeDesktop = (cb: () => void) => {
  const m = window.matchMedia(desktopQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

/**
 * Quick view: a product's essentials in a dialog over the page — size, price, add to bag, and the way to the
 * full page. Driven by `?view=<slug>` (shareable; back closes it). Radix supplies the focus trap, Escape,
 * labelling and scroll lock; Lenis is paused while it's open.
 */
export function QuickViewHost() {
  const t = useTranslations("product");
  const slug = useSearchParams().get(QUICK_VIEW_PARAM);
  const [data, setData] = useState<{ slug: string; product: QuickViewData } | null>(null);
  const lenis = useLenis();
  const desktop = useClientValue(() => window.matchMedia(desktopQuery).matches, true, subscribeDesktop);
  const open = Boolean(slug);
  const product = data && data.slug === slug ? data.product : null;

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    load(slug).then((p) => {
      if (!alive) return;
      if (p) setData({ slug, product: p });
      else {
        toast.error(t("previewUnavailable"));
        closeQuickView();
      }
    });
    return () => {
      alive = false;
    };
  }, [slug, t]);

  useEffect(() => {
    if (!lenis) return;
    if (open) lenis.stop();
    else lenis.start();
  }, [open, lenis]);

  // Closed with the browser's back button: the entry we pushed is gone.
  useEffect(() => {
    const onPop = () => !new URL(window.location.href).searchParams.has(QUICK_VIEW_PARAM) && forgetQuickView();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && closeQuickView()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-[3px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.5, ease } }}
                exit={{ opacity: 0, transition: { duration: 0.3, ease: easeIn } }}
              />
            </Dialog.Overlay>
            <div className="pointer-events-none fixed inset-0 z-[71] flex items-end justify-center md:items-center md:p-8">
              <Dialog.Content asChild forceMount aria-describedby={undefined}>
                <motion.div
                  className="pointer-events-auto relative flex max-h-[92svh] w-full flex-col overflow-hidden border-t border-line-strong bg-bg-elev shadow-luxe md:max-h-[min(44rem,88svh)] md:max-w-4xl md:border"
                  initial={desktop ? { opacity: 0, y: 28, scale: 0.98 } : { y: "100%" }}
                  animate={desktop ? { opacity: 1, y: 0, scale: 1, transition: { duration: 0.6, ease } } : { y: 0, transition: { duration: 0.6, ease } }}
                  exit={desktop ? { opacity: 0, y: 16, scale: 0.985, transition: { duration: 0.28, ease: easeIn } } : { y: "100%", transition: { duration: 0.35, ease: easeIn } }}
                  // Swipe the sheet down to dismiss on phones.
                  drag={desktop ? false : "y"}
                  dragConstraints={{ top: 0, bottom: 0 }}
                  dragElastic={{ top: 0, bottom: 0.6 }}
                  onDragEnd={(_, info) => {
                    if (info.offset.y > 120 || info.velocity.y > 600) closeQuickView();
                  }}
                >
                  {!desktop && <span aria-hidden className="mx-auto mt-3 block h-1 w-10 shrink-0 rounded-full bg-line-strong" />}
                  {product ? <QuickViewBody key={product.slug} product={product} /> : <QuickViewSkeleton />}
                  <Dialog.Close asChild>
                    <CloseButton />
                  </Dialog.Close>
                </motion.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function CloseButton(props: React.ComponentProps<"button">) {
  const t = useTranslations("common");
  return (
    <button {...props} type="button" aria-label={t("close")} className="press absolute end-3 top-3 z-10 grid size-10 place-items-center bg-bg-elev/80 text-muted backdrop-blur transition-colors hover:text-gold">
      <X className="size-5" strokeWidth={1.2} />
    </button>
  );
}

function QuickViewSkeleton() {
  const t = useTranslations("common");
  return (
    <div className="grid min-h-0 md:grid-cols-2" aria-busy="true">
      <Dialog.Title className="sr-only">{t("loading")}</Dialog.Title>
      <div className="skeleton aspect-[4/3] md:aspect-auto md:min-h-[32rem]" />
      <div className="space-y-4 p-6 md:p-10">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton h-12 w-3/4" />
        <div className="skeleton h-4 w-1/2" />
        <div className="skeleton mt-8 h-8 w-28" />
        <div className="skeleton mt-8 h-14 w-full" />
      </div>
    </div>
  );
}

function QuickViewBody({ product }: { product: QuickViewData }) {
  const t = useTranslations("product");
  const { lowStock } = useStoreConfig();
  const { add, pending } = useAddToBag();
  const media = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(product.variants.find((v) => v.available > 0)?.id ?? product.variants[0]?.id);
  const [qty, setQty] = useState(1);
  const v = product.variants.find((x) => x.id === selected) ?? product.variants[0];
  const cover = product.images[0];
  const href = productHref(product.slug);
  if (!v) return null;
  const soldOut = v.available <= 0;
  const notes = [product.topNotes, product.heartNotes, product.baseNotes].flat().slice(0, 5);

  const addToBag = () => {
    add({
      variantId: v.id,
      qty,
      price: v.price,
      source: media.current,
      item: { name: product.name, label: product.variants.length > 1 ? v.label : undefined, model: product.model, palette: product.palette, image: cardImage(product.images) },
    });
    // Step aside so the piece can be seen landing in the bag.
    closeQuickView();
  };

  return (
    <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-2 md:overflow-hidden" data-lenis-prevent>
      <div ref={media} className="relative aspect-[4/3] shrink-0 overflow-hidden bg-bg-soft md:aspect-auto md:min-h-[32rem]">
        {cover ? <ProductPhoto item={cover} palette={product.palette} sizes="(min-width: 768px) 28rem, 100vw" /> : <ProductArt model={product.model} palette={product.palette} />}
      </div>
      <motion.div
        className="flex min-h-0 flex-col p-6 md:overflow-y-auto md:p-10"
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.12 } } }}
        data-lenis-prevent
      >
        <Item>
          <p className="eyebrow">{product.category.name}</p>
        </Item>
        <Item>
          <Dialog.Title className="display mt-4 pe-10 text-4xl md:text-5xl">{product.name}</Dialog.Title>
        </Item>
        <Item>
          <p className="mt-3 font-display text-lg italic text-muted">{product.subtitle}</p>
          {product.ratingCount > 0 && (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted">
              <Stars value={product.ratingAvg} /> {product.ratingAvg.toFixed(1)} · {t("reviewsCount", { count: product.ratingCount })}
            </p>
          )}
        </Item>
        <Item className="mt-6 flex items-baseline justify-between gap-4">
          <Price amount={v.price * qty} compareAt={v.compareAtPrice ? v.compareAtPrice * qty : null} className="font-display text-3xl" />
          {!soldOut && v.available <= lowStock && (
            <span className="flex items-center gap-2 text-xs text-ember">
              <span className="pulse-dot size-1.5 rounded-full bg-ember" aria-hidden />
              {t("onlyLeft", { count: v.available })}
            </span>
          )}
        </Item>
        {notes.length > 0 && (
          <Item>
            <p className="mt-4 text-sm text-muted">{notes.join(" · ")}</p>
          </Item>
        )}
        {product.variants.length > 1 && (
          <Item>
            <fieldset className="mt-6">
              <legend className="eyebrow mb-3 !text-muted">{t("size")}</legend>
              <div className="flex flex-wrap gap-2">
                {product.variants.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => {
                      setSelected(x.id);
                      setQty(1);
                    }}
                    aria-pressed={x.id === v.id}
                    className={cn(
                      "press border px-4 py-2.5 text-sm transition-colors duration-500",
                      x.id === v.id ? "border-gold text-fg" : "border-line text-muted hover:border-line-strong",
                      x.available <= 0 && "text-subtle line-through",
                    )}
                  >
                    {x.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </Item>
        )}
        <Item className="mt-8 flex gap-3">
          {soldOut ? (
            <Button variant="outline" size="lg" className="w-full" asChild>
              <Link href={href} replace onClick={() => forgetQuickView()}>
                {t("soldOutNotify")}
              </Link>
            </Button>
          ) : (
            <>
              <div className="flex items-center border border-line-strong">
                <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="press grid size-12 place-items-center hover:text-gold" aria-label={t("decrease")}>
                  <Minus className="size-3.5" />
                </button>
                <span className="w-7 text-center tabular-nums" aria-live="polite">
                  {qty}
                </span>
                <button type="button" onClick={() => setQty((q) => Math.min(Math.min(10, v.available), q + 1))} className="press grid size-12 place-items-center hover:text-gold" aria-label={t("increase")}>
                  <Plus className="size-3.5" />
                </button>
              </div>
              <Button size="lg" className="flex-1 px-4" onClick={addToBag} disabled={pending}>
                {t("addToBag")}
              </Button>
            </>
          )}
        </Item>
        <Item className="mt-auto pt-8">
          <Link
            href={href}
            replace
            onClick={() => {
              forgetQuickView();
              rememberVisual(product.slug, { model: product.model, palette: product.palette, cover, hasMedia: product.images.length > 0 });
            }}
            className="link-draw eyebrow inline-flex items-center gap-2"
          >
            {t("viewDetails")} <ArrowUpRight className="size-3.5 rtl:-scale-x-100" strokeWidth={1.2} />
          </Link>
        </Item>
      </motion.div>
    </div>
  );
}

function Item({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease } } }}>
      {children}
    </motion.div>
  );
}
