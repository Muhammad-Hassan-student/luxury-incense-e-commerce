"use client";

import Link from "next/link";
import { useTransition, type PointerEvent } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { addToCart } from "@/actions/cart";
import { Price } from "@/components/money";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useUI } from "@/store/ui";
import { ProductArt } from "./product-art";
import { needsConfiguration, productHref } from "@/lib/product-href";
import { ProductPhoto, type ProductMedia } from "./product-photo";
import type { Model3D } from "@/generated/prisma/enums";

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

export function ProductCard({ product, index = 0, className }: { product: ProductCardView; index?: number; className?: string }) {
  const [pending, start] = useTransition();
  const openCart = useUI((s) => s.open);
  const first = product.variants[0];
  const firstAvailable = product.variants.find((v) => v.stock - v.reserved > 0);
  const soldOut = !firstAvailable;
  const isCoffret = product.slug === "build-your-coffret";
  const configurable = needsConfiguration(product.slug);
  const href = productHref(product.slug);
  const multi = product.variants.length > 1;
  const [cover, alt] = product.images ?? [];

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

  const quickAdd = () =>
    start(async () => {
      if (!firstAvailable) return;
      const res = await addToCart(firstAvailable.id);
      if (res.ok) {
        toast(res.message);
        openCart("cart");
      } else toast.error(res.error);
    });

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
        className="relative aspect-[4/5] overflow-hidden bg-bg-elev"
      >
        <Link href={href} className="absolute inset-0" aria-label={product.name}>
          <div className="absolute inset-0 transition-transform duration-[1.6s] ease-luxe group-hover:scale-[1.06]">
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
          <div className="absolute inset-x-0 top-0 flex justify-between p-4">
            <span className="text-[0.625rem] uppercase tracking-[0.24em] text-muted">{product.category.name}</span>
            {soldOut ? (
              <span className="text-[0.625rem] uppercase tracking-[0.24em] text-ember">Sold out</span>
            ) : product.isBestseller ? (
              <span className="text-[0.625rem] uppercase tracking-[0.24em] text-gold">Bestseller</span>
            ) : first?.compareAtPrice ? (
              <span className="text-[0.625rem] uppercase tracking-[0.24em] text-gold">Offer</span>
            ) : null}
          </div>
          <div className="pointer-events-none absolute inset-0 border border-transparent transition-colors duration-700 group-hover:border-line-strong" />
        </Link>
        {!soldOut && !configurable && (
          <button
            onClick={quickAdd}
            disabled={pending}
            aria-label={`Add ${product.name} to bag`}
            className="absolute bottom-4 end-4 grid size-11 translate-y-3 place-items-center rounded-full bg-gold text-bg opacity-0 transition-all duration-500 ease-luxe hover:bg-fg focus-visible:translate-y-0 focus-visible:opacity-100 group-hover:translate-y-0 group-hover:opacity-100 disabled:opacity-50 max-md:translate-y-0 max-md:opacity-100"
          >
            <Plus className={cn("size-4", pending && "animate-spin")} />
          </button>
        )}
      </motion.div>

      <div className="mt-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href={href} className="font-display text-2xl leading-tight transition-colors hover:text-gold">
            {product.name}
          </Link>
          <p className="mt-1 truncate text-xs text-muted">{product.subtitle}</p>
        </div>
        <div className="shrink-0 text-end text-sm">
          {isCoffret ? (
            <span className="text-muted">Build your own</span>
          ) : first ? (
            <>
              {multi && <span className="block text-[0.625rem] uppercase tracking-[0.2em] text-subtle">From</span>}
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
