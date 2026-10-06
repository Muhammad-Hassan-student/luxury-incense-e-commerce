"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { Model3D } from "@/generated/prisma/enums";
import { ProductArt } from "@/components/product/product-art";

const Viewer = dynamic(() => import("./product-viewer"), { ssr: false });

/**
 * Mounts the WebGL viewer only when visible and when the device can handle it;
 * the SVG illustration stands in until then (and permanently with reduced motion / no WebGL).
 */
export function ProductViewerLazy({ model, palette, enabled = true }: { model: Model3D; palette: string[]; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mount, setMount] = useState(false);

  useEffect(() => {
    if (!enabled || !ref.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const webgl = (() => {
      try {
        return Boolean(document.createElement("canvas").getContext("webgl2"));
      } catch {
        return false;
      }
    })();
    if (reduce || !webgl) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setMount(true), { rootMargin: "200px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [enabled]);

  return (
    <div ref={ref} className="relative h-full w-full" data-cursor>
      {!mount && <ProductArt model={model} palette={palette} />}
      {mount && <Viewer model={model} palette={palette} />}
    </div>
  );
}
