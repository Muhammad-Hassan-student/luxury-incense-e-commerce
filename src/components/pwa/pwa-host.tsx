"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Share, SquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isIOS, isStandalone, store } from "./push-client";

/*
 * Registers the service worker, keeps <meta name="theme-color"> in step with the Nuit / Ivoire theme, and shows a
 * one-time "Install the app" card: never on the first visit, never on checkout / sign-in, once per device (dismiss
 * or install ends it for good). Chromium uses the native prompt; iOS Safari gets Add-to-Home-Screen instructions.
 */

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const VISITS = "mo-pwa-visits";
const STATE = "mo-pwa-install"; // shown | dismissed | installed
const QUIET_PATHS = ["/checkout", "/cart", "/signin", "/order", "/pay", "/account/security", "/track"];
const THEME_COLOR = { nuit: "#0b0a09", ivoire: "#f3ede4" } as const;

function syncThemeColor() {
  const theme = document.documentElement.dataset.theme === "ivoire" ? "ivoire" : "nuit";
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", THEME_COLOR[theme]));
}

export function PwaHost() {
  const t = useTranslations("pwa");
  const pathname = usePathname();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [mode, setMode] = useState<"hidden" | "native" | "ios">("hidden");

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }
    syncThemeColor();
    const obs = new MutationObserver(syncThemeColor);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // Count visits (one per browser session) — the card waits for a second visit.
    try {
      if (!sessionStorage.getItem("mo-pwa-session")) {
        sessionStorage.setItem("mo-pwa-session", "1");
        store.set(VISITS, String(Number(store.get(VISITS) ?? 0) + 1));
      }
    } catch {
      /* storage blocked: the card simply never shows */
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      store.set(STATE, "installed");
      setMode("hidden");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      obs.disconnect();
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const quiet = QUIET_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (mode !== "hidden" || quiet || isStandalone() || store.get(STATE)) return;
    const preview = new URLSearchParams(location.search).has("pwa-preview");
    if (Number(store.get(VISITS) ?? 0) < 2 && !preview) return;
    const ios = isIOS() && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
    if (!deferred && !ios && !preview) return;
    // Give the page a moment; never interrupt the first seconds of a visit.
    const timer = window.setTimeout(
      () => {
        store.set(STATE, "shown");
        setMode(deferred ? "native" : "ios");
      },
      preview ? 300 : 6000,
    );
    return () => window.clearTimeout(timer);
  }, [deferred, quiet, mode]);

  if (mode === "hidden" || quiet) return null;

  const dismiss = () => {
    store.set(STATE, "dismissed");
    setMode("hidden");
  };
  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    store.set(STATE, choice.outcome === "accepted" ? "installed" : "dismissed");
    setDeferred(null);
    setMode("hidden");
  };

  return (
    <aside
      role="dialog"
      aria-labelledby="pwa-install-title"
      className="fixed inset-x-4 bottom-4 z-[300] mx-auto max-w-md border border-line-strong bg-bg-elev p-5 shadow-luxe sm:inset-x-auto sm:start-6 sm:bottom-6 sm:mx-0 sm:w-[24rem]"
    >
      <button type="button" onClick={dismiss} aria-label={t("close")} className="absolute end-3 top-3 grid size-8 place-items-center text-muted hover:text-fg">
        <X className="size-4" />
      </button>
      <div className="flex gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" width={48} height={48} className="size-12 shrink-0" />
        <div className="min-w-0 pe-6">
          <p id="pwa-install-title" className="font-display text-xl leading-tight text-fg">
            {mode === "ios" ? t("iosTitle") : t("installTitle")}
          </p>
          {mode === "ios" ? (
            <ol className="mt-3 space-y-2 text-sm text-muted">
              <li className="flex items-center gap-2">
                <Share className="size-4 shrink-0 text-gold" aria-hidden /> {t("iosStep1")}
              </li>
              <li className="flex items-center gap-2">
                <SquarePlus className="size-4 shrink-0 text-gold" aria-hidden /> {t("iosStep2")}
              </li>
            </ol>
          ) : (
            <p className="mt-2 text-sm text-muted">{t("installBody")}</p>
          )}
        </div>
      </div>
      {mode === "native" ? (
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={dismiss}>
            {t("notNow")}
          </Button>
          <Button size="sm" onClick={install}>
            {t("install")}
          </Button>
        </div>
      ) : null}
    </aside>
  );
}
