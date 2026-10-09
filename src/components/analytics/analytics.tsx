"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { clearTrackingQueue, markTrackingReady, readConsent, writeConsent } from "@/lib/analytics";
import { useClientValue } from "@/lib/use-client";

export type PixelConfig = { ga4MeasurementId: string; metaPixelId: string };

/** Footer link target that reopens the banner. */
export const COOKIE_PREFERENCES_HASH = "#cookie-preferences";

/**
 * Consent-aware loader for GA4 and Meta Pixel. Nothing (no script, no cookie) loads until the shopper accepts;
 * the choice is remembered for a year in a first-party cookie the server also reads at checkout.
 */
export function Analytics({ config }: { config: PixelConfig }) {
  const mounted = useClientValue(() => true, false);
  const initial = useClientValue(() => readConsent(), null);
  const [choice, setChoice] = useState<"granted" | "denied" | null | undefined>(undefined);
  const consent = choice === undefined ? initial : choice;
  const [reopened, setReopened] = useState(false);
  const pathname = usePathname();
  const inited = useRef(false);
  const ga = Boolean(config.ga4MeasurementId);
  const meta = Boolean(config.metaPixelId);

  // Reopen from the footer's "Cookie preferences" link.
  useEffect(() => {
    const check = () => {
      if (location.hash === COOKIE_PREFERENCES_HASH) {
        setReopened(true);
        history.replaceState(null, "", location.pathname + location.search);
      }
    };
    // Client-side links may use pushState (no hashchange), so catch the click itself too.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (a?.getAttribute("href")?.endsWith(COOKIE_PREFERENCES_HASH)) {
        e.preventDefault();
        setReopened(true);
      }
    };
    check();
    window.addEventListener("hashchange", check);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("hashchange", check);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  // Initialise the tag stubs once consent is granted; the libraries load via <Script> below.
  useEffect(() => {
    if (consent !== "granted" || inited.current) {
      if (consent === "denied") clearTrackingQueue();
      return;
    }
    inited.current = true;
    if (ga) {
      window.dataLayer = window.dataLayer || [];
      // gtag must push the `arguments` object itself.
      window.gtag = function gtag() {
        // eslint-disable-next-line prefer-rest-params
        window.dataLayer!.push(arguments);
      };
      window.gtag("consent", "default", { ad_storage: "granted", analytics_storage: "granted", ad_user_data: "granted", ad_personalization: "granted" });
      window.gtag("js", new Date());
      window.gtag("config", config.ga4MeasurementId);
    }
    if (meta && !window.fbq) {
      const q: unknown[] = [];
      const fbq = Object.assign(
        function fbq(...args: unknown[]) {
          const f = fbq as unknown as { callMethod?: (...a: unknown[]) => void };
          if (f.callMethod) f.callMethod(...args);
          else q.push(args);
        },
        { queue: q, loaded: true, version: "2.0", push: undefined as unknown },
      );
      fbq.push = fbq;
      window.fbq = fbq;
      (window as unknown as { _fbq?: unknown })._fbq = fbq;
      window.fbq("init", config.metaPixelId);
    }
    markTrackingReady({ ga, meta });
  }, [consent, ga, meta, config.ga4MeasurementId, config.metaPixelId]);

  // Meta needs a PageView per client-side navigation (GA4's enhanced measurement tracks history changes itself).
  useEffect(() => {
    if (consent === "granted" && meta && window.fbq) window.fbq("track", "PageView");
  }, [consent, meta, pathname]);

  const decide = (v: "granted" | "denied") => {
    const was = consent;
    writeConsent(v);
    setChoice(v);
    setReopened(false);
    // Withdrawing consent: reload so the already-running tags are gone.
    if (was === "granted" && v === "denied") location.reload();
  };

  const show = mounted && (consent === null || reopened);
  return (
    <>
      {consent === "granted" && ga && <Script id="ga4" src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.ga4MeasurementId)}`} strategy="afterInteractive" />}
      {consent === "granted" && meta && <Script id="meta-pixel" src="https://connect.facebook.net/en_US/fbevents.js" strategy="afterInteractive" />}
      <AnimatePresence>
        {show && (
          <motion.div
            role="dialog"
            aria-live="polite"
            aria-label="Cookie preferences"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-x-4 bottom-4 z-[300] max-w-md border border-line bg-bg-elev/95 p-5 text-fg shadow-2xl backdrop-blur-xl sm:inset-x-auto sm:start-6 sm:bottom-6"
            data-consent-banner
          >
            <p className="eyebrow mb-2">Cookies</p>
            <p className="text-sm leading-relaxed text-muted">
              With your permission we use analytics and advertising cookies (Google Analytics, Meta) to understand visits and measure our ads.
              Nothing is loaded unless you accept. <Link href="/privacy" className="link-draw text-fg">Privacy</Link>
            </p>
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={() => decide("denied")} className="press h-10 flex-1 border border-line-strong text-[0.6875rem] uppercase tracking-[0.24em] text-muted transition-colors hover:border-fg hover:text-fg">
                Decline
              </button>
              <button type="button" onClick={() => decide("granted")} className="press h-10 flex-1 bg-gold text-[0.6875rem] uppercase tracking-[0.24em] text-bg transition-opacity hover:opacity-90">
                Accept
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
