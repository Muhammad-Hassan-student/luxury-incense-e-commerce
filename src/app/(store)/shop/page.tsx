import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { getCategories, listProducts } from "@/server/catalog";
import { parseShopParams } from "@/server/search-params";
import { ShopFilters } from "@/components/product/filters";
import { ProductGrid } from "@/components/product/product-grid";
import { MaskedHeading } from "@/components/motion/reveal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("shopTitle"), description: t("shopDescription") };
}

export default async function ShopPage(props: PageProps<"/shop">) {
  const filters = parseShopParams(await props.searchParams);
  const [t, products, categories] = await Promise.all([getTranslations("shop"), listProducts(filters), getCategories()]);
  return (
    <div className="container-luxe">
      <header className="pb-16 pt-20 md:pt-28">
        <p className="eyebrow mb-6">{filters.q ? t("resultsFor", { q: filters.q }) : t("eyebrow")}</p>
        <MaskedHeading as="h1" text={t("title")} italicLine={1} className="text-6xl md:text-9xl" />
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
