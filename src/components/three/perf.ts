"use client";

import { useEffect, useState, type RefObject } from "react";

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
