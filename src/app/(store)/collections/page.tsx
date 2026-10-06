import type { Metadata } from "next";
import Link from "next/link";
import { getCollections } from "@/server/catalog";
import { MaskedHeading, Reveal } from "@/components/motion/reveal";
import { ProductArt } from "@/components/product/product-art";
import { productHref } from "@/lib/product-href";

export const metadata: Metadata = { title: "Collections", description: "Curated edits for every hour and every mood." };

export default async function CollectionsPage() {
  const collections = await getCollections();
  return (
    <div className="container-luxe pt-20">
      <p className="eyebrow mb-6">Edits</p>
      <MaskedHeading as="h1" text={"Collections"} className="mb-24 text-7xl md:text-[9rem]" />
      <div className="space-y-32">
        {collections.map((c, i) => (
          <section key={c.id} className={`grid items-center gap-12 lg:grid-cols-2 ${i % 2 ? "lg:[&>*:first-child]:order-2" : ""}`}>
            <Link href={`/collections/${c.slug}`} className="group grid grid-cols-2 gap-3">
              {c.products.slice(0, 4).map(({ product }) => (
                <div key={product.id} className="aspect-[4/5] overflow-hidden bg-bg-elev">
                  <div className="h-full w-full transition-transform duration-[1.6s] ease-luxe group-hover:scale-105">
                    <ProductArt model={product.model} palette={product.palette} />
                  </div>
                </div>
              ))}
            </Link>
            <div>
              <Reveal><p className="font-display text-sm italic text-gold">0{i + 1}</p></Reveal>
              <MaskedHeading text={c.name} className="mt-4 text-5xl md:text-7xl" />
              <Reveal delay={0.1}><p className="mt-6 max-w-md text-muted">{c.description}</p></Reveal>
              <Reveal delay={0.2}>
                <ul className="mt-8 space-y-2 text-sm text-muted">
                  {c.products.map(({ product }) => (
                    <li key={product.id}>
                      <Link href={productHref(product.slug)} className="link-draw hover:text-fg">{product.name}</Link>
                    </li>
                  ))}
                </ul>
                <Link href={`/collections/${c.slug}`} className="link-draw eyebrow mt-10 inline-block">Shop the edit</Link>
              </Reveal>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
