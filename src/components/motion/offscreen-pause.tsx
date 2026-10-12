"use client";

import { useEffect } from "react";

/**
 * Pauses CSS animations (ember flicker, breathing glow, smoke) inside product illustrations while they're off screen.
 * A long shop grid otherwise animates dozens of SVGs nobody can see, recalculating styles many times a second.
 * Visible ones are untouched, so nothing looks different; they resume the moment they scroll into view.
 *
 * One observer for the whole store: illustrations opt in with `data-anim` (ProductArt), new ones are picked up as
 * pages and grids render.
 */
export function OffscreenPause() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) e.target.toggleAttribute("data-offscreen", !e.isIntersecting);
      },
      { rootMargin: "200px" },
    );
    const seen = new WeakSet<Element>();
    const scan = () =>
      document.querySelectorAll("[data-anim]").forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        io.observe(el);
      });
    scan();
    // DOM changes come in bursts (React commits, animations): rescan at most every 300 ms.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const mo = new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        scan();
      }, 300);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      if (timer) clearTimeout(timer);
      mo.disconnect();
      io.disconnect();
    };
  }, []);
  return null;
}
