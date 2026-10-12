"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { BellOff, BellRing, Monitor, Smartphone } from "lucide-react";
import { removeMyDevice, saveNotificationPrefs, sendMyTestPush } from "@/actions/notifications";
import { Button } from "@/components/ui/button";
import type { NotificationPrefs, PrefField } from "@/lib/push-shared";
import { cn } from "@/lib/utils";
import { useClientValue } from "@/lib/use-client";
import { currentSubscription, disablePush, enablePush, pushSupport, type PushSupport } from "./push-client";

type Device = { id: string; endpoint: string; label: string; added: string };

const CHANNELS: { key: PrefField; label: "orders" | "backInStock" | "priceDrop" | "abandonedBag" | "news"; hint: "ordersHint" | "backInStockHint" | "priceDropHint" | "abandonedBagHint" | "newsHint" }[] = [
  { key: "orders", label: "orders", hint: "ordersHint" },
  { key: "backInStock", label: "backInStock", hint: "backInStockHint" },
  { key: "priceDrop", label: "priceDrop", hint: "priceDropHint" },
  { key: "abandonedBag", label: "abandonedBag", hint: "abandonedBagHint" },
  { key: "news", label: "news", hint: "newsHint" },
];

export function NotificationSettings({ prefs: initial, devices, enabled }: { prefs: NotificationPrefs; devices: Device[]; enabled: boolean }) {
  const t = useTranslations("notifications");
  const tp = useTranslations("pwa");
  const locale = useLocale();
  const router = useRouter();
  const [prefs, setPrefs] = useState(initial);
  const support = useClientValue<PushSupport | null>(pushSupport, null);
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    void currentSubscription().then((s) => setThisEndpoint(s?.endpoint ?? null));
  }, []);

  const onHere = Boolean(thisEndpoint && devices.some((d) => d.endpoint === thisEndpoint));

  const toggleDevice = async () => {
    setBusy(true);
    if (onHere) {
      await disablePush();
      setThisEndpoint(null);
    } else {
      const r = await enablePush(locale);
      if (!r.ok) toast.error(r.reason === "denied" ? tp("blocked") : r.reason === "ios-needs-install" ? tp("iosNeedsInstall") : r.reason === "unsupported" ? tp("unsupported") : tp("failed"));
      else setThisEndpoint((await currentSubscription())?.endpoint ?? null);
    }
    setBusy(false);
    router.refresh();
  };

  const setPref = (key: PrefField, value: boolean) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    start(async () => {
      const r = await saveNotificationPrefs({ [key]: value });
      if (r.ok) toast(t("saved"));
      else {
        toast.error(r.error);
        setPrefs((p) => ({ ...p, [key]: !value }));
      }
    });
  };

  return (
    <div className="space-y-12">
      <section className="space-y-4">
        <p className="eyebrow">{t("thisDevice")}</p>
        {!enabled ? (
          <p className="text-sm text-muted">{tp("unsupported")}</p>
        ) : support === "unsupported" || support === "denied" || support === "ios-needs-install" ? (
          <p className="text-sm text-muted">{support === "denied" ? tp("blocked") : support === "ios-needs-install" ? tp("iosNeedsInstall") : tp("unsupported")}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant={onHere ? "outline" : "primary"} size="sm" onClick={toggleDevice} disabled={busy || support === null}>
              {onHere ? <BellOff className="size-4" aria-hidden /> : <BellRing className="size-4" aria-hidden />}
              {onHere ? t("turnOff") : busy ? tp("enabling") : t("turnOn")}
            </Button>
            {devices.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  start(async () => {
                    const r = await sendMyTestPush();
                    if (r.ok) toast(r.message);
                    else toast.error(r.error);
                  })
                }
                disabled={pending}
              >
                {t("test")}
              </Button>
            )}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <p className="eyebrow">{t("channels")}</p>
        <ul className="divide-y divide-line border-y border-line">
          {CHANNELS.map((c) => (
            <li key={c.key} className="flex items-center justify-between gap-6 py-4">
              <div className="min-w-0">
                <p className="text-sm text-fg">{t(c.label)}</p>
                <p className="mt-1 text-xs text-muted">{t(c.hint)}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={prefs[c.key]}
                aria-label={t(c.label)}
                onClick={() => setPref(c.key, !prefs[c.key])}
                className={cn("relative h-6 w-11 shrink-0 rounded-full border transition-colors", prefs[c.key] ? "border-gold bg-gold/30" : "border-line-strong bg-transparent")}
              >
                <span className={cn("absolute top-0.5 size-4 rounded-full transition-all", prefs[c.key] ? "start-[1.4rem] bg-gold" : "start-0.5 bg-muted")} />
              </button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-subtle">{t("marketingNote")}</p>
      </section>

      <section className="space-y-4">
        <p className="eyebrow">{t("devices")}</p>
        {devices.length === 0 ? (
          <p className="text-sm text-muted">{t("noDevices")}</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  {/Mobile|Android|iPhone/i.test(d.label) ? <Smartphone className="size-4 shrink-0 text-muted" aria-hidden /> : <Monitor className="size-4 shrink-0 text-muted" aria-hidden />}
                  <div className="min-w-0">
                    <p className="truncate text-sm text-fg">
                      {d.label}
                      {d.endpoint === thisEndpoint ? <span className="ms-2 text-xs text-gold">· {t("thisDevice")}</span> : null}
                    </p>
                    <p className="text-xs text-subtle">{t("added", { date: d.added })}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="link-draw shrink-0 text-[0.6875rem] uppercase tracking-[0.2em] text-muted hover:text-fg"
                  onClick={() =>
                    start(async () => {
                      if (d.endpoint === thisEndpoint) await disablePush();
                      const r = await removeMyDevice(d.id);
                      if (!r.ok) toast.error(r.error);
                      router.refresh();
                    })
                  }
                >
                  {t("remove")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
