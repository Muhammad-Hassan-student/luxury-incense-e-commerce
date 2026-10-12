"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { aiSummariseReviews } from "@/actions/ai";
import type { ReviewSummary } from "@/server/ai/admin";
import { Button } from "@/components/ui/button";
import { fmtDateTime } from "@/lib/admin-shared";
import { cn } from "@/lib/utils";
import { notify } from "../use-admin-action";

export type ReviewSummaryRow = {
  productId: string;
  name: string;
  published: number;
  cached: { summary: ReviewSummary; reviewCount: number; mock: boolean; model: string; updatedAt: string } | null;
};

const tone = { positive: "text-gold", mixed: "text-muted", negative: "text-ember" } as const;

function Summary({ s, meta, stale }: { s: ReviewSummary; meta: string; stale: boolean }) {
  return (
    <div className="mt-3 space-y-3 text-sm">
      <p className="text-fg/90">{s.overview}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="eyebrow !text-[0.5625rem]">Pros</p>
          <ul className="mt-1.5 space-y-1 text-muted">{s.pros.length ? s.pros.map((p, i) => <li key={i}>+ {p}</li>) : <li>—</li>}</ul>
        </div>
        <div>
          <p className="eyebrow !text-[0.5625rem] !text-ember">Cons</p>
          <ul className="mt-1.5 space-y-1 text-muted">{s.cons.length ? s.cons.map((p, i) => <li key={i}>− {p}</li>) : <li>—</li>}</ul>
        </div>
      </div>
      {s.themes.length ? (
        <ul className="flex flex-wrap gap-2" aria-label="Themes">
          {s.themes.map((t) => (
            <li key={t.theme} className={cn("border border-line px-2 py-1 text-xs", tone[t.sentiment])}>
              {t.theme} · {t.mentions}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-subtle">
        {meta}
        {stale ? " · new reviews since — refresh to include them" : ""}
      </p>
    </div>
  );
}

/** Per-product AI summaries of published reviews (cached; refresh regenerates). */
export function ReviewSummaries({ rows, canGenerate }: { rows: ReviewSummaryRow[]; canGenerate: boolean }) {
  const [data, setData] = useState(rows);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  function run(productId: string, refresh: boolean) {
    setBusy(productId);
    start(async () => {
      try {
        const r = await aiSummariseReviews({ productId, refresh });
        if (!r.ok) {
          notify.error(r.error);
          return;
        }
        setData((d) => d.map((x) => (x.productId === productId ? { ...x, cached: { summary: r.summary, reviewCount: r.reviewCount, mock: r.mock, model: r.model, updatedAt: r.updatedAt } } : x)));
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        notify.error("Couldn’t summarise right now.");
      } finally {
        setBusy(null);
      }
    });
  }

  if (!data.length) return <p className="px-5 py-4 text-sm text-muted">No published reviews yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {data.map((r) => (
        <li key={r.productId} className="px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-display text-lg text-fg">{r.name}</p>
            <span className="text-xs text-subtle">{r.published} published</span>
            {canGenerate ? (
              <Button type="button" size="sm" variant="outline" className="ms-auto" disabled={busy !== null} onClick={() => run(r.productId, Boolean(r.cached))}>
                {r.cached ? <RefreshCw className="size-3.5" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
                {busy === r.productId ? "Summarising…" : r.cached ? "Refresh" : "Summarise reviews"}
              </Button>
            ) : null}
          </div>
          {r.cached ? (
            <Summary
              s={r.cached.summary}
              stale={r.cached.reviewCount !== r.published}
              meta={`${r.cached.mock ? "Mock mode" : r.cached.model} · ${r.cached.reviewCount} reviews · ${fmtDateTime(r.cached.updatedAt)}`}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
