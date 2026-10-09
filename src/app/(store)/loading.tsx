"use client";

import { usePathname } from "next/navigation";
import { AccountSkeleton, BagSkeleton, CategorySkeleton, CollectionSkeleton, PageSkeleton, ProductSkeleton, ShopSkeleton } from "@/components/skeletons";

/**
 * One boundary for every top-level store section, so it picks the skeleton for where the shopper is going.
 * (Deeper loading files would also re-show on filter changes; here the shop keeps its old grid until the new one is ready.)
 */
export default function Loading() {
  const pathname = usePathname();
  const [, section, slug] = pathname.split("/");
  if (section === "product" && slug) return <ProductSkeleton slug={decodeURIComponent(slug)} />;
  if (section === "shop") return slug ? <CategorySkeleton /> : <ShopSkeleton />;
  if (section === "collections" && slug) return <CollectionSkeleton />;
  if (section === "account") return <AccountSkeleton />;
  if (section === "cart") return <BagSkeleton />;
  return <PageSkeleton />;
}
