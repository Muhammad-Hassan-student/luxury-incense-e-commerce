"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useReducedMotionPref, useTheme, useWebGL } from "@/lib/use-client";
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { ArrowDown } from "lucide-react";
import { useUI } from "@/store/ui";
import { ease } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { ProductArt } from "@/components/product/product-art";
import { Magnetic } from "@/components/motion/magnetic";
import { MediaImage, SmartVideo } from "@/components/media";
import { heroCaptions, heroStationScroll } from "./showcase";

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
  const webgl = threeD && canGL;
  // Smoke climb + showcase (incense → coil → perfume → oud) need a longer pinned section; reduced motion gets one still frame.
  const showcase = webgl && !reduce && !data.videoUrl && !data.imageUrl;
  // Smoke reads darker (and denser, see HeroScene) on the light theme.
  const light = useTheme() === "ivoire";
  const smokeColor = light ? "#4f4034" : "#c9b79c";

  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end start"] });
  useMotionValueEvent(scrollYProgress, "change", (v) => (progress.current.scroll = v));
  const textY = useTransform(scrollYProgress, [0, 1], ["0%", "-40%"]);
  // Ranges are fixed when the motion value is created, so pick the fade-out through a motion value instead.
  const fadeEnd = useMotionValue(0.6);
  // The headline drifts away during the smoke climb, about one screen of scrolling, as it always has.
  useEffect(() => fadeEnd.set(showcase ? 0.2 : 0.6), [fadeEnd, showcase]);
  const textOpacity = useTransform([scrollYProgress, fadeEnd], ([v, end]: number[]) =>
    Math.max(0, 1 - v / end),
  );

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
    <section
      ref={section}
      className={`relative -mt-[calc(4.5rem+2rem)] md:-mt-[calc(5rem+2rem)] ${showcase ? "h-[420svh]" : "h-[160svh]"}`}
    >
      <div className="sticky top-0 h-svh overflow-hidden">
        <div className="absolute inset-0">
          {data.videoUrl ? (
            <SmartVideo src={data.videoUrl} poster={data.imageUrl} className="absolute inset-0" />
          ) : data.imageUrl ? (
            <MediaImage src={data.imageUrl} alt="" sizes="100vw" priority />
          ) : webgl ? (
            <motion.div
              className="h-full w-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: introDone ? 1 : 0 }}
              transition={{ duration: 2.4, ease }}
            >
              <HeroScene progress={progress} smokeColor={smokeColor} still={reduce} light={light} />
            </motion.div>
          ) : (
            <div className="absolute inset-y-0 end-0 w-full opacity-60 md:w-1/2">
              <ProductArt model="INCENSE" palette={["#3A2A1E", "#C8A46A"]} />
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_30%_60%,transparent_20%,var(--bg)_85%)] opacity-70" />
        </div>

        <motion.div
          style={{ y: textY, opacity: textOpacity }}
          className="container-luxe relative z-10 flex h-full flex-col justify-end pb-[14vh]"
        >
          <motion.p
            className="eyebrow mb-8"
            initial={{ opacity: 0, y: 10 }}
            animate={introDone ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 1.2, ease, delay: 0.2 }}
          >
            {data.eyebrow}
          </motion.p>
          <h1 className="display max-w-5xl text-[clamp(3.5rem,11vw,10.5rem)]">
            {lines.map((line, i) => (
              <span key={i} className="block overflow-hidden pb-[0.08em]">
                <motion.span
                  className={i === 1 ? "text-gold block italic" : "block"}
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
            <p className="text-muted max-w-sm text-sm leading-relaxed">{data.subtitle}</p>
            <div className="flex items-center gap-8">
              {data.cta && (
                <Magnetic>
                  <Button size="lg" asChild>
                    <Link href={data.cta.href}>{data.cta.label}</Link>
                  </Button>
                </Magnetic>
              )}
              <span className="text-subtle hidden items-center gap-3 text-[0.625rem] tracking-[0.3em] uppercase md:flex">
                <ArrowDown className="size-3 animate-bounce" /> Scroll
              </span>
            </div>
          </motion.div>
        </motion.div>
        {showcase &&
          heroCaptions.map((c, i) => (
            <StationCaption
              key={c.title}
              progress={scrollYProgress}
              at={heroStationScroll(i + 1)}
              {...c}
            />
          ))}
      </div>
    </section>
  );
}

/** Quiet caption that rises in while the camera dwells on a showcase object. */
function StationCaption({
  progress,
  at,
  n,
  title,
  line,
}: {
  progress: MotionValue<number>;
  at: number;
  n: string;
  title: string;
  line: string;
}) {
  const opacity = useTransform(
    progress,
    // Stations are ~0.13 apart: windows of ±0.06 never overlap, so captions don't stack mid-transition.
    [at - 0.06, at - 0.025, at + 0.025, at + 0.06],
    [0, 1, 1, 0],
  );
  const y = useTransform(progress, [at - 0.06, at + 0.06], [24, -24]);
  return (
    <motion.div
      style={{ opacity, y }}
      className="container-luxe pointer-events-none absolute inset-x-0 bottom-[12vh] z-10"
      aria-hidden
    >
      <p className="eyebrow mb-4">{n}</p>
      <p className="display text-[clamp(2.25rem,6vw,5rem)]">{title}</p>
      <p className="text-muted mt-3 max-w-sm text-sm leading-relaxed">{line}</p>
    </motion.div>
  );
}
