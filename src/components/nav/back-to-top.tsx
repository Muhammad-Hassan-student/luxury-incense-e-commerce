"use client";

import { useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "framer-motion";
import { ArrowUp } from "lucide-react";
import { useLenis } from "lenis/react";
import { useTranslations } from "next-intl";
import { ease, easeIn } from "@/lib/motion";

/** Appears after a screen or so of scrolling; its ring traces how far down the page you are. */
export function BackToTop() {
  const t = useTranslations("nav");
  const lenis = useLenis();
  const { scrollY, scrollYProgress } = useScroll();
  const [show, setShow] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setShow(y > window.innerHeight * 1.2));

  const toTop = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (lenis) lenis.scrollTo(0, { duration: reduce ? 0 : 1.4, immediate: reduce });
    else window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    // Keyboard users land back at the top of the document, not on a button that just disappeared.
    document.getElementById("main")?.focus({ preventScroll: true });
  };

  return (
    <div className="float-above-bar pointer-events-none fixed bottom-5 end-4 z-30 transition-transform duration-500 ease-luxe md:bottom-8 md:end-8">
      <AnimatePresence>
        {show && (
          <motion.button
            type="button"
            onClick={toTop}
            aria-label={t("backToTop")}
            className="press group pointer-events-auto relative grid size-12 place-items-center rounded-full border border-line bg-bg/80 text-fg shadow-luxe backdrop-blur-md transition-colors hover:text-gold"
            initial={{ opacity: 0, y: 16, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease } }}
            exit={{ opacity: 0, y: 12, scale: 0.9, transition: { duration: 0.25, ease: easeIn } }}
          >
            <svg viewBox="0 0 48 48" className="absolute inset-0 size-full -rotate-90" aria-hidden>
              <motion.circle cx="24" cy="24" r="23" fill="none" stroke="var(--gold)" strokeWidth="1" style={{ pathLength: scrollYProgress }} />
            </svg>
            <ArrowUp className="size-4 transition-transform duration-500 ease-luxe group-hover:-translate-y-0.5" strokeWidth={1.2} />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
