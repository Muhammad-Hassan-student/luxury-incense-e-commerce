"use client";

/**
 * "Fly to bag": a copy of the product image arcs from where it was added into the header's bag icon.
 * Three nested layers animate x, y and scale on separate curves (a natural toss), transform/opacity only.
 * Resolves when it lands (immediately with reduced motion or when either end is off-screen).
 */
export const BAG_INCOMING = "mo:bag-incoming";
export const BAG_BUMP = "mo:bag-bump";

function bagTarget(): HTMLElement | null {
  // Several bag buttons can exist (header, mobile); use the first one that is actually laid out.
  for (const el of document.querySelectorAll<HTMLElement>("[data-bag-target]")) {
    if (el.getClientRects().length) return el;
  }
  return null;
}

/**
 * @param source where the flight starts (its box)
 * @param art what flies (cloned); defaults to the source. Pass a stand-in when the source is a WebGL canvas.
 */
export function flyToBag(source: Element | null | undefined, art?: Element | null): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  // Ask the header to come back into view if it was tucked away while scrolling.
  window.dispatchEvent(new CustomEvent(BAG_INCOMING));
  const target = bagTarget();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!source || !target || reduce) return Promise.resolve();

  const s = source.getBoundingClientRect();
  const t = target.getBoundingClientRect();
  if (s.width === 0 || s.bottom < 0 || s.top > window.innerHeight) return Promise.resolve();
  // A hidden header is translated up by its own height; aim for where the icon is about to be.
  const header = target.closest("header");
  const lift = t.bottom < 0 && header ? header.getBoundingClientRect().height : 0;

  const size = Math.min(s.width, s.height, 220);
  const startX = s.left + s.width / 2 - size / 2;
  const startY = s.top + s.height / 2 - size / 2;
  const dx = t.left + t.width / 2 - (startX + size / 2);
  const dy = t.top + lift + t.height / 2 - (startY + size / 2);

  const outer = document.createElement("div");
  const middle = document.createElement("div");
  const inner = document.createElement("div");
  outer.setAttribute("aria-hidden", "true");
  Object.assign(outer.style, { position: "fixed", left: `${startX}px`, top: `${startY}px`, width: `${size}px`, height: `${size}px`, zIndex: "300", pointerEvents: "none" });
  Object.assign(middle.style, { width: "100%", height: "100%" });
  Object.assign(inner.style, {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    borderRadius: "50%",
    background: "var(--bg-elev)",
    boxShadow: "0 0 0 1px var(--gold), 0 18px 40px -12px rgba(0,0,0,0.6)",
  });
  const clone = (art ?? source).cloneNode(true) as HTMLElement;
  clone.hidden = false;
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  Object.assign(clone.style, { position: "absolute", inset: "0", width: "100%", height: "100%", transform: "none", visibility: "visible", viewTransitionName: "none" });
  inner.appendChild(clone);
  middle.appendChild(inner);
  outer.appendChild(middle);
  document.body.appendChild(outer);

  const duration = 820;
  const x = outer.animate([{ transform: "translateX(0)" }, { transform: `translateX(${dx}px)` }], { duration, easing: "cubic-bezier(0.3, 0, 0.25, 1)", fill: "forwards" });
  // Y dips a touch first, then rises into the bag: the "toss".
  middle.animate([{ transform: "translateY(0)" }, { transform: `translateY(${dy}px)` }], { duration, easing: "cubic-bezier(0.55, -0.35, 0.75, 0.9)", fill: "forwards" });
  inner.animate(
    [
      { transform: "scale(0.55)", opacity: 0 },
      { transform: "scale(0.62)", opacity: 1, offset: 0.12 },
      { transform: "scale(0.32)", opacity: 1, offset: 0.7 },
      { transform: `scale(${Math.max(12 / size, 0.04)})`, opacity: 0.2 },
    ],
    { duration, easing: "cubic-bezier(0.4, 0, 0.6, 1)", fill: "forwards" },
  );

  return new Promise((resolve) => {
    const done = () => {
      outer.remove();
      resolve();
    };
    x.finished.then(done, done);
  });
}

/** Tells the header to bump the bag icon. */
export function bumpBag() {
  window.dispatchEvent(new CustomEvent(BAG_BUMP));
}
