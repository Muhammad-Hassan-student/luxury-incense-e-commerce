"use client";

import Link from "next/link";
import { ProductArt } from "@/components/product/product-art";
import { MediaImage } from "@/components/media";
import { Price } from "@/components/money";
import { productHref } from "@/lib/product-href";
import type { Model3D } from "@/generated/prisma/enums";

export type SuggestionView = {
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  model: Model3D;
  palette: string[];
  price: number;
  image: { src: string; cutout: boolean } | null;
};

/** Two quiet tiles under the bag lines — pairings for what's already in it. */
export function CartSuggestions({ items, title, onNavigate }: { items: SuggestionView[]; title: string; onNavigate: () => void }) {
  return (
    <section className="border-t border-line px-6 pt-5 pb-6" aria-label={title}>
      <p className="eyebrow mb-4 !text-muted">{title}</p>
      <ul className="grid grid-cols-2 gap-4">
        {items.slice(0, 2).map((p) => (
          <li key={p.id}>
            <Link href={productHref(p.slug)} onClick={onNavigate} className="group flex items-center gap-3">
              <span className="relative block h-16 w-12 shrink-0 overflow-hidden bg-bg-soft">
                {p.image ? (
                  <MediaImage src={p.image.src} alt="" sizes="48px" className={p.image.cutout ? "!object-contain p-1" : "photo-grade"} />
                ) : (
                  <ProductArt model={p.model} palette={p.palette} animated={false} />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-display text-base leading-tight transition-colors group-hover:text-gold">{p.name}</span>
                <Price amount={p.price} className="mt-1 block text-xs text-muted" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
