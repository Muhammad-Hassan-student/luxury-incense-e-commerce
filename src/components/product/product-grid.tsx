import { ProductCard, type ProductCardView } from "./product-card";

export function ProductGrid({ products, empty = "Nothing matches those filters yet." }: { products: ProductCardView[]; empty?: string }) {
  if (!products.length) {
    return <p className="py-32 text-center font-display text-3xl text-muted">{empty}</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-16 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {products.map((p, i) => (
        <ProductCard key={p.id} product={p} index={i} />
      ))}
    </div>
  );
}
