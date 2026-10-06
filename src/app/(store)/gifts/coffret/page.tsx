import type { Metadata } from "next";
import { available, getCoffretPieces } from "@/server/catalog";
import { CoffretBuilder } from "@/components/product/coffret-builder";

export const metadata: Metadata = { title: "Build your coffret", description: "Choose any four pieces; we wrap them by hand with your note. 10% off the set." };

export default async function CoffretPage() {
  const pieces = await getCoffretPieces();
  const options = pieces.flatMap((p) =>
    p.variants
      .filter((v) => available(v) > 0)
      .slice(0, 1)
      .map((v) => ({ variantId: v.id, productSlug: p.slug, name: p.name, label: v.label, price: v.price, model: p.model, palette: p.palette, category: p.category.name })),
  );
  return <CoffretBuilder options={options} />;
}
