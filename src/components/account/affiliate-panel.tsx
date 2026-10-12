"use client";

import { useEffect, useState, useTransition } from "react";
import { Copy, Share2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { joinAffiliateProgram, saveAffiliatePayoutDetails } from "@/actions/affiliate";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useClientValue } from "@/lib/use-client";

export function JoinAffiliateButton() {
  const t = useTranslations("affiliate");
  const [pending, start] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await joinAffiliateProgram();
          if (r.ok) toast(r.message ?? "");
          else toast.error(r.error);
        })
      }
    >
      {t("join")}
    </Button>
  );
}

/** Link / code with copy + native share. */
export function ShareBox({ label, value, share }: { label: string; value: string; share?: boolean }) {
  const t = useTranslations("affiliate");
  const [copied, setCopied] = useState(false);
  const canShare = useClientValue(() => "share" in navigator, false);
  return (
    <div className="min-w-0">
      <p className="eyebrow mb-2 !text-muted">{label}</p>
      <div className="flex min-w-0 items-center gap-3 border-b border-line-strong">
        <input readOnly value={value} aria-label={label} dir="ltr" className="h-11 min-w-0 flex-1 truncate bg-transparent font-mono text-sm text-fg focus:outline-none" onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              toast.error("Copy failed — select and copy instead.");
            }
          }}
          className="inline-flex shrink-0 items-center gap-2 text-[0.6875rem] uppercase tracking-[0.24em] text-gold"
        >
          <Copy className="size-3.5" aria-hidden /> {copied ? t("copied") : t("copy")}
        </button>
        {share && canShare ? (
          <button type="button" onClick={() => navigator.share({ title: "Maison Oud", text: t("shareText"), url: value }).catch(() => {})} className="inline-flex shrink-0 items-center gap-2 text-[0.6875rem] uppercase tracking-[0.24em] text-gold">
            <Share2 className="size-3.5" aria-hidden /> {t("share")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function PayoutDetailsForm({ initial }: { initial: string }) {
  const t = useTranslations("affiliate");
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-4 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveAffiliatePayoutDetails({ details: v });
          if (r.ok) toast(r.message ?? "");
          else toast.error(r.error);
        });
      }}
    >
      <Field label={t("payoutDetails")} className="min-w-0 flex-1">
        <Input value={v} onChange={(e) => setV(e.target.value)} maxLength={200} placeholder="name@upi" dir="auto" />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        {t("save")}
      </Button>
    </form>
  );
}

/** Tells the server this device/IP is the affiliate's own, so orders from it are flagged (never blocks anything). */
export function SelfDevicePing() {
  useEffect(() => {
    void fetch("/api/aff", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "self" }) }).catch(() => {});
  }, []);
  return null;
}
