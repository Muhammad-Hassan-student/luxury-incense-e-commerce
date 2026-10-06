"use client";

import { useEffect, type ReactNode } from "react";
import { ReactLenis, useLenis } from "lenis/react";
import { MotionConfig } from "framer-motion";
import { Toaster } from "sonner";
import { usePathname } from "next/navigation";
import type { Currency } from "@/config/brand";
import { CurrencyProvider } from "./money";
import { useUI } from "@/store/ui";

/** Stops smooth scroll while an overlay is open and resets scroll on navigation. */
function ScrollManager() {
  const lenis = useLenis();
  const panel = useUI((s) => s.panel);
  const close = useUI((s) => s.close);
  const pathname = usePathname();

  useEffect(() => {
    if (!lenis) return;
    if (panel) lenis.stop();
    else lenis.start();
  }, [panel, lenis]);

  useEffect(() => {
    close();
    lenis?.scrollTo(0, { immediate: true });
  }, [pathname, lenis, close]);

  return null;
}

export function Providers({ currency, children }: { currency: Currency; children: ReactNode }) {
  return (
    <ReactLenis root options={{ lerp: 0.09, smoothWheel: true, syncTouch: false }}>
      <MotionConfig reducedMotion="user">
        <CurrencyProvider currency={currency}>
          <ScrollManager />
          {children}
          <Toaster
            position="bottom-center"
            toastOptions={{
              unstyled: true,
              classNames: {
                toast: "flex items-center gap-3 border border-line-strong bg-bg-elev px-5 py-4 text-sm text-fg shadow-luxe min-w-72",
                error: "!border-ember/50",
              },
            }}
          />
        </CurrencyProvider>
      </MotionConfig>
    </ReactLenis>
  );
}
