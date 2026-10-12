"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewAudienceAction, sendBroadcastAction, sendTestBroadcastAction } from "@/actions/admin-push";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { BROADCAST_SEGMENTS } from "@/lib/push-shared";
import { useAdminAction } from "./use-admin-action";

/** Broadcast composer: audience with live recipient count, a notification-shaped preview, test, then send. */
export function PushComposer() {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("/shop");
  const [segment, setSegment] = useState<string>("all");
  const [audience, setAudience] = useState<{ subscribers: number; eligible: number } | null>(null);
  const [counting, startCount] = useTransition();

  useEffect(() => {
    startCount(async () => {
      const r = await previewAudienceAction({ segment });
      setAudience(r.ok && "subscribers" in r ? { subscribers: r.subscribers ?? 0, eligible: r.eligible ?? 0 } : null);
    });
  }, [segment]);

  return (
    <div className="grid gap-8 p-5 lg:grid-cols-[1fr_22rem]">
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          const n = audience?.eligible ?? 0;
          if (!confirm(`Send “${title}” to ${n} customer${n === 1 ? "" : "s"}? This can’t be undone.`)) return;
          run(() => sendBroadcastAction({ title, body, url, segment, confirm: true }), {
            onSuccess: () => {
              setTitle("");
              setBody("");
              router.refresh();
            },
          });
        }}
      >
        <Field label="Audience" hint={counting ? "Counting…" : audience ? `${audience.subscribers} with notifications on · ${audience.eligible} will receive it (preferences, marketing opt-out and frequency caps applied)` : undefined}>
          <Select value={segment} onChange={(e) => setSegment(e.target.value)}>
            {BROADCAST_SEGMENTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title" hint={`${title.length}/80`}>
          <Input required maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Winter Oud is here" />
        </Field>
        <Field label="Message" hint={`${body.length}/200`}>
          <Textarea required maxLength={200} rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Forty bottles, aged three years. Early access for you until Sunday." />
        </Field>
        <Field label="Opens" hint="A page on this site, e.g. /product/winter-oud">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/shop" />
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button type="button" size="sm" variant="outline" disabled={pending || !title || !body} onClick={() => run(() => sendTestBroadcastAction({ title, body, url }))}>
            Send test to my devices
          </Button>
          <Button type="submit" size="sm" disabled={pending || !title || !body || !audience?.eligible}>
            Send broadcast
          </Button>
        </div>
      </form>

      <div>
        <p className="eyebrow mb-3">Preview</p>
        <div className="rounded-2xl border border-line-strong bg-bg-soft p-4 shadow-luxe" aria-label="Notification preview">
          <div className="flex gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" className="size-10 shrink-0 rounded-lg" />
            <div className="min-w-0">
              <p className="flex items-center justify-between gap-2 text-[0.625rem] uppercase tracking-[0.15em] text-subtle">
                <span>Maison Oud</span>
                <span>now</span>
              </p>
              <p className="mt-1 truncate text-sm font-medium text-fg">{title || "Notification title"}</p>
              <p className="line-clamp-3 text-sm text-muted">{body || "Your message appears here — keep it short and specific."}</p>
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-subtle">Exact look depends on the device. Opens {url || "/"} when tapped.</p>
      </div>
    </div>
  );
}
