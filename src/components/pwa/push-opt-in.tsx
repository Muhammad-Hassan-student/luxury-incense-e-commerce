"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { currentSubscription, enablePush, pushSupport, store } from "./push-client";

/*
 * Contextual push opt-in, shown right after a meaningful action (asked to be told about a restock, placed an order).
 * Hidden when push can't work here, permission was refused, this device is already subscribed, or the customer
 * dismissed it before (per context).
 */
export function PushOptIn({ context, signedIn, className }: { context: "stock" | "order"; signedIn: boolean; className?: string }) {
  const t = useTranslations("pwa");
  const locale = useLocale();
  const key = `mo-push-ask-${context}`;
  const [state, setState] = useState<"hidden" | "ask" | "busy" | "on" | "error">("hidden");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!signedIn || store.get(key) === "dismissed" || pushSupport() !== "supported") return;
    let cancelled = false;
    void currentSubscription().then((sub) => {
      if (!cancelled && !sub) setState("ask");
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, key]);

  if (state === "hidden") return null;

  const allow = async () => {
    setState("busy");
    const r = await enablePush(locale);
    if (r.ok) {
      store.set(key, "enabled");
      setState("on");
      return;
    }
    setError(r.reason === "denied" ? t("blocked") : r.reason === "signin" ? t("signIn") : r.reason === "unsupported" ? t("unsupported") : t("failed"));
    setState("error");
  };

  return (
    <div className={`border border-line bg-bg-elev p-4 ${className ?? ""}`} role="status" data-push-opt-in={context}>
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden strokeWidth={1.3} />
        <div className="min-w-0 flex-1">
          {state === "on" ? (
            <p className="text-sm text-fg">{t("enabled")}</p>
          ) : (
            <>
              <p className="text-sm text-fg">{context === "stock" ? t("pushStockTitle") : t("pushOrderTitle")}</p>
              <p className="mt-1 text-sm text-muted">{context === "stock" ? t("pushStockBody") : t("pushOrderBody")}</p>
              {state === "error" ? <p className="mt-2 text-xs text-ember">{error}</p> : null}
              <div className="mt-3 flex flex-wrap gap-3">
                <Button type="button" size="sm" onClick={allow} disabled={state === "busy"}>
                  {state === "busy" ? t("enabling") : t("allow")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    store.set(key, "dismissed");
                    setState("hidden");
                  }}
                >
                  {t("notNow")}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
