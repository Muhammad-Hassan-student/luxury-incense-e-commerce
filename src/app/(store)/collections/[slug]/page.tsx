import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCollection } from "@/server/catalog";
import { MaskedHeading, Reveal } from "@/components/motion/reveal";
import { ProductGrid } from "@/components/product/product-grid";

export async function generateMetadata(props: PageProps<"/collections/[slug]">): Promise<Metadata> {
  const c = await getCollection((await props.params).slug);
  return c ? { title: c.name, description: c.description } : {};
}

export default async function CollectionPage(props: PageProps<"/collections/[slug]">) {
  const c = await getCollection((await props.params).slug);
  if (!c) notFound();
  return (
    <div className="container-luxe pt-20">
      <p className="eyebrow mb-6">Collection</p>
      <MaskedHeading as="h1" text={c.name} className="text-6xl md:text-9xl" />
      <Reveal delay={0.1}><p className="mb-20 mt-6 max-w-lg text-muted">{c.description}</p></Reveal>
      <ProductGrid products={c.products.map((p) => p.product)} />
    </div>
  );
}
