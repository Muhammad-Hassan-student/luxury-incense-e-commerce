"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The fragrance pyramid: base notes settle first, the heart and the top rise above them as it scrolls in.
 * Each tier lines up with its notes; hovering (or focusing) a tier lights its band. Intensity fills in beneath.
 */
export function ScentProfile({
  top,
  heart,
  base,
  intensity,
  burnTime,
  origin,
}: {
  top: string[];
  heart: string[];
  base: string[];
  intensity: number;
  burnTime: string | null;
  origin: string | null;
}) {
  const t = useTranslations("product");
  const [active, setActive] = useState<number | null>(null);
  const tiers = [
    { key: "top", label: t("top"), notes: top, hint: t("topHint") },
    { key: "heart", label: t("heart"), notes: heart, hint: t("heartHint") },
    { key: "base", label: t("base"), notes: base, hint: t("baseHint") },
  ];
  const hasPyramid = tiers.some((x) => x.notes.length > 0);
  // Bands of the pyramid (viewBox 0 0 120 108): apex triangle, then two trapezoids.
  const bands = ["M60 2 L80 36 L40 36 Z", "M40 36 L80 36 L100 72 L20 72 Z", "M20 72 L100 72 L118 106 L2 106 Z"];
  const fills = [0.22, 0.42, 0.68];

  return (
    <section aria-labelledby="scent-profile" className="mt-12 border-y border-line py-8">
      <h2 id="scent-profile" className="eyebrow !text-subtle">
        {t("scentProfile")}
      </h2>

      {hasPyramid && (
        <motion.div
          className="mt-6 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-6 sm:grid-cols-[7.5rem_minmax(0,1fr)]"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-10% 0px" }}
        >
          <svg viewBox="0 0 120 108" preserveAspectRatio="none" className="h-full w-full overflow-visible" aria-hidden>
            {bands.map((d, i) => (
              <motion.path
                key={d}
                d={d}
                fill="var(--gold)"
                stroke="var(--gold)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
                variants={{
                  hidden: { opacity: 0, scaleY: 0.6, fillOpacity: 0 },
                  // Base first, then the heart, then the top note rising into the air.
                  show: { opacity: tiers[i].notes.length ? 1 : 0.3, scaleY: 1, fillOpacity: fills[i], transition: { duration: 0.9, ease, delay: (2 - i) * 0.18 } },
                }}
              />
            ))}
            {/* Hover/focus highlight sits on its own layer so it never fights the entrance animation. */}
            {bands.map((d, i) => (
              <path key={`hl-${d}`} d={d} fill="var(--fg)" className={cn("transition-opacity duration-300", active === i ? "opacity-25" : "opacity-0")} />
            ))}
          </svg>
          <ol className="grid auto-rows-fr">
            {tiers.map((x, i) => (
              <motion.li
                key={x.key}
                tabIndex={0}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className={cn("flex flex-col justify-center border-b border-line py-3 outline-offset-2 last:border-b-0", active !== null && active !== i && "opacity-60", "transition-opacity duration-300")}
                variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.8, ease, delay: 0.15 + (2 - i) * 0.18 } } }}
              >
                <p className="flex items-baseline gap-3">
                  <span className="eyebrow">{x.label}</span>
                  <span className="text-[0.625rem] text-subtle">{x.hint}</span>
                </p>
                <p className="mt-1 font-display text-lg leading-snug text-fg">{x.notes.length ? x.notes.join(", ") : "—"}</p>
              </motion.li>
            ))}
          </ol>
        </motion.div>
      )}

      <dl className={cn("grid grid-cols-3 gap-4 text-sm", hasPyramid && "mt-8 border-t border-line pt-6")}>
        <div>
          <dt className="eyebrow mb-2 !text-subtle">{t("intensity")}</dt>
          <dd>
            <motion.span
              className="flex gap-1"
              role="img"
              aria-label={t("intensityOf", { value: intensity })}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
            >
              {[1, 2, 3, 4, 5].map((i) => (
                <span key={i} className="relative h-1 w-4 overflow-hidden bg-line-strong">
                  {i <= intensity && (
                    <motion.span
                      className="absolute inset-0 origin-left bg-gold rtl:origin-right"
                      variants={{ hidden: { scaleX: 0 }, show: { scaleX: 1, transition: { duration: 0.5, ease, delay: 0.3 + i * 0.09 } } }}
                    />
                  )}
                </span>
              ))}
            </motion.span>
          </dd>
        </div>
        {burnTime && (
          <div>
            <dt className="eyebrow mb-2 !text-subtle">{t("burnTime")}</dt>
            <dd>{burnTime}</dd>
          </div>
        )}
        {origin && (
          <div>
            <dt className="eyebrow mb-2 !text-subtle">{t("origin")}</dt>
            <dd>{origin}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
