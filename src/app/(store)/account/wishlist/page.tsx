import Link from "next/link";
import { db } from "@/server/db";
import { requireUser } from "@/server/roles";
import { productCardSelect } from "@/server/catalog";
import { ProductGrid } from "@/components/product/product-grid";

export default async function WishlistPage() {
  const user = await requireUser("/account/wishlist");
  const items = await db.wishlistItem.findMany({
    where: { userId: user.id, product: { isActive: true } },
    orderBy: { createdAt: "desc" },
    include: { product: { select: productCardSelect } },
  });
  if (!items.length) {
    return (
      <p className="text-muted">
        Nothing saved yet. Tap the heart on any piece to keep it here. <Link href="/shop" className="link-draw text-gold">Browse</Link>
      </p>
    );
  }
  return <ProductGrid products={items.map((i) => i.product)} />;
}
