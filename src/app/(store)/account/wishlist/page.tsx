import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { db } from "@/server/db";
import { requireUser } from "@/server/roles";
import { productCardSelect } from "@/server/catalog";
import { localizeProducts } from "@/server/translations/localize";
import { ProductGrid } from "@/components/product/product-grid";

export default async function WishlistPage() {
  const user = await requireUser("/account/wishlist");
  const items = await db.wishlistItem.findMany({
    where: { userId: user.id, product: { isActive: true } },
    orderBy: { createdAt: "desc" },
    include: { product: { select: productCardSelect } },
  });
  if (!items.length) {
    const t = await getTranslations("wishlist");
    return (
      <p className="text-muted">
        {t.rich("empty", {
          link: (c) => (
            <Link href="/shop" className="link-draw text-gold">
              {c}
            </Link>
          ),
        })}
      </p>
    );
  }
  return <ProductGrid products={await localizeProducts(items.map((i) => i.product))} />;
}
