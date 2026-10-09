"use client";

import Link from "next/link";
import { useRef, ViewTransition, type PointerEvent } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { Eye, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Price } from "@/components/money";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { ProductArt } from "./product-art";
import { needsConfiguration, productHref } from "@/lib/product-href";
import { ProductPhoto, type ProductMedia } from "./product-photo";
import type { Model3D } from "@/generated/prisma/enums";
import { morphName, startMorph, useIsMorphing } from "@/lib/morph";
import { openQuickView } from "@/lib/quick-view";
import { useAddToBag } from "@/components/cart/add-to-bag";
import { useStoreConfig } from "@/components/store-config";

export type ProductCardView = {
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  model: Model3D;
  palette: string[];
  isBestseller: boolean;
  ratingAvg: number;
  ratingCount: number;
  category: { slug: string; name: string };
  variants: { id: string; label: string; price: number; compareAtPrice: number | null; stock: number; reserved: number }[];
  /** Optional photography; procedural art is used when empty. */
  images?: ProductMedia[];
};

const CARD_SIZES = "(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw";

/** Bag-ready image for toasts and the bag: cutouts float, photos keep their grade. */
export function cardImage(images?: ProductMedia[]) {
  const photo = images?.find((m) => m.type === "IMAGE");
  if (!photo) return null;
  return photo.cutoutUrl && photo.display !== "PHOTO" ? { src: photo.cutoutUrl, cutout: true } : { src: photo.url, cutout: false };
}

