"use client";

import { useState, useTransition } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { aiDraftJournal, aiSaveFeatures, aiSaveJournalDraft } from "@/actions/ai";
import type { AiFeatures } from "@/server/ai/config";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { notify, useAdminAction } from "../use-admin-action";

export function AiFeatureToggles({ initial, labels }: { initial: AiFeatures; labels: Record<keyof AiFeatures, string> }) {
  const [v, setV] = useState(initial);
  const { pending, run } = useAdminAction();
  const dirty = (Object.keys(v) as (keyof AiFeatures)[]).some((k) => v[k] !== initial[k]);
  return (
    <div className="space-y-4 p-5">
      <ul className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(labels) as (keyof AiFeatures)[]).map((k) => (
          <li key={k}>
            <label className="flex cursor-pointer items-center gap-3 text-sm text-fg">
              <input type="checkbox" className="size-4 accent-[var(--gold)]" checked={v[k]} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.checked }))} />
              {labels[k]}
            </label>
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Button type="button" size="sm" disabled={!dirty || pending} onClick={() => run(() => aiSaveFeatures(v))}>
          {pending ? "Saving…" : "Save features"}
        </Button>
      </div>
    </div>
  );
}

type Draft = { title: string; excerpt: string; body: string };

/** Brief → draft preview → admin edits → explicit "Save as draft" (unpublished). */
export function JournalDrafter() {
  const [brief, setBrief] = useState("");
  const [draft, setDraft] = useState<(Draft & { mock: boolean; note?: string; model: string }) | null>(null);
  const [writing, start] = useTransition();
  const save = useAdminAction();

  function write() {
    start(async () => {
      try {
        const r = await aiDraftJournal({ brief });
        if (!r.ok) {
          notify.error(r.error);
          return;
        }
        setDraft({ ...r.draft, mock: r.mock, note: r.note, model: r.model });
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        notify.error("Couldn’t reach the AI writer. Try again.");
      }
    });
  }

  return (
    <div className="space-y-5 p-5">
      <Field label="Brief" hint="Topic, angle, products to feature, length — e.g. “How to cleanse a home with guggal dhoop before Diwali; practical steps, safety, feature Guggal Dhoop.”">
        <Textarea value={brief} maxLength={2000} className="min-h-24" onChange={(e) => setBrief(e.target.value)} />
      </Field>
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" disabled={writing || brief.trim().length < 10} onClick={write}>
          <Sparkles className="size-3.5" aria-hidden />
          {writing ? "Drafting…" : "Draft a post"}
        </Button>
      </div>
      {draft ? (
        <section aria-label="Journal draft preview" className="space-y-4 border border-line bg-bg p-4">
          <p className="flex flex-wrap items-center gap-3 text-xs text-subtle">
            {draft.mock ? <span className="border border-line-strong px-1.5 py-0.5 uppercase tracking-[0.18em] text-gold">Mock mode</span> : <span>{draft.model}</span>}
            {draft.note ?? "Review and edit before saving. Saved drafts stay unpublished."}
          </p>
          <Field label="Title">
            <Input value={draft.title} maxLength={140} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="Excerpt">
            <Input value={draft.excerpt} maxLength={300} onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })} />
          </Field>
          <Field label="Body (markdown)">
            <Textarea value={draft.body} className="min-h-72 font-mono text-xs" onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </Field>
          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>
              <X className="size-3.5" aria-hidden /> Discard
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={save.pending}
              onClick={() => save.run(() => aiSaveJournalDraft({ title: draft.title, excerpt: draft.excerpt, body: draft.body }), { onSuccess: () => setDraft(null) })}
            >
              <Check className="size-3.5" aria-hidden /> {save.pending ? "Saving…" : "Save as unpublished draft"}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
