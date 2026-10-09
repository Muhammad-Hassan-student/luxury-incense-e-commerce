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
  // In-page anchors (#reviews, skip link) glide too, stopping clear of the sticky header.
  return (
    <ReactLenis root options={{ lerp: 0.09, smoothWheel: true, syncTouch: false, anchors: { offset: -96 } }}>
      <MotionConfig reducedMotion="user">
        <CurrencyProvider currency={currency}>
          <ScrollManager />
          {children}
          <Toaster
            position="bottom-center"
            offset={24}
            mobileOffset={{ bottom: 16, left: 16, right: 16 }}
            gap={10}
            toastOptions={{
              unstyled: true,
              classNames: {
                toast: "flex w-full items-center gap-3 border border-line-strong bg-bg-elev/95 px-5 py-4 text-sm text-fg shadow-luxe backdrop-blur-md sm:min-w-80",
                error: "!border-ember/50",
              },
            }}
          />
        </CurrencyProvider>
      </MotionConfig>
    </ReactLenis>
  );
}
