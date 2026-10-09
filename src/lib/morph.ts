"use client";

import { useSyncExternalStore } from "react";
import type { Model3D } from "@/generated/prisma/enums";
import type { ProductMedia } from "@/components/product/product-photo";

/**
 * Shared-element morph from a product card into the product page.
 *
 * Only the card the shopper actually clicked carries the view-transition name (two elements with the same
 * name would abort the transition, and a product can appear in several rows at once). The card also leaves
 * its visual here so the product skeleton can paint the same art instantly and complete the morph while
 * the page streams in.
 */
export type MorphVisual = { model: Model3D; palette: string[]; cover?: ProductMedia; hasMedia: boolean };

let active: string | null = null;
const visuals = new Map<string, MorphVisual>();
const listeners = new Set<() => void>();

export const morphName = (slug: string) => `product-${slug.replace(/[^a-z0-9-]/gi, "")}`;

export function startMorph(slug: string, visual: MorphVisual) {
  visuals.set(slug, visual);
  if (active === slug) return;
  active = slug;
  listeners.forEach((l) => l());
}

/** Let the product skeleton paint this product's art without claiming the shared name (e.g. from quick view). */
export function rememberVisual(slug: string, visual: MorphVisual) {
  visuals.set(slug, visual);
}

/** The destination has settled: release the name so no other card with this product keeps it. */
export function endMorph(slug: string) {
  if (active !== slug) return;
  active = null;
  listeners.forEach((l) => l());
}

export const morphVisual = (slug: string) => visuals.get(slug);

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** True for the one card currently travelling to its product page. */
export function useIsMorphing(slug: string) {
  return useSyncExternalStore(
    subscribe,
    () => active === slug,
    () => false,
  );
}
