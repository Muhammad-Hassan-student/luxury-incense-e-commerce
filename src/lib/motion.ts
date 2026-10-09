/**
 * The storefront's motion vocabulary (CSS mirror: the "Motion system" block in app/globals.css).
 * One easing curve for the whole site — slow out, no overshoot.
 */
export const ease = [0.22, 1, 0.36, 1] as const;
export const easeInOut = [0.65, 0, 0.35, 1] as const;
export const easeIn = [0.4, 0, 1, 1] as const;
export const gsapEase = "expo.out";

/** Seconds. micro: press/toggle · fast: hovers, small UI · base: panels · slow: scroll reveals · cinematic: hero moments. */
export const dur = { micro: 0.16, fast: 0.32, quick: 0.45, panel: 0.6, base: 0.9, slow: 1.3, cinematic: 1.8 } as const;
export const stagger = 0.08;

/** Springs for things that follow the hand (drag, tilt, magnetic) — settled, never bouncy. */
export const spring = { stiffness: 260, damping: 30, mass: 0.8 } as const;

/** Panels (drawers, dialogs) enter on the luxe curve and leave a little faster. */
export const panelIn = { duration: dur.panel, ease } as const;
export const panelOut = { duration: dur.fast, ease: easeIn } as const;

export const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  show: { opacity: 1, y: 0, transition: { duration: dur.base, ease } },
};

export const staggerContainer = (delay = 0) => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren: delay } },
});
