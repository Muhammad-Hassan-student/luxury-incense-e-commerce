"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import { SmartVideo, type MediaItem } from "@/components/media";

export type ProductMedia = MediaItem & { cutoutUrl?: string | null; display?: "AUTO" | "CUTOUT" | "PHOTO" | null };

/** Which treatment a media item gets on the storefront. */
export function photoMode(item: ProductMedia): "cutout" | "photo" {
  if (item.type === "IMAGE" && item.cutoutUrl && item.display !== "PHOTO") return "cutout";
  return "photo";
}

const optimisable = (src: string) => (src.startsWith("/uploads/") || src.startsWith("https://res.cloudinary.com/")) && !src.includes("?");

/** #rrggbb + alpha → rgba() */
function tint(hex: string, a: number) {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  if (Number.isNaN(n)) return `rgba(200,164,106,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Product photography that belongs to the theme.
 * - Cutouts float on the same stage as the procedural art: palette glow, floor shadow, gentle lift on hover.
 * - Photos (busy backgrounds, videos) get a warm grade and an inner vignette in the theme's own colour,
 *   so their edges dissolve into the card instead of sitting on it as a hard rectangle.
 */
export function ProductPhoto({
  item,
  palette,
  sizes,
  priority,
  controls,
  size = "full",
  className,
}: {
  item: ProductMedia;
  palette: string[];
  sizes: string;
  priority?: boolean;
  controls?: boolean;
  /** "thumb" drops the glow/shadow and uses tighter padding */
  size?: "full" | "thumb";
  className?: string;
}) {
  const accent = palette[1] ?? "#c8a46a";

  if (photoMode(item) === "cutout") {
    const thumb = size === "thumb";
    return (
      <div className={cn("absolute inset-0", className)}>
        {!thumb && (
          <>
            <div aria-hidden className="absolute inset-0" style={{ background: `radial-gradient(55% 50% at 50% 58%, ${tint(accent, 0.3)} 0%, ${tint(accent, 0.06)} 60%, transparent 100%)` }} />
            <div aria-hidden className="absolute bottom-[11%] left-1/2 h-[5%] w-[58%] -translate-x-1/2 rounded-[50%] bg-[var(--photo-shadow)] blur-xl" />
          </>
        )}
        <div
          className={cn(
            "absolute transition-transform duration-[1.6s] ease-luxe",
            thumb ? "inset-[8%]" : "inset-x-[17%] bottom-[14%] top-[15%] group-hover:-translate-y-[2%]",
          )}
        >
          <Image
            src={item.cutoutUrl!}
            alt={item.alt}
            fill
            sizes={sizes}
            priority={priority}
            unoptimized={!optimisable(item.cutoutUrl!)}
            className={cn("object-contain", !thumb && "drop-shadow-[0_22px_28px_var(--photo-shadow)]")}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("absolute inset-0 overflow-hidden", className)}>
      {item.type === "VIDEO" ? (
        <SmartVideo src={item.url} poster={item.poster} controls={controls} label={item.alt} className="photo-grade absolute inset-0" />
      ) : (
        <Image src={item.url} alt={item.alt} fill sizes={sizes} priority={priority} unoptimized={!optimisable(item.url)} className="photo-grade object-cover" />
      )}
      {/* Edges fade into the surface the photo sits on (card / stage), in either theme. */}
      {!controls && size === "full" && <div aria-hidden className="photo-vignette pointer-events-none absolute inset-0" />}
    </div>
  );
}
