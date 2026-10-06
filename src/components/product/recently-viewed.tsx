"use client";

import { useEffect, useState } from "react";
import { productCardsBySlugs } from "@/actions/engagement";
import { MaskedHeading } from "@/components/motion/reveal";
import { ProductCard, type ProductCardView } from "./product-card";

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

/** Records this product as viewed and shows the shopper's other recent pieces. Per-browser only. */
export function RecentlyViewed({ current }: { current: string }) {
  const [products, setProducts] = useState<ProductCardView[]>([]);

  useEffect(() => {
    const previous = read().filter((s) => s !== current);
    try {
      localStorage.setItem(KEY, JSON.stringify([current, ...previous].slice(0, MAX)));
    } catch {}
    if (!previous.length) return;
    let alive = true;
    productCardsBySlugs(previous.slice(0, 4)).then((p) => alive && setProducts(p));
    return () => {
      alive = false;
    };
  }, [current]);

  if (!products.length) return null;
  return (
    <section className="container-luxe pt-32">
      <MaskedHeading text="Recently viewed" className="mb-14 text-5xl md:text-6xl" />
      <div className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4">
        {products.map((p, i) => (
          <ProductCard key={p.id} product={p} index={i} />
        ))}
      </div>
    </section>
  );
}