export function ProductCard({ product, index = 0, className }: { product: ProductCardView; index?: number; className?: string }) {
  const t = useTranslations("product");
  const { lowStock } = useStoreConfig();
  const { add, pending } = useAddToBag();
  const art = useRef<HTMLDivElement>(null);
  const morphing = useIsMorphing(product.slug);
  const first = product.variants[0];
  const firstAvailable = product.variants.find((v) => v.stock - v.reserved > 0);
  const soldOut = !firstAvailable;
  const left = product.variants.reduce((n, v) => n + Math.max(0, v.stock - v.reserved), 0);
  const isCoffret = product.slug === "build-your-coffret";
  const configurable = needsConfiguration(product.slug);
  const href = productHref(product.slug);
  const multi = product.variants.length > 1;
  const [cover, alt] = product.images ?? [];
  const scarce = !soldOut && !configurable && lowStock > 0 && left <= lowStock;

  // Gentle 3D tilt following the pointer (mouse/pen only; touch never sets these).
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-6, 6]), { stiffness: 150, damping: 18 });
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [5, -5]), { stiffness: 150, damping: 18 });
  const tilt = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  };
  const untilt = () => {
    px.set(0);
    py.set(0);
  };

  // Hand the image to the product page: only this card carries the shared view-transition name.
  const travel = () => {
    if (configurable) return;
    untilt();
    startMorph(product.slug, { model: product.model, palette: product.palette, cover, hasMedia: Boolean(product.images?.length) });
  };

  const quickAdd = () => {
    if (!firstAvailable) return;
    add({
      variantId: firstAvailable.id,
      source: art.current,
      item: { name: product.name, label: multi ? firstAvailable.label : undefined, model: product.model, palette: product.palette, image: cardImage(product.images) },
    });
  };

  return (
    <motion.article
      className={cn("group relative", className)}
      initial={{ opacity: 0, y: 50 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-5% 0px" }}
      transition={{ duration: 1.1, ease, delay: (index % 4) * 0.08 }}
    >
      <motion.div
        onPointerMove={tilt}
        onPointerLeave={untilt}
        style={{ rotateX, rotateY, transformPerspective: 900 }}
        className="sheen relative aspect-[4/5] overflow-hidden bg-bg-elev"
      >
        <Link href={href} onClick={travel} className="absolute inset-0" aria-label={product.name}>
          <ViewTransition name={morphing ? morphName(product.slug) : undefined} share="morph" default="none">
            <div ref={art} className="absolute inset-0 transition-transform duration-[1.6s] ease-luxe group-hover:scale-[1.06]">
              {cover ? (
                <>
                  {/* Second photo cross-fades with the cover on hover. */}
                  <div className={cn("absolute inset-0 transition-opacity duration-700", alt?.type === "IMAGE" && "group-hover:opacity-0")}>
                    <ProductPhoto item={cover} palette={product.palette} sizes={CARD_SIZES} />
                  </div>
                  {alt?.type === "IMAGE" && (
                    <div className="absolute inset-0 opacity-0 transition-opacity duration-700 group-hover:opacity-100">
                      <ProductPhoto item={alt} palette={product.palette} sizes={CARD_SIZES} />
                    </div>
                  )}
                </>
              ) : (
                <ProductArt model={product.model} palette={product.palette} />
              )}
            </div>
          </ViewTransition>
          <div className="absolute inset-x-0 top-0 z-[2] flex justify-between gap-3 p-4">
            <span className="min-w-0">
              <span className="block truncate text-[0.625rem] uppercase tracking-[0.24em] text-muted">{product.category.name}</span>
              {scarce && (
                <span className="mt-2 flex items-center gap-2 text-[0.5625rem] uppercase tracking-[0.2em] text-ember">
                  <span className="pulse-dot size-1.5 shrink-0 rounded-full bg-ember" aria-hidden />
                  <span className="truncate">{t("onlyLeft", { count: left })}</span>
                </span>
              )}
            </span>
            {soldOut ? (
              <span className="shrink-0 text-[0.625rem] uppercase tracking-[0.24em] text-ember">{t("soldOut")}</span>
            ) : product.isBestseller ? (
              <span className="shrink-0 text-[0.625rem] uppercase tracking-[0.24em] text-gold">{t("bestseller")}</span>
            ) : first?.compareAtPrice ? (
              <span className="shrink-0 text-[0.625rem] uppercase tracking-[0.24em] text-gold">{t("offer")}</span>
            ) : null}
          </div>
          <div className="pointer-events-none absolute inset-0 z-[2] border border-transparent transition-colors duration-700 group-hover:border-line-strong" />
        </Link>
        {!configurable && (
          <button
            type="button"
            onClick={() => openQuickView(product.slug)}
            aria-label={t("quickViewOf", { name: product.name })}
            aria-haspopup="dialog"
            className={cn(
              "press absolute z-[3] grid size-11 place-items-center rounded-full border border-line-strong bg-bg/70 text-fg backdrop-blur transition-[translate,scale,opacity,color,border-color] duration-500 ease-luxe hover:border-gold hover:text-gold",
              "bottom-4 end-[4.25rem] md:translate-y-3 md:opacity-0 md:group-hover:translate-y-0 md:group-hover:opacity-100 md:focus-visible:translate-y-0 md:focus-visible:opacity-100",
              soldOut && "end-4",
            )}
          >
            <Eye className="size-4" strokeWidth={1.2} />
          </button>
        )}
        {!soldOut && !configurable && (
          <button
            type="button"
            onClick={quickAdd}
            disabled={pending}
            aria-label={t("addNameToBag", { name: product.name })}
            className="press absolute bottom-4 end-4 z-[3] grid size-11 place-items-center rounded-full bg-gold text-bg transition-[translate,scale,opacity,background-color] duration-500 ease-luxe hover:bg-fg disabled:opacity-50 md:translate-y-3 md:opacity-0 md:group-hover:translate-y-0 md:group-hover:opacity-100 md:focus-visible:translate-y-0 md:focus-visible:opacity-100"
          >
            <Plus className={cn("size-4", pending && "animate-spin")} />
          </button>
        )}
      </motion.div>

      <div className="mt-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href={href} onClick={travel} className="font-display text-2xl leading-tight transition-colors hover:text-gold">
            {product.name}
          </Link>
          <p className="mt-1 truncate text-xs text-muted">{product.subtitle}</p>
        </div>
        <div className="shrink-0 text-end text-sm">
          {isCoffret ? (
            <span className="text-muted">{t("buildYourOwn")}</span>
          ) : first ? (
            <>
              {multi && <span className="block text-[0.625rem] uppercase tracking-[0.2em] text-subtle">{t("from")}</span>}
              <Price amount={first.price} compareAt={first.compareAtPrice} />
            </>
          ) : null}
        </div>
      </div>
      {product.ratingCount > 0 && (
        <p className="mt-2 text-xs text-subtle">
          <span className="text-gold">★</span> {product.ratingAvg.toFixed(1)} ({product.ratingCount})
        </p>
      )}
    </motion.article>
  );
}
