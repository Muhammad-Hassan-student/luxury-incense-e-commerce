"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotionPref } from "@/lib/use-client";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { brand } from "@/config/brand";
import { useUI } from "@/store/ui";

gsap.registerPlugin(useGSAP);

/**
 * Opening cinematic: the monogram draws itself, a counter tracks real readiness
 * (fonts + window load), then the curtain parts. Plays on every full page load / refresh;
 * client-side navigation keeps the store layout mounted, so it never replays between pages.
 */
export function IntroLoader({ enabled }: { enabled: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const setIntroDone = useUI((s) => s.setIntroDone);
  const reduce = useReducedMotionPref();
  const skip = !enabled || reduce;
  const [finished, setFinished] = useState(false);
  const show = !skip && !finished;
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (skip) setIntroDone();
  }, [skip, setIntroDone]);

  useGSAP(
    () => {
      if (!show || !root.current) return;
      const progress = { v: 0 };
      // Never hold the page hostage: proceed after 3.5s even if some asset is still loading.
      const ready = Promise.race([new Promise((r) => setTimeout(r, 3500)), Promise.all([
        document.fonts?.ready ?? Promise.resolve(),
        document.readyState === "complete" ? Promise.resolve() : new Promise((r) => window.addEventListener("load", r, { once: true })),
        new Promise((r) => setTimeout(r, 1600)),
      ])]);

      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
      tl.fromTo(".mo-stroke", { strokeDashoffset: 600 }, { strokeDashoffset: 0, duration: 2.2, ease: "power2.inOut", stagger: 0.15 }, 0)
        .fromTo(".mo-word", { yPercent: 110 }, { yPercent: 0, duration: 1.4, stagger: 0.06 }, 0.6)
        .to(progress, { v: 86, duration: 1.8, ease: "power1.out", onUpdate: () => setCount(Math.round(progress.v)) }, 0);

      ready.then(() => {
        gsap
          .timeline({
            defaults: { ease: "expo.inOut" },
            onComplete: () => setFinished(true),
          })
          .to(progress, { v: 100, duration: 0.6, ease: "power2.out", onUpdate: () => setCount(Math.round(progress.v)) })
          .to(".mo-inner", { opacity: 0, y: -30, duration: 0.8 }, "+=0.2")
          .add(() => setIntroDone(), "-=0.3")
          .to(".mo-curtain-top", { yPercent: -100, duration: 1.4 }, "<")
          .to(".mo-curtain-bottom", { yPercent: 100, duration: 1.4 }, "<");
      });
    },
    { scope: root, dependencies: [show] },
  );

  if (!show) return null;
  return (
    <div ref={root} className="fixed inset-0 z-[200]" aria-live="polite" aria-label="Loading">
      <div className="mo-curtain-top absolute inset-x-0 top-0 h-1/2 bg-bg" />
      <div className="mo-curtain-bottom absolute inset-x-0 bottom-0 h-1/2 bg-bg" />
      <div className="mo-inner absolute inset-0 flex flex-col items-center justify-center gap-8">
        <svg viewBox="0 0 120 160" className="h-36 w-28 text-gold" fill="none" stroke="currentColor" strokeWidth="0.8">
          {/* An arch window — the brand's architectural motif — with a rising wisp */}
          <path className="mo-stroke" strokeDasharray="600" d="M10 155 V60 A50 50 0 0 1 110 60 V155 Z" />
          <path className="mo-stroke" strokeDasharray="600" d="M60 150 V95" />
          <path className="mo-stroke" strokeDasharray="600" d="M60 95 C50 80 70 70 58 55 S66 35 56 22" />
        </svg>
        <div className="overflow-hidden">
          <p className="flex gap-[0.4em] font-display text-3xl tracking-[0.42em] md:text-4xl">
            {brand.name.toUpperCase().split(" ").map((w) => (
              <span key={w} className="mo-word inline-block">
                {w}
              </span>
            ))}
          </p>
        </div>
        <p className="eyebrow tabular-nums !text-muted">{String(count).padStart(3, "0")}</p>
      </div>
    </div>
  );
}
