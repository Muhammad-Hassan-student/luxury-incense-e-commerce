"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Re-renders the dashboard's server components every `every` ms while the tab is visible (router.refresh keeps
 * client state). Hidden tabs don't poll; coming back to a stale tab refreshes once straight away.
 */
export function AutoRefresh({ every = 60_000, updatedLabel }: { every?: number; updatedLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const last = useRef(0);

  useEffect(() => {
    last.current = Date.now();
  }, [updatedLabel]);

  useEffect(() => {
    const refresh = () => {
      last.current = Date.now();
      start(() => router.refresh());
    };
    const tick = () => {
      if (document.visibilityState === "visible" && Date.now() - last.current >= every - 500) refresh();
    };
    const id = window.setInterval(tick, every);
    const onVisible = () => tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [every, router]);

  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted" aria-live="polite">
      <span className="relative inline-flex size-2" aria-hidden>
        <span className={cn("absolute inline-flex size-full rounded-full bg-gold opacity-60", !pending && "animate-ping")} />
        <span className="relative inline-flex size-2 rounded-full bg-gold" />
      </span>
      {pending ? "Refreshing…" : `Live · updated ${updatedLabel}`}
    </span>
  );
}
