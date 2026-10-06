/** One easing curve for the whole site — slow out, no overshoot. */
export const ease = [0.22, 1, 0.36, 1] as const;
export const easeInOut = [0.65, 0, 0.35, 1] as const;
export const gsapEase = "expo.out";

export const dur = { fast: 0.6, base: 0.9, slow: 1.3, cinematic: 1.8 } as const;
export const stagger = 0.08;

export const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  show: { opacity: 1, y: 0, transition: { duration: dur.base, ease } },
};

export const staggerContainer = (delay = 0) => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren: delay } },
});
