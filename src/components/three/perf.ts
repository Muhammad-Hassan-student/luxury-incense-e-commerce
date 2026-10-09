"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/** Phones, small screens and low-core devices start on the cheaper tier (fewer particles, DPR 1). */
export function startsLow() {
  if (typeof window === "undefined") return false;
  const small = window.matchMedia("(max-width: 767px)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency ?? 8;
  return small || coarse || cores <= 4;
}

/** True while the element is (nearly) in view and the tab is visible — used to pause render loops. */
export function useOnScreen(ref: RefObject<HTMLElement | null>, rootMargin = "100px") {
  const [inView, setInView] = useState(true);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin });
    io.observe(el);
    const vis = () => setVisible(document.visibilityState === "visible");
    vis();
    document.addEventListener("visibilitychange", vis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", vis);
    };
  }, [ref, rootMargin]);
  return inView && visible;
}

/** Best render scale for this device: supersampled on desktops (crisper edges and smoke), 1 on the cheap tier. */
function topDpr() {
  if (typeof window === "undefined") return 1;
  return startsLow() ? 1 : Math.min(2, Math.max(1.5, window.devicePixelRatio));
}

/**
 * Render quality that adapts without getting stuck on low:
 * - the frame-rate monitor only starts after a warm-up, so the loader, page load and shader compiles
 *   don't count as "slow device";
 * - a drop first lowers resolution a step at a time; the cheap tier (fewer particles) needs repeated drops;
 * - when frames recover, resolution and detail come back.
 */
export function useAdaptiveQuality(warmupMs = 4000) {
  const [low, setLow] = useState(startsLow);
  const [dpr, setDpr] = useState(topDpr);
  const [armed, setArmed] = useState(false);
  const declines = useRef(0);
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), warmupMs);
    return () => clearTimeout(t);
  }, [warmupMs]);
  const monitor = {
    flipflops: 6,
    // drei's default (decline < 50, incline > 60) can never incline on a 60 Hz screen, so one stutter
    // would leave the scene blurry for good. Decline only on a real slowdown; recover near the refresh rate.
    bounds: (refreshrate: number) => [Math.min(40, refreshrate * 0.66), refreshrate * 0.95] as [number, number],
    onDecline: () => {
      declines.current += 1;
      setDpr((d) => Math.max(1, d - 0.25));
      if (declines.current >= 3) setLow(true);
    },
    onIncline: () => {
      declines.current = Math.max(0, declines.current - 1);
      setDpr((d) => Math.min(topDpr(), d + 0.25));
      if (declines.current === 0) setLow(startsLow());
    },
    onFallback: () => {
      setLow(true);
      setDpr(1);
    },
  };
  return { low, dpr, armed, monitor };
}
