"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Heart, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { notifyWhenBack, toggleWishlist } from "@/actions/engagement";
import { Button } from "@/components/ui/button";
import { ConvertedNote, Price } from "@/components/money";
import { cn } from "@/lib/utils";
import { Magnetic } from "@/components/motion/magnetic";
import { useMoney } from "@/components/money";
import { useClientValue } from "@/lib/use-client";
import { useAddToBag, type AddedItem } from "@/components/cart/add-to-bag";
import { ProductArt } from "./product-art";
import { track } from "@/lib/analytics";
import { MediaImage } from "@/components/media";
import { PushOptIn } from "@/components/pwa/push-opt-in";
import { PreorderNote, SaleCountdown, useOffers } from "@/components/promo/promo-context";

function Thumb({ visual }: { visual: Omit<AddedItem, "name" | "label"> }) {
  return visual.image ? (
    <MediaImage src={visual.image.src} alt="" sizes="48px" className={visual.image.cutout ? "!object-contain p-1" : "photo-grade"} />
  ) : (
    <ProductArt model={visual.model} palette={visual.palette} animated={false} />
  );
}

type Variant = { id: string; label: string; price: number; compareAtPrice: number | null; available: number };

export function ProductBuy({
  productId,
  categoryKey = "",
  name,
  variants: rawVariants,
  wishlisted,
  signedIn,
  lowStock,
  visual,
  subscribe = null,
}: {
  productId: string;
  /** Category slug: flash sales can target categories. */
  categoryKey?: string;
  name: string;
  variants: Variant[];
  wishlisted: boolean;
  signedIn: boolean;
  lowStock: number;
  /** What flies into the bag and shows in the toast. */
  visual: Omit<AddedItem, "name" | "label">;
  /** Subscribe & Save offer for this product (null = one-time only). */
  subscribe?: { discountPercent: number } | null;
}) {
  const t = useTranslations("product");
  const tp = useTranslations("promo");
  const tw = useTranslations("wishlistToast");
  const router = useRouter();
  // Flash-sale prices and pre-order allocation (display; the server re-prices the bag).
  const offerOf = useOffers(productId, categoryKey);
  const variants = rawVariants.map((x) => {
    const o = offerOf(x);
    return { ...x, listPrice: x.price, price: o.price, compareAtPrice: o.compareAt, available: o.available, sale: o.sale, preorder: o.preorder };
  });
  const [selected, setSelected] = useState(variants.find((v) => v.available > 0)?.id ?? variants[0]?.id);
  const [qty, setQty] = useState(1);
  const [mode, setMode] = useState<"once" | "subscribe">("once");
  const [every, setEvery] = useState<1 | 2 | 3>(1);
  const [saved, setSaved] = useState(wishlisted);
  const [email, setEmail] = useState("");
  const [askedRestock, setAskedRestock] = useState(false);
  const [pending, start] = useTransition();
  const { add: addItem, pending: adding } = useAddToBag();
  const flyArt = useRef<HTMLDivElement>(null);
  const money = useMoney();
  const mounted = useClientValue(() => true, false);
  // Sticky bar on phones once the main add-to-bag row has scrolled above the viewport.
  const buyRow = useRef<HTMLDivElement>(null);
  const [showBar, setShowBar] = useState(false);
  useEffect(() => {
    // A scroll check rather than IntersectionObserver: a fast fling can jump straight past the row,
    // which never "intersects" and so would never notify.
    let frame = 0;
    const check = () => {
      frame = 0;
      const el = buyRow.current;
      setShowBar(Boolean(el && el.getBoundingClientRect().bottom < 0));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  // Lift the floating back-to-top button above the bar while it's showing.
  useEffect(() => {
    const root = document.documentElement;
    if (showBar) root.dataset.stickyBar = "";
    else delete root.dataset.stickyBar;
    return () => {
      delete root.dataset.stickyBar;
    };
  }, [showBar]);
  const v = variants.find((x) => x.id === selected) ?? variants[0];
  // view_item once per product page (queued until cookie consent, dropped if declined).
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current || !v) return;
    viewed.current = true;
    track("view_item", { items: [{ id: v.id, name, variant: variants.length > 1 ? v.label : undefined, price: v.price, quantity: 1 }] });
  }, [v, name, variants.length]);
  if (!v) return null;
  const soldOut = v.available <= 0;
  // Pre-order pieces are one-time purchases; Subscribe & Save is priced off the list price (sales don't stack on it).
  const offerSubscribe = v.preorder ? null : subscribe;
  const subscribing = Boolean(offerSubscribe) && mode === "subscribe";
  const unit = subscribing ? Math.round((v.listPrice * (100 - offerSubscribe!.discountPercent)) / 100) : v.price;

  // Fly from the product stage when it's on screen, otherwise from the button that was pressed.
  const add = (from: HTMLElement) => {
    const stage = document.querySelector("[data-pdp-stage]");
    const r = stage?.getBoundingClientRect();
    const stageVisible = r && r.bottom > 80 && r.top < window.innerHeight - 80;
    addItem({
      variantId: v.id,
      qty,
      price: unit,
      subscribe: subscribing ? { intervalMonths: every } : null,
      source: stageVisible ? stage : from,
      art: stageVisible && !stage?.querySelector("canvas") ? undefined : flyArt.current,
      item: { ...visual, name, label: [variants.length > 1 ? v.label : null, subscribing ? t("everyMonths", { count: every }) : null].filter(Boolean).join(" · ") || undefined },
    });
  };

  const wish = () =>
    start(async () => {
      const res = await toggleWishlist(productId);
      if (!res.ok && res.error === "SIGN_IN") router.push(`/signin?callbackUrl=${encodeURIComponent(location.pathname)}`);
      else if (res.ok) {
        setSaved(Boolean(res.saved));
        toast(res.saved ? tw("saved", { name }) : tw("removed"));
      }
    });

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <Price amount={unit * qty} compareAt={subscribing ? v.listPrice * qty : v.compareAtPrice ? v.compareAtPrice * qty : null} className={cn("font-display text-3xl", v.sale && !subscribing && "text-ember")} />
        <AnimatePresence mode="wait">
          {!soldOut && !v.preorder && v.available <= lowStock && (
            <motion.span key={v.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-xs text-ember">
              <span className="pulse-dot size-1.5 rounded-full bg-ember" aria-hidden />
              {t("onlyLeft", { count: v.available })}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <ConvertedNote className="mt-1" />
      {(v.sale && !subscribing) || v.preorder ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs" data-pdp-offer>
          {v.sale && !subscribing ? (
            <span className="inline-flex items-center gap-2 text-ember">
              <span className="bg-ember px-2 py-0.5 text-[0.625rem] uppercase tracking-[0.2em] text-bg">{v.sale.name}</span>
              <SaleCountdown endsAt={v.sale.endsAt} />
            </span>
          ) : null}
          {v.preorder ? <PreorderNote shipDate={v.preorder.shipDate} className="text-gold" /> : null}
        </div>
      ) : null}

      {variants.length > 1 && (
        <fieldset className="mt-8">
          <legend className="eyebrow mb-3 !text-muted">{t("size")}</legend>
          <div className="flex flex-wrap gap-2">
            {variants.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => {
                  setSelected(x.id);
                  setQty(1);
                }}
                aria-pressed={x.id === v.id}
                className={cn(
                  "press relative border px-5 py-3 text-sm transition-colors duration-500",
                  x.id === v.id ? "border-gold text-fg" : "border-line text-muted hover:border-line-strong",
                  x.available <= 0 && "text-subtle line-through",
                )}
              >
                {x.label}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {offerSubscribe && !soldOut && (
        <fieldset className="mt-8" data-subscribe-toggle>
          <legend className="eyebrow mb-3 !text-muted">{t("purchase")}</legend>
          <div className="grid gap-2">
            <label className={cn("flex cursor-pointer items-center justify-between gap-4 border px-5 py-4 transition-colors duration-500", mode === "once" ? "border-gold" : "border-line hover:border-line-strong")}>
              <span className="flex items-center gap-3 text-sm">
                <input type="radio" name="purchase-mode" checked={mode === "once"} onChange={() => setMode("once")} className="accent-[var(--gold)]" />
                {t("oneTime")}
              </span>
              <span className="text-sm tabular-nums text-muted">{money(v.price)}</span>
            </label>
            <div className={cn("border transition-colors duration-500", mode === "subscribe" ? "border-gold" : "border-line hover:border-line-strong")}>
              <label className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4">
                <span className="flex items-center gap-3 text-sm">
                  <input type="radio" name="purchase-mode" checked={mode === "subscribe"} onChange={() => setMode("subscribe")} className="accent-[var(--gold)]" />
                  <span>{offerSubscribe.discountPercent ? t("subscribeSavePercent", { percent: offerSubscribe.discountPercent }) : t("subscribeSave")}</span>
                </span>
                <span className="text-sm tabular-nums text-gold">{money(Math.round((v.listPrice * (100 - offerSubscribe.discountPercent)) / 100))}</span>
              </label>
              <AnimatePresence initial={false}>
                {mode === "subscribe" && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
                    <div className="px-5 pb-4">
                      <div className="flex flex-wrap gap-2" role="group" aria-label={t("deliverEvery")}>
                        {([1, 2, 3] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setEvery(m)}
                            aria-pressed={every === m}
                            className={cn("press border px-4 py-2 text-xs transition-colors", every === m ? "border-gold text-fg" : "border-line text-muted hover:border-line-strong")}
                          >
                            {t("everyMonths", { count: m })}
                          </button>
                        ))}
                      </div>
                      <p className="mt-3 text-xs text-subtle">{signedIn ? t("subscribeNote") : t("subscribeNoteSignIn")}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </fieldset>
      )}

      {soldOut ? (
        <form
          className="mt-8 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await notifyWhenBack(productId, email);
              if (res.ok) {
                toast(res.message);
                setAskedRestock(true);
              } else toast.error(res.error);
            });
          }}
        >
          <p className="text-sm text-muted">{t("soldOutBody")}</p>
          <div className="flex gap-3">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("emailPlaceholder")} aria-label={t("email")} className="h-12 flex-1 border-b border-line-strong bg-transparent text-sm focus:border-gold focus:outline-none" />
            <Button type="submit" disabled={pending} variant="outline">
              {t("notifyMe")}
            </Button>
          </div>
          {askedRestock && <PushOptIn context="stock" signedIn={signedIn} />}
        </form>
      ) : (
        <div ref={buyRow} className="mt-8 flex gap-3">
          <div className="flex items-center border border-line-strong">
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="press grid size-14 place-items-center hover:text-gold" aria-label={t("decrease")}>
              <Minus className="size-3.5" />
            </button>
            <span className="w-8 text-center tabular-nums" aria-live="polite">{qty}</span>
            <button type="button" onClick={() => setQty((q) => Math.min(Math.min(10, v.available), q + 1))} className="press grid size-14 place-items-center hover:text-gold" aria-label={t("increase")}>
              <Plus className="size-3.5" />
            </button>
          </div>
          <Magnetic strength={0.15} className="flex-1">
            <Button size="lg" className="w-full" onClick={(e) => add(e.currentTarget)} disabled={adding}>
              {adding ? t("adding") : v.preorder ? tp("preorder") : t("addToBag")}
            </Button>
          </Magnetic>
          <button type="button" onClick={wish} aria-label={saved ? t("wishlistRemove") : t("wishlistSave")} aria-pressed={saved} className="press grid size-14 place-items-center border border-line-strong transition-colors hover:border-gold">
            <Heart className={cn("size-4 transition-colors", saved ? "fill-gold text-gold" : "")} strokeWidth={1.2} />
          </button>
        </div>
      )}
      {!signedIn && <p className="mt-4 text-xs text-subtle">{t("signInEmbers")}</p>}
      {/* Stand-in for the flight when the stage is a live 3D canvas (canvases don't clone). */}
      <div ref={flyArt} aria-hidden className="pointer-events-none invisible fixed start-0 top-0 size-0 overflow-hidden">
        <div className="absolute inset-0">
          <Thumb visual={visual} />
        </div>
      </div>
      {mounted &&
        createPortal(
          <AnimatePresence>
            {showBar && !soldOut && (
              <motion.div
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-line bg-bg/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl md:hidden"
              >
                <span className="relative block h-12 w-10 shrink-0 overflow-hidden bg-bg-soft" aria-hidden>
                  <Thumb visual={visual} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-lg leading-tight">{name}</p>
                  <p className="text-xs text-muted">
                    {v.label} · {money(unit * qty)}
                  </p>
                </div>
                <Button size="md" className="shrink-0 px-5" onClick={(e) => add(e.currentTarget)} disabled={adding}>
                  {adding ? t("adding") : v.preorder ? tp("preorder") : t("addToBag")}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
