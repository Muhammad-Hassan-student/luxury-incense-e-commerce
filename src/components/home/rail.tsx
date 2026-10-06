"use client";

import { useRef } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { ProductCard, type ProductCardView } from "@/components/product/product-card";

/** Horizontal snap carousel with arrow controls; native touch scroll on mobile. */
export function ProductRail({ products }: { products: ProductCardView[] }) {
  const track = useRef<HTMLDivElement>(null);
  const scroll = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl" ? -1 : 1;
    el.scrollBy({ left: dir * rtl * el.clientWidth * 0.8, behavior: "smooth" });
  };
  return (
    <div>
      <div className="mb-8 flex justify-end gap-2">
        <button onClick={() => scroll(-1)} aria-label="Previous" className="grid size-11 place-items-center border border-line-strong transition-colors hover:border-gold hover:text-gold">
          <ArrowLeft className="size-4 rtl:rotate-180" strokeWidth={1.2} />
        </button>
        <button onClick={() => scroll(1)} aria-label="Next" className="grid size-11 place-items-center border border-line-strong transition-colors hover:border-gold hover:text-gold">
          <ArrowRight className="size-4 rtl:rotate-180" strokeWidth={1.2} />
        </button>
      </div>
      <div ref={track} className="no-scrollbar -mx-[clamp(1rem,4vw,3.5rem)] flex snap-x snap-mandatory gap-6 overflow-x-auto px-[clamp(1rem,4vw,3.5rem)] pb-4" data-lenis-prevent-horizontal>
        {products.map((p, i) => (
          <ProductCard key={p.id} product={p} index={i} className="w-[78vw] shrink-0 snap-start sm:w-[44vw] lg:w-[calc((100%-4.5rem)/4)]" />
        ))}
      </div>
    </div>
  );
}
