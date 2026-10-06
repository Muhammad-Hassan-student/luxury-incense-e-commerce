"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef, type ReactNode } from "react";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Fades and lifts children in once they enter the viewport. */
export function Reveal({ children, delay = 0, y = 40, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={{ duration: 1.1, ease, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Heading whose lines rise from behind a mask. Split on "\n". */
export function MaskedHeading({ text, className, as: Tag = "h2", italicLine }: { text: string; className?: string; as?: "h1" | "h2" | "h3"; italicLine?: number }) {
  const MotionTag = motion[Tag];
  return (
    <MotionTag className={cn("display", className)} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-10% 0px" }}>
      {text.split("\n").map((line, i) => (
        <span key={i} className="block overflow-hidden pb-[0.08em]">
          <motion.span
            className={cn("block", italicLine === i && "italic text-gold")}
            variants={{ hidden: { y: "110%" }, show: { y: "0%", transition: { duration: 1.3, ease, delay: i * 0.1 } } }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </MotionTag>
  );
}

/** Moves children at a different speed to the page for depth. */
export function Parallax({ children, speed = 0.15, className }: { children: ReactNode; speed?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [`${speed * 100}%`, `${-speed * 100}%`]);
  return (
    <div ref={ref} className={cn("overflow-hidden", className)}>
      <motion.div style={{ y }} className="h-full w-full">
        {children}
      </motion.div>
    </div>
  );
}

export function Marquee({ items, className }: { items: string[]; className?: string }) {
  const row = [...items, ...items];
  return (
    <div className={cn("overflow-hidden border-y border-line py-6", className)} aria-hidden>
      <div className="flex w-max animate-marquee gap-16 whitespace-nowrap rtl:[animation-direction:reverse]">
        {row.map((t, i) => (
          <span key={i} className="flex items-center gap-16 font-display text-3xl italic text-muted md:text-5xl">
            {t}
            <span className="size-1.5 rounded-full bg-gold" />
          </span>
        ))}
      </div>
    </div>
  );
}
