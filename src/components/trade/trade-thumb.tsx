"use client";

import type { Model3D } from "@/generated/prisma/enums";
import { ProductArt } from "@/components/product/product-art";
import { ProductPhoto, type ProductMedia } from "@/components/product/product-photo";
import { cn } from "@/lib/utils";

/** Product imagery for trade screens: the store's own photo treatment, or its procedural art when there is no photo. */
export function TradeThumb({
  media,
  model,
  palette,
  size = "thumb",
  sizes,
  className,
}: {
  media: ProductMedia | null;
  model: Model3D;
  palette: string[];
  size?: "thumb" | "full";
  sizes: string;
  className?: string;
}) {
  return (
    <div className={cn("group relative overflow-hidden bg-bg-soft", className)}>
      {media ? <ProductPhoto item={media} palette={palette} sizes={sizes} size={size} /> : <ProductArt model={model} palette={palette} animated={size === "full"} className="absolute inset-0" />}
    </div>
  );
}
