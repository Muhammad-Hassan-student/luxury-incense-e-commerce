"use client";

import { useEffect, useState, ViewTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Box, Play } from "lucide-react";
import type { Model3D } from "@/generated/prisma/enums";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { MediaImage } from "@/components/media";
import { ProductPhoto, type ProductMedia } from "./product-photo";
import { ProductViewerLazy } from "@/components/three/lazy";
import { ProductArt } from "./product-art";
import { endMorph, morphName } from "@/lib/morph";

type Slide = { kind: "media"; item: ProductMedia } | { kind: "3d" };

/**
 * Product media stage. Photos/videos first (when the product has any), then the 3D model.
 * Without media this is just the 3D viewer, exactly as before.
 */
export function ProductGallery({ slug, name, model, palette, media, threeD }: { slug: string; name: string; model: Model3D; palette: string[]; media: ProductMedia[]; threeD: boolean }) {
  const slides: Slide[] = [...media.map((item) => ({ kind: "media" as const, item })), { kind: "3d" as const }];
  const [index, setIndex] = useState(0);
  // Once the morph into this stage has played, release the shared name (other rows may show this product).
  useEffect(() => {
    const id = setTimeout(() => endMorph(slug), 1200);
    return () => clearTimeout(id);
  }, [slug]);
  const [dir, setDir] = useState(1);
  const go = (next: number) => {
    const n = (next + slides.length) % slides.length;
    setDir(n > index ? 1 : -1);
    setIndex(n);
  };
  const current = slides[index];

  if (media.length === 0) {
    return (
      // Same name as the clicked card (and the skeleton): the card's art grows into this stage.
      <ViewTransition name={morphName(slug)} share="morph" default="none">
        <div data-pdp-stage className="relative h-full w-full overflow-hidden border border-line bg-bg-elev">
          <ProductViewerLazy model={model} palette={palette} enabled={threeD} />
          <span className="absolute bottom-4 start-4 text-[0.625rem] uppercase tracking-[0.3em] text-subtle">Drag to turn</span>
        </div>
      </ViewTransition>
    );
  }

  return (
    <div
      className="flex h-full flex-col gap-3"
      role="region"
      aria-roledescription="carousel"
      aria-label={`${name} gallery`}
      tabIndex={0}
      onKeyDown={(e) => {
        // Arrow keys follow reading direction (RTL: left is "next").
        const step = getComputedStyle(e.currentTarget).direction === "rtl" ? -1 : 1;
        if (e.key === "ArrowRight") go(index + step);
        if (e.key === "ArrowLeft") go(index - step);
      }}
    >
      <ViewTransition name={morphName(slug)} share="morph" default="none">
        <div data-pdp-stage className="relative min-h-0 flex-1 overflow-hidden border border-line bg-bg-elev">
          <AnimatePresence initial={false} custom={dir} mode="popLayout">
            <motion.div
              key={index}
              custom={dir}
              className="absolute inset-0"
              initial={{ opacity: 0, x: dir * 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -40 }}
              transition={{ duration: 0.7, ease }}
              // Swipe on touch; the 3D slide keeps its own drag-to-turn.
              drag={current.kind === "3d" ? false : "x"}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.2}
              onDragEnd={(_, info) => {
                if (info.offset.x < -60) go(index + 1);
                else if (info.offset.x > 60) go(index - 1);
              }}
            >
              {current.kind === "3d" ? (
                <>
                  <ProductViewerLazy model={model} palette={palette} enabled={threeD} />
                  <span className="absolute bottom-4 start-4 text-[0.625rem] uppercase tracking-[0.3em] text-subtle">Drag to turn</span>
                </>
              ) : (
                <ProductPhoto item={current.item} palette={palette} sizes="(min-width: 1024px) 58vw, 100vw" priority={index === 0} controls={current.item.type === "VIDEO"} />
              )}
            </motion.div>
          </AnimatePresence>

          <div className="absolute bottom-4 end-4 flex gap-2">
            <button type="button" onClick={() => go(index - 1)} aria-label="Previous" className="press grid size-10 place-items-center bg-bg/70 backdrop-blur transition-colors hover:text-gold">
              <ArrowLeft className="size-4 rtl:rotate-180" strokeWidth={1.2} />
            </button>
            <button type="button" onClick={() => go(index + 1)} aria-label="Next" className="press grid size-10 place-items-center bg-bg/70 backdrop-blur transition-colors hover:text-gold">
              <ArrowRight className="size-4 rtl:rotate-180" strokeWidth={1.2} />
            </button>
          </div>
          <p className="absolute start-4 top-4 text-[0.625rem] uppercase tracking-[0.3em] text-muted tabular-nums" aria-live="polite">
            {index + 1} / {slides.length}
          </p>
        </div>
      </ViewTransition>

      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {slides.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => go(i)}
            aria-label={s.kind === "3d" ? "3D view" : `${s.item.type === "VIDEO" ? "Video" : "Photo"} ${i + 1}`}
            aria-current={i === index}
            className={cn("relative h-20 w-16 shrink-0 overflow-hidden border bg-bg-soft transition-colors", i === index ? "border-gold" : "border-line hover:border-line-strong")}
          >
            {s.kind === "3d" ? (
              <>
                <ProductArt model={model} palette={palette} animated={false} />
                <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-bg/80 py-0.5 text-[0.5625rem] uppercase tracking-[0.2em] text-gold">
                  <Box className="size-3" /> 3D
                </span>
              </>
            ) : s.item.type === "VIDEO" ? (
              <>
                {s.item.poster ? <MediaImage src={s.item.poster} alt="" sizes="64px" /> : <span className="absolute inset-0 bg-bg-elev" />}
                <Play className="absolute inset-0 m-auto size-4 text-fg drop-shadow" />
              </>
            ) : (
              <ProductPhoto item={s.item} palette={palette} sizes="64px" size="thumb" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
