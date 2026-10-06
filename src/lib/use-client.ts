"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** Reads a browser-only value without a hydration mismatch (server renders `serverValue`). */
export function useClientValue<T>(read: () => T, serverValue: T, subscribe: (cb: () => void) => () => void = noop) {
  return useSyncExternalStore(subscribe, read, () => serverValue);
}

const media = (q: string) => (cb: () => void) => {
  const m = window.matchMedia(q);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

export const useReducedMotionPref = () =>
  useClientValue(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, false, media("(prefers-reduced-motion: reduce)"));

export const useFinePointer = () =>
  useClientValue(() => window.matchMedia("(hover: hover) and (pointer: fine)").matches, false, media("(hover: hover) and (pointer: fine)"));

let webgl2: boolean | undefined;
export const useWebGL = () =>
  useClientValue(() => {
    if (webgl2 === undefined) {
      try {
        webgl2 = Boolean(document.createElement("canvas").getContext("webgl2"));
      } catch {
        webgl2 = false;
      }
    }
    return webgl2;
  }, false);

const subscribeTheme = (cb: () => void) => {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
};

export const useTheme = () =>
  useClientValue<"nuit" | "ivoire">(() => (document.documentElement.dataset.theme === "ivoire" ? "ivoire" : "nuit"), "nuit", subscribeTheme);

/** Deterministic PRNG so render-time particle layouts stay pure. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
