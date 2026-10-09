"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { Model3D } from "@/generated/prisma/enums";
import { ProductArt } from "@/components/product/product-art";

const Viewer = dynamic(() => import("./product-viewer"), { ssr: false });

/**
 * Mounts the WebGL viewer only when near the viewport and when the device can handle it; the SVG
 * illustration stands in until then (and permanently without WebGL). With reduced motion the viewer
 * renders a single still pose on demand — smoke frozen, no drifting, no auto-rotate.
 */
export function ProductViewerLazy({
  model,
  palette,
  enabled = true,
}: {
  model: Model3D;
  palette: string[];
  enabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mount, setMount] = useState<false | "live" | "still">(false);

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
    if (!webgl) return;
    const io = new IntersectionObserver(
      ([e]) => e.isIntersecting && setMount(reduce ? "still" : "live"),
      { rootMargin: "200px" },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [enabled]);

  return (
    <div ref={ref} className="relative h-full w-full" data-cursor>
      {!mount && <ProductArt model={model} palette={palette} />}
      {mount && <Viewer model={model} palette={palette} still={mount === "still"} />}
    </div>
  );
}
