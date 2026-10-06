"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useReducedMotionPref } from "@/lib/use-client";
import { cn } from "@/lib/utils";

/** Our own uploads and Cloudinary go through next/image; any other pasted host is shown as-is. */
const optimisable = (src: string) => (src.startsWith("/uploads/") || src.startsWith("https://res.cloudinary.com/")) && !src.includes("?");

export function MediaImage({ src, alt, sizes, priority, className }: { src: string; alt: string; sizes: string; priority?: boolean; className?: string }) {
  return <Image src={src} alt={alt} fill sizes={sizes} priority={priority} unoptimized={!optimisable(src)} className={cn("object-cover", className)} />;
}

function saveData() {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(c?.saveData);
}

/**
 * Ambient/product video: muted, inline, only downloads when near the viewport and only plays while visible.
 * With reduced motion or Save-Data it stays on the poster (and shows controls if `controls` is set).
 */
export function SmartVideo({ src, poster, className, controls = false, label }: { src: string; poster?: string | null; className?: string; controls?: boolean; label?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const reduce = useReducedMotionPref();
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const allowAuto = !reduce && !saveData();
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setNear(true);
        if (!allowAuto) return;
        if (e.intersectionRatio > 0.25) void el.play().catch(() => {});
        else el.pause();
      },
      { rootMargin: "200px", threshold: [0, 0.25, 0.6] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduce]);

  return (
    <video
      ref={ref}
      src={near ? src : undefined}
      poster={poster ?? undefined}
      muted
      loop
      playsInline
      preload="none"
      controls={controls}
      aria-label={label}
      className={cn("h-full w-full object-cover", className)}
    />
  );
}

export type MediaItem = { type: "IMAGE" | "VIDEO"; url: string; poster: string | null; alt: string };

/** Renders one media item filling its (relatively positioned) parent. */
export function MediaFill({ item, sizes, priority, controls, className }: { item: MediaItem; sizes: string; priority?: boolean; controls?: boolean; className?: string }) {
  if (item.type === "VIDEO") return <SmartVideo src={item.url} poster={item.poster} controls={controls} label={item.alt} className={cn("absolute inset-0", className)} />;
  return <MediaImage src={item.url} alt={item.alt} sizes={sizes} priority={priority} className={className} />;
}
