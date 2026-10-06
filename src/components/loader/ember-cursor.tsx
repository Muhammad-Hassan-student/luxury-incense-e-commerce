"use client";

import { useEffect, useState } from "react";
import { useFinePointer, useReducedMotionPref } from "@/lib/use-client";
import { motion, useMotionValue, useSpring } from "framer-motion";

/** A small ember with a lagging halo; the halo swells over links and buttons. Fine pointers only. */
export function EmberCursor({ enabled }: { enabled: boolean }) {
  const [hover, setHover] = useState(false);
  const [down, setDown] = useState(false);
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const hx = useSpring(x, { stiffness: 180, damping: 22, mass: 0.6 });
  const hy = useSpring(y, { stiffness: 180, damping: 22, mass: 0.6 });

  const fine = useFinePointer();
  const reduce = useReducedMotionPref();
  const active = enabled && fine && !reduce;

  useEffect(() => {
    if (!active) return;
    document.documentElement.classList.add("has-custom-cursor");

    const move = (e: PointerEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
      const t = e.target as HTMLElement | null;
      setHover(Boolean(t?.closest("a, button, [role=button], input, select, textarea, label, [data-cursor]")));
    };
    const pd = () => setDown(true);
    const pu = () => setDown(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", pd);
    window.addEventListener("pointerup", pu);
    return () => {
      document.documentElement.classList.remove("has-custom-cursor");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", pd);
      window.removeEventListener("pointerup", pu);
    };
  }, [active, x, y]);

  if (!active) return null;
  return (
    <>
      <motion.div
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[300] rounded-full border border-gold/60 mix-blend-difference"
        style={{ x: hx, y: hy, translateX: "-50%", translateY: "-50%" }}
        animate={{ width: hover ? 56 : 28, height: hover ? 56 : 28, opacity: hover ? 1 : 0.6, scale: down ? 0.8 : 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[300] size-1.5 rounded-full bg-ember-glow shadow-[0_0_12px_3px_var(--ember-glow)]"
        style={{ x, y, translateX: "-50%", translateY: "-50%" }}
      />
    </>
  );
}
