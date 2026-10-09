"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { productCardsBySlugs } from "@/actions/engagement";
import { MaskedHeading } from "@/components/motion/reveal";
import { Price } from "@/components/money";
import { productHref } from "@/lib/product-href";
import { cn } from "@/lib/utils";
import { ProductCard, cardImage, type ProductCardView } from "./product-card";
import { ProductArt } from "./product-art";
import { MediaImage } from "@/components/media";

/** Per-browser only: slugs in localStorage, never sent anywhere except to look the cards up. */
const KEY = "mo-recent";
const MAX = 8;

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function record(slug: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([slug, ...read().filter((s) => s !== slug)].slice(0, MAX)));
  } catch {}
}

/** Cards for the shopper's recent pieces (optionally recording `current` first and leaving it out). */
function useRecent({ current, limit }: { current?: string; limit: number }) {
  const [products, setProducts] = useState<ProductCardView[]>([]);
  useEffect(() => {
    const previous = read().filter((s) => s !== current);
    if (current) record(current);
    if (!previous.length) return;
    let alive = true;
    productCardsBySlugs(previous.slice(0, limit))
      .then((p) => alive && setProducts(p))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [current, limit]);
  return products;
}

/** Product page: records this piece and shows the shopper's other recent ones. */
export function RecentlyViewed({ current }: { current: string }) {
  const t = useTranslations("product");
  const products = useRecent({ current, limit: 4 });
  if (!products.length) return null;
  return (
    <section className="container-luxe pt-32" aria-label={t("recentlyViewed")}>
      <MaskedHeading text={t("recentlyViewed")} className="mb-14 text-5xl md:text-6xl" />
      <div className="grid grid-cols-2 gap-x-4 gap-y-12 sm:gap-x-6 lg:grid-cols-4">
        {products.map((p, i) => (
          <ProductCard key={p.id} product={p} index={i} />
        ))}
      </div>
    </section>
  );
}

/** Compact strip for the bag (drawer and page) when it's empty: a way back to what they were looking at. */
export function RecentlyViewedStrip({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const t = useTranslations("product");
  const products = useRecent({ limit: 4 });
  if (!products.length) return null;
  return (
    <section className={cn("w-full text-start", className)} aria-label={t("recentlyViewed")}>
      <p className="eyebrow mb-4 !text-muted">{t("recentlyViewed")}</p>
      <ul className="grid grid-cols-2 gap-4">
        {products.map((p) => {
          const image = cardImage(p.images);
          const price = (p.variants.find((v) => v.stock - v.reserved > 0) ?? p.variants[0])?.price;
          return (
            <li key={p.id}>
              <Link href={productHref(p.slug)} onClick={onNavigate} className="group flex items-center gap-3">
                <span className="relative block h-16 w-12 shrink-0 overflow-hidden bg-bg-soft">
                  {image ? (
                    <MediaImage src={image.src} alt="" sizes="48px" className={image.cutout ? "!object-contain p-1" : "photo-grade"} />
                  ) : (
                    <ProductArt model={p.model} palette={p.palette} animated={false} />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-display text-base leading-tight transition-colors group-hover:text-gold">{p.name}</span>
                  {price != null && <Price amount={price} className="mt-1 block text-xs text-muted" />}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
