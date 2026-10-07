"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useReducedMotionPref, useTheme, useWebGL } from "@/lib/use-client";
import { motion, useMotionValueEvent, useScroll, useTransform } from "framer-motion";
import { ArrowDown } from "lucide-react";
import { useUI } from "@/store/ui";
import { ease } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { ProductArt } from "@/components/product/product-art";
import { Magnetic } from "@/components/motion/magnetic";
import { MediaImage, SmartVideo } from "@/components/media";

const HeroScene = dynamic(() => import("./hero-scene"), { ssr: false });

export type HeroData = {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  cta?: { label: string; href: string };
  /** Optional: a looping background film (takes the place of the 3D scene). */
  videoUrl?: string;
  /** Optional: still background, or the video's poster. */
  imageUrl?: string;
};

export function Hero({ data, threeD }: { data: HeroData; threeD: boolean }) {
  const section = useRef<HTMLElement>(null);
  const progress = useRef({ scroll: 0, pointerX: 0, pointerY: 0 });
  const introDone = useUI((s) => s.introDone);
  const reduce = useReducedMotionPref();
  const canGL = useWebGL();
  const webgl = threeD && canGL && !reduce;
  // Smoke reads darker on the light theme.
  const smokeColor = useTheme() === "ivoire" ? "#5a4a3a" : "#c9b79c";

  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end start"] });
  useMotionValueEvent(scrollYProgress, "change", (v) => (progress.current.scroll = v));
  const textY = useTransform(scrollYProgress, [0, 1], ["0%", "-40%"]);
  const textOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      progress.current.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
      progress.current.pointerY = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, []);

  const lines = (data.title ?? "").split("\n");
  return (
    <section ref={section} className="relative -mt-[calc(4.5rem+2rem)] h-[160svh] md:-mt-[calc(5rem+2rem)]">
      <div className="sticky top-0 h-svh overflow-hidden">
        <div className="absolute inset-0">
          {data.videoUrl ? (
            <SmartVideo src={data.videoUrl} poster={data.imageUrl} className="absolute inset-0" />
          ) : data.imageUrl ? (
            <MediaImage src={data.imageUrl} alt="" sizes="100vw" priority />
          ) : webgl ? (
            <motion.div className="h-full w-full" initial={{ opacity: 0 }} animate={{ opacity: introDone ? 1 : 0 }} transition={{ duration: 2.4, ease }}>
              <HeroScene progress={progress} smokeColor={smokeColor} />
            </motion.div>
          ) : (
            <div className="absolute inset-y-0 end-0 w-full opacity-60 md:w-1/2">
              <ProductArt model="INCENSE" palette={["#3A2A1E", "#C8A46A"]} />
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_30%_60%,transparent_20%,var(--bg)_85%)] opacity-70" />
        </div>

        <motion.div style={{ y: textY, opacity: textOpacity }} className="container-luxe relative z-10 flex h-full flex-col justify-end pb-[14vh]">
          <motion.p className="eyebrow mb-8" initial={{ opacity: 0, y: 10 }} animate={introDone ? { opacity: 1, y: 0 } : {}} transition={{ duration: 1.2, ease, delay: 0.2 }}>
            {data.eyebrow}
          </motion.p>
          <h1 className="display max-w-5xl text-[clamp(3.5rem,11vw,10.5rem)]">
            {lines.map((line, i) => (
              <span key={i} className="block overflow-hidden pb-[0.08em]">
                <motion.span
                  className={i === 1 ? "block italic text-gold" : "block"}
                  initial={{ y: "110%" }}
                  animate={introDone ? { y: "0%" } : {}}
                  transition={{ duration: 1.6, ease, delay: 0.35 + i * 0.12 }}
                >
                  {line}
                </motion.span>
              </span>
            ))}
          </h1>
          <motion.div
            className="mt-10 flex flex-col items-start gap-8 md:flex-row md:items-end md:justify-between"
            initial={{ opacity: 0 }}
            animate={introDone ? { opacity: 1 } : {}}
            transition={{ duration: 1.4, delay: 0.9 }}
          >
            <p className="max-w-sm text-sm leading-relaxed text-muted">{data.subtitle}</p>
            <div className="flex items-center gap-8">
              {data.cta && (
                <Magnetic>
                  <Button size="lg" asChild>
                    <Link href={data.cta.href}>{data.cta.label}</Link>
                  </Button>
                </Magnetic>
              )}
              <span className="hidden items-center gap-3 text-[0.625rem] uppercase tracking-[0.3em] text-subtle md:flex">
                <ArrowDown className="size-3 animate-bounce" /> Scroll
              </span>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
