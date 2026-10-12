/** Shared by the hero (DOM) and its WebGL scene, kept free of three.js so the page bundle stays light. */

export const HERO_STATIONS = 4;

/**
 * Act 1 (0 → RISE_END): the signature shot — the camera climbs the incense smoke column while the headline drifts away.
 * Act 2 (SHOWCASE_START → SHOWCASE_END): from the top of the smoke it glides on to coil → perfume → oud.
 * The rest of the range lets the pinned frame scroll away. The section is 420svh, so the frame stays pinned until
 * 1 − 1/4.2 ≈ 0.76 — every station must sit before that.
 */
export const HERO_RISE_END = 0.3;
export const HERO_SHOWCASE_START = 0.32;
export const HERO_SHOWCASE_END = 0.72;

/** Captions for stations 2–4 (the headline covers the first); copy lives in the `hero` messages under each key. */
export const heroCaptions = [
  { n: "02", key: "coil" },
  { n: "03", key: "perfume" },
  { n: "04", key: "oud" },
] as const;

/** Scroll value (0..1) at which station `i` is centred. */
export const heroStationScroll = (i: number) =>
  HERO_SHOWCASE_START + (i / (HERO_STATIONS - 1)) * (HERO_SHOWCASE_END - HERO_SHOWCASE_START);
