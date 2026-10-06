"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import type { Ambient as AmbientKind } from "@/generated/prisma/enums";
import { Ambient } from "@/components/category/ambient";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function CategoryTile({
  slug,
  name,
  tagline,
  ambient,
  accent,
  index,
  className,
}: {
  slug: string;
  name: string;
  tagline: string;
  ambient: AmbientKind;
  accent: string;
  index: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 60 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={{ duration: 1.2, ease, delay: (index % 3) * 0.1 }}
      className={className}
    >
      <Link href={`/shop/${slug}`} className="group relative block h-full min-h-[22rem] overflow-hidden border border-line bg-bg-elev">
        <div className="absolute inset-0 opacity-70 transition-opacity duration-1000 group-hover:opacity-100">
          <Ambient kind={ambient} accent={accent} />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-transparent" />
        <span className="absolute start-6 top-6 font-display text-sm italic text-subtle">0{index + 1}</span>
        <ArrowUpRight className="absolute end-6 top-6 size-5 text-muted transition-all duration-700 ease-luxe group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-gold rtl:-scale-x-100" strokeWidth={1} />
        <div className="absolute inset-x-6 bottom-6">
          <p className="eyebrow mb-3 translate-y-2 opacity-0 transition-all duration-700 ease-luxe group-hover:translate-y-0 group-hover:opacity-100">{tagline}</p>
          <h3 className={cn("display text-5xl transition-colors duration-700 md:text-6xl")}>{name}</h3>
        </div>
      </Link>
    </motion.div>
  );
}
