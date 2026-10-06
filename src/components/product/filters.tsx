"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils";

const families = ["WOODY", "ORIENTAL", "FLORAL", "FRESH", "SPICY", "RESINOUS", "GOURMAND"];
const moods = ["calm", "focus", "romance", "celebration", "meditation", "sleep", "cleansing", "energy"];
const sorts = [
  ["featured", "Featured"],
  ["new", "Newest"],
  ["price-asc", "Price: low to high"],
  ["price-desc", "Price: high to low"],
  ["rating", "Top rated"],
] as const;

export function ShopFilters({ categories, count }: { categories: { slug: string; name: string }[]; count: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value && next.get(key) !== value) next.set(key, value);
    else next.delete(key);
    start(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const chip = (active: boolean) =>
    cn(
      "whitespace-nowrap border px-3 py-1.5 text-[0.6875rem] uppercase tracking-[0.18em] transition-colors duration-500",
      active ? "border-gold text-gold" : "border-line text-muted hover:border-line-strong hover:text-fg",
    );

  const activeCategory = pathname.startsWith("/shop/") ? pathname.split("/")[2] : null;
  return (
    <div className={cn("sticky top-18 z-20 -mx-[clamp(1rem,4vw,3.5rem)] border-y border-line bg-bg/85 px-[clamp(1rem,4vw,3.5rem)] backdrop-blur-xl transition-opacity md:top-20", pending && "opacity-70")}>
      <div className="no-scrollbar flex items-center gap-2 overflow-x-auto py-4">
        <Link href={`/shop${params.size ? `?${params}` : ""}`} className={chip(!activeCategory)}>
          All
        </Link>
        {categories.map((c) => (
          <Link key={c.slug} href={`/shop/${c.slug}${params.size ? `?${params}` : ""}`} className={chip(activeCategory === c.slug)}>
            {c.name}
          </Link>
        ))}
        <span className="mx-2 h-5 w-px shrink-0 bg-line-strong" />
        {families.map((f) => (
          <button key={f} onClick={() => set("family", f)} className={chip(params.get("family") === f)}>
            {f.toLowerCase()}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line py-3">
        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto">
          <span className="eyebrow !text-subtle me-2">Mood</span>
          {moods.map((m) => (
            <button key={m} onClick={() => set("mood", m)} className={chip(params.get("mood") === m)}>
              {m}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-6">
          <span className="text-xs text-muted tabular-nums">{count} pieces</span>
          <label className="flex items-center gap-2 text-xs text-muted">
            Sort
            <select
              value={params.get("sort") ?? "featured"}
              onChange={(e) => set("sort", e.target.value === "featured" ? null : e.target.value)}
              className="cursor-pointer border-b border-line-strong bg-transparent py-1 text-fg focus:outline-none"
            >
              {sorts.map(([v, l]) => (
                <option key={v} value={v} className="bg-bg">
                  {l}
                </option>
              ))}
            </select>
          </label>
          {(params.get("family") || params.get("mood") || params.get("q")) && (
            <button onClick={() => start(() => router.push(pathname, { scroll: false }))} className="link-draw text-xs text-gold">
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
