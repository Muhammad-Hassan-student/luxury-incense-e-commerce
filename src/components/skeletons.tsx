"use client";

import { ViewTransition } from "react";
import { cn } from "@/lib/utils";
import { morphName, morphVisual } from "@/lib/morph";
import { ProductArt } from "@/components/product/product-art";
import { ProductPhoto } from "@/components/product/product-photo";

/**
 * Route skeletons. Each mirrors its page's real grid (same containers, gaps and aspect ratios) so that
 * nothing moves when the content arrives; the swap itself is a soft cross-fade (reveal-* in globals.css).
 */

const Bar = ({ className }: { className?: string }) => <div className={cn("skeleton", className)} />;

function Shell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <ViewTransition exit="reveal-exit" default="none">
      <div className={className} aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading</span>
        {children}
      </div>
    </ViewTransition>
  );
}

function CardSkeleton() {
  return (
    <div>
      <Bar className="aspect-[4/5]" />
      <div className="mt-5 flex items-start justify-between gap-4">
        <div className="flex-1">
          <Bar className="h-7 w-2/3" />
          <Bar className="mt-2 h-3 w-1/2" />
        </div>
        <Bar className="h-4 w-14" />
      </div>
    </div>
  );
}

export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-16 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cn(i >= 2 && "max-sm:hidden", i >= 4 && "max-lg:hidden")}>
          <CardSkeleton />
        </div>
      ))}
    </div>
  );
}

function FiltersSkeleton() {
  return (
    <div className="-mx-[clamp(1rem,4vw,3.5rem)] border-y border-line px-[clamp(1rem,4vw,3.5rem)]">
      <div className="flex gap-2 overflow-hidden py-4">
        {Array.from({ length: 9 }, (_, i) => (
          <Bar key={i} className="h-[1.875rem] w-20 shrink-0" />
        ))}
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-line py-3">
        <Bar className="h-[1.875rem] w-64 max-w-[60%]" />
        <Bar className="h-4 w-32" />
      </div>
    </div>
  );
}

export function ShopSkeleton() {
  return (
    <Shell className="container-luxe">
      <header className="pb-16 pt-20 md:pt-28">
        <Bar className="mb-6 h-3 w-28" />
        <Bar className="h-[3.4rem] w-[min(36rem,80%)] md:h-[8.5rem]" />
        <Bar className="mt-2 h-[3.4rem] w-[min(28rem,60%)] md:h-[8.5rem]" />
      </header>
      <FiltersSkeleton />
      <div className="pt-14">
        <GridSkeleton />
      </div>
    </Shell>
  );
}

export function CategorySkeleton() {
  return (
    <Shell>
      <section className="relative -mt-[calc(4.5rem+2rem)] h-[78svh] min-h-[34rem] overflow-hidden border-b border-line md:-mt-[calc(5rem+2rem)]">
        <div className="skeleton absolute inset-0 opacity-60" />
        <div className="container-luxe relative flex h-full flex-col justify-end pb-16">
          <Bar className="mb-6 h-3 w-40" />
          <Bar className="h-20 w-[min(40rem,80%)] md:h-40" />
          <Bar className="mt-6 h-4 w-[min(28rem,70%)]" />
        </div>
      </section>
      <div className="container-luxe">
        <FiltersSkeleton />
        <div className="pt-14">
          <GridSkeleton />
        </div>
      </div>
    </Shell>
  );
}

export function CollectionSkeleton() {
  return (
    <Shell className="container-luxe pt-20">
      <Bar className="mb-6 h-3 w-24" />
      <Bar className="h-[3.4rem] w-[min(40rem,80%)] md:h-[8.5rem]" />
      <Bar className="mb-20 mt-6 h-4 w-[min(32rem,70%)]" />
      <GridSkeleton />
    </Shell>
  );
}

