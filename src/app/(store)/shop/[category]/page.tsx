import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getCategories, getCategory, listProducts } from "@/server/catalog";
import { parseShopParams } from "@/server/search-params";
import { ShopFilters } from "@/components/product/filters";
import { ProductGrid } from "@/components/product/product-grid";
import { MaskedHeading, Reveal } from "@/components/motion/reveal";
import { Ambient } from "@/components/category/ambient";

export async function generateMetadata(props: PageProps<"/shop/[category]">): Promise<Metadata> {
  const { category } = await props.params;
  const c = await getCategory(category);
  return c ? { title: c.name, description: c.description } : {};
}

export default async function CategoryPage(props: PageProps<"/shop/[category]">) {
  const { category: slug } = await props.params;
  const category = await getCategory(slug);
  if (!category) notFound();
  const filters = parseShopParams(await props.searchParams);
  const [products, categories] = await Promise.all([listProducts({ ...filters, category: slug }), getCategories()]);

  return (
    <>
      <section className="relative -mt-[calc(4.5rem+2rem)] h-[78svh] min-h-[34rem] overflow-hidden border-b border-line md:-mt-[calc(5rem+2rem)]">
        <div className="absolute inset-0">
          <Ambient kind={category.ambient} accent={category.accent} intensity={1.6} />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/30 to-transparent" />
        <div className="container-luxe relative flex h-full flex-col justify-end pb-16">
          <Reveal><p className="eyebrow mb-6">{category.tagline}</p></Reveal>
          <MaskedHeading as="h1" text={category.name} className="text-7xl md:text-[10rem]" />
          <Reveal delay={0.15}>
            <p className="mt-6 max-w-lg text-muted">{category.description}</p>
          </Reveal>
        </div>
      </section>
      <div className="container-luxe">
        <Suspense>
          <ShopFilters categories={categories} count={products.length} />
        </Suspense>
        <div className="pt-14">
          <ProductGrid products={products} />
        </div>
      </div>
    </>
  );
}
