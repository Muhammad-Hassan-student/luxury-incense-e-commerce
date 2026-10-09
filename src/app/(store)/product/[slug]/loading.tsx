"use client";

import { useParams } from "next/navigation";
import { ProductSkeleton } from "@/components/skeletons";

/** Product → product navigation (pairings, recently viewed): the clicked card's art morphs into this slot. */
export default function ProductLoading() {
  const { slug } = useParams<{ slug: string }>();
  return <ProductSkeleton slug={slug ? decodeURIComponent(slug) : undefined} />;
}