/** The product page: the gallery slot carries the clicked card's art so the morph lands on something real. */
export function ProductSkeleton({ slug }: { slug?: string }) {
  const visual = slug ? morphVisual(slug) : undefined;
  const stage = visual?.cover ? (
    <ProductPhoto item={visual.cover} palette={visual.palette} sizes="(min-width: 1024px) 58vw, 100vw" />
  ) : visual ? (
    <ProductArt model={visual.model} palette={visual.palette} />
  ) : (
    <div className="skeleton absolute inset-0" />
  );
  const named = (node: React.ReactNode) => (slug ? <ViewTransition name={morphName(slug)} share="morph" default="none">{node}</ViewTransition> : node);
  return (
    <div className="container-luxe grid gap-12 pt-8 lg:grid-cols-[7fr_5fr] lg:gap-20 [&>*]:min-w-0" aria-busy="true">
      <div className="lg:sticky lg:top-24 lg:h-[calc(100svh-10rem)]">
        <div className="relative h-[70svh] w-full lg:h-full">
          {visual?.hasMedia ? (
            <div className="flex h-full flex-col gap-3">
              {named(<div className="relative min-h-0 flex-1 overflow-hidden border border-line bg-bg-elev">{stage}</div>)}
              <div className="flex gap-2">
                {Array.from({ length: 3 }, (_, i) => (
                  <Bar key={i} className="h-20 w-16 shrink-0" />
                ))}
              </div>
            </div>
          ) : (
            named(<div className="relative h-full w-full overflow-hidden border border-line bg-bg-elev">{stage}</div>)
          )}
        </div>
      </div>
      <ViewTransition exit="reveal-exit" default="none">
        <div className="pb-16 lg:pt-12">
          <span className="sr-only">Loading</span>
          <Bar className="mb-8 h-3 w-32" />
          <Bar className="h-14 w-4/5 md:h-[4.5rem]" />
          <Bar className="mt-5 h-5 w-3/5" />
          <Bar className="mt-10 h-8 w-28" />
          <Bar className="mt-8 h-3 w-12" />
          <div className="mt-3 flex gap-2">
            <Bar className="h-12 w-28" />
            <Bar className="h-12 w-28" />
          </div>
          <div className="mt-8 flex gap-3">
            <Bar className="h-14 w-36" />
            <Bar className="h-14 flex-1" />
            <Bar className="size-14" />
          </div>
          <Bar className="mt-12 h-40 w-full opacity-60" />
        </div>
      </ViewTransition>
    </div>
  );
}

export function AccountSkeleton() {
  return (
    <Shell className="container-luxe pt-16">
      <div className="mb-14">
        <Bar className="mb-4 h-3 w-28" />
        <Bar className="h-12 w-72 max-w-full md:h-[4.5rem]" />
      </div>
      <div className="grid gap-12 lg:grid-cols-[14rem_1fr]">
        <div className="flex gap-3 overflow-hidden lg:flex-col">
          {Array.from({ length: 6 }, (_, i) => (
            <Bar key={i} className="h-4 w-24 shrink-0 lg:w-36" />
          ))}
        </div>
        <div className="space-y-6">
          <Bar className="h-40 w-full" />
          <Bar className="h-64 w-full opacity-70" />
        </div>
      </div>
    </Shell>
  );
}

export function BagSkeleton() {
  return (
    <Shell className="container-luxe pt-16">
      <Bar className="mb-16 h-14 w-64 md:h-24" />
      <div className="grid gap-16 lg:grid-cols-[1fr_26rem]">
        <div className="divide-y divide-line border-y border-line">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex gap-5 py-6">
              <Bar className="h-36 w-28 shrink-0" />
              <div className="flex-1 space-y-3">
                <Bar className="h-6 w-1/2" />
                <Bar className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
        <Bar className="h-96 w-full" />
      </div>
    </Shell>
  );
}

export function PageSkeleton() {
  return (
    <Shell className="container-luxe pt-20">
      <Bar className="h-4 w-32" />
      <Bar className="mt-8 h-24 w-3/4 max-w-2xl" />
      <div className="mt-20">
        <GridSkeleton count={4} />
      </div>
    </Shell>
  );
}
