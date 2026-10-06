import type { Metadata } from "next";
import { Suspense } from "react";
import { getCategories, listProducts } from "@/server/catalog";
import { parseShopParams } from "@/server/search-params";
import { ShopFilters } from "@/components/product/filters";
import { ProductGrid } from "@/components/product/product-grid";
import { MaskedHeading } from "@/components/motion/reveal";

export const metadata: Metadata = {
  title: "Shop",
  description: "Incense, dhoop, candles, attars, bakhoor and gift sets — composed in small batches.",
};

export default async function ShopPage(props: PageProps<"/shop">) {
  const filters = parseShopParams(await props.searchParams);
  const [products, categories] = await Promise.all([listProducts(filters), getCategories()]);
  return (
    <div className="container-luxe">
      <header className="pb-16 pt-20 md:pt-28">
        <p className="eyebrow mb-6">{filters.q ? `Results for “${filters.q}”` : "The collection"}</p>
        <MaskedHeading as="h1" text={"Everything\nwe make"} italicLine={1} className="text-6xl md:text-9xl" />
      </header>
      <Suspense>
        <ShopFilters categories={categories} count={products.length} />
      </Suspense>
      <div className="pt-14">
        <ProductGrid products={products} />
      </div>
    </div>
  );
}
