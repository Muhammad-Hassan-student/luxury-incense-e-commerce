"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { aiDraftProductCopy, aiGetProductCopy, aiSaveProductCopy } from "@/actions/ai";
import type { ProductCopyKind, ProductFacts } from "@/server/ai/admin";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { wordDiff } from "@/lib/word-diff";
import { cn } from "@/lib/utils";
import { notify, useAdminAction } from "../use-admin-action";

type FormKey = "subtitle" | "story" | "topNotes" | "heartNotes" | "baseNotes" | "moods" | "timeOfDay";
type CopyKey = "seoTitle" | "seoDescription" | "nameAr" | "subtitleAr" | "storyAr";
type Row = { key: FormKey | CopyKey; label: string; before: string; after: string; long?: boolean; rtl?: boolean };

const KINDS: { kind: ProductCopyKind; label: string; hint: string }[] = [
  { kind: "description", label: "Description", hint: "Subtitle + story" },
  { kind: "notes", label: "Notes", hint: "Pyramid, moods, time of day" },
  { kind: "seo", label: "SEO", hint: "Title + meta description" },
  { kind: "arabic", label: "Arabic", hint: "Name, subtitle, story" },
];

const LABELS: Record<FormKey | CopyKey, string> = {
  subtitle: "Subtitle",
  story: "Story",
  topNotes: "Top notes",
  heartNotes: "Heart notes",
  baseNotes: "Base notes",
  moods: "Moods",
  timeOfDay: "Time of day",
  seoTitle: "SEO title",
  seoDescription: "Meta description",
  nameAr: "Name (Arabic)",
  subtitleAr: "Subtitle (Arabic)",
  storyAr: "Story (Arabic)",
};

const isFormKey = (k: string): k is FormKey => ["subtitle", "story", "topNotes", "heartNotes", "baseNotes", "moods", "timeOfDay"].includes(k);
const show = (v: unknown) => (Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : "");

function Diff({ before, after }: { before: string; after: string }) {
  const parts = wordDiff(before, after);
  return (
    <p className="whitespace-pre-line text-sm leading-relaxed">
      {parts.map((p, i) =>
        p.type === "same" ? (
          <span key={i} className="text-muted">
            {p.text}
          </span>
        ) : p.type === "add" ? (
          <ins key={i} className="bg-gold/15 text-fg no-underline">
            {p.text}
          </ins>
        ) : (
          <del key={i} className="text-ember/80">
            {p.text}
          </del>
        ),
      )}
    </p>
  );
}

/**
 * "Write with AI" on the product form. Drafts are previewed as a diff and must be accepted (or edited) by the admin;
 * accepted description/notes only fill the form (still needs "Save product"); SEO/Arabic have their own Save.
 */
export function ProductAiPanel({
  productId,
  facts,
  onApply,
}: {
  productId?: string;
  facts: ProductFacts;
  onApply: (patch: Partial<Record<FormKey, string>>) => void;
}) {
  const [pending, start] = useTransition();
  const save = useAdminAction();
  const [brief, setBrief] = useState("");
  const [busyKind, setBusyKind] = useState<ProductCopyKind | null>(null);
  const [preview, setPreview] = useState<{ kind: ProductCopyKind; rows: Row[]; mock: boolean; note?: string; model: string } | null>(null);
  const [copy, setCopy] = useState<Record<CopyKey, string>>({ seoTitle: "", seoDescription: "", nameAr: "", subtitleAr: "", storyAr: "" });
  const [copyDirty, setCopyDirty] = useState(false);

  useEffect(() => {
    if (!productId) return;
    let live = true;
    aiGetProductCopy(productId)
      .then((c) => {
        if (live && c) setCopy({ seoTitle: c.seoTitle ?? "", seoDescription: c.seoDescription ?? "", nameAr: c.nameAr ?? "", subtitleAr: c.subtitleAr ?? "", storyAr: c.storyAr ?? "" });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [productId]);

  const current: Record<FormKey | CopyKey, string> = {
    subtitle: facts.subtitle,
    story: facts.story,
    topNotes: facts.topNotes.join(", "),
    heartNotes: facts.heartNotes.join(", "),
    baseNotes: facts.baseNotes.join(", "),
    moods: facts.moods.join(", "),
    timeOfDay: facts.timeOfDay.join(", "),
    ...copy,
  };

  function draft(kind: ProductCopyKind) {
    if (!facts.name.trim()) return notify.error("Give the product a name first.");
    setBusyKind(kind);
    start(async () => {
      try {
        const r = await aiDraftProductCopy({ kind, productId, brief: brief.trim() || undefined, facts });
        if (!r.ok) {
          notify.error(r.error);
          return;
        }
        const rows = Object.entries(r.draft as Record<string, unknown>).map(([key, value]) => {
          const k = key as FormKey | CopyKey;
          return { key: k, label: LABELS[k], before: current[k] ?? "", after: show(value), long: k === "story" || k === "storyAr" || k === "seoDescription", rtl: k.endsWith("Ar") };
        });
        setPreview({ kind, rows, mock: r.mock, note: r.note, model: r.model });
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        notify.error("Couldn’t reach the AI writer. Try again.");
      } finally {
        setBusyKind(null);
      }
    });
  }

  function accept() {
    if (!preview) return;
    const formPatch: Partial<Record<FormKey, string>> = {};
    const copyPatch: Partial<Record<CopyKey, string>> = {};
    for (const r of preview.rows) {
      if (isFormKey(r.key)) formPatch[r.key] = r.after;
      else copyPatch[r.key] = r.after;
    }
    if (Object.keys(formPatch).length) {
      onApply(formPatch);
      notify.success("Applied to the form — review it, then Save product.");
    }
    if (Object.keys(copyPatch).length) {
      setCopy((c) => ({ ...c, ...copyPatch }));
      setCopyDirty(true);
      notify.success(productId ? "Applied below — review it, then Save SEO & Arabic." : "Applied below — create the product first to save it.");
    }
    setPreview(null);
  }

  return (
    <fieldset className="border border-gold/30 bg-bg-elev">
      <legend className="sr-only">Write with AI</legend>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <Sparkles className="size-4 text-gold" strokeWidth={1.4} aria-hidden />
        <p className="eyebrow">Write with AI</p>
        <p className="text-xs text-subtle">Drafts are previews — nothing is saved until you accept and save.</p>
      </div>
      <div className="space-y-5 p-5">
        <Field label="Brief (optional)" hint="Angle, audience or words to use — e.g. “for Eid gifting, mention the hand-rolled sticks”.">
          <Input value={brief} maxLength={500} onChange={(e) => setBrief(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-3">
          {KINDS.map((k) => (
            <Button key={k.kind} type="button" size="sm" variant="outline" disabled={pending} onClick={() => draft(k.kind)} title={k.hint} aria-describedby={undefined}>
              <Sparkles className="size-3.5" aria-hidden />
              {busyKind === k.kind ? "Writing…" : k.label}
            </Button>
          ))}
        </div>

        {preview ? (
          <section aria-label="AI suggestion" className="border border-line bg-bg">
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 text-xs">
              <span className="eyebrow !text-[0.625rem]">Suggestion · {KINDS.find((k) => k.kind === preview.kind)?.label}</span>
              {preview.mock ? <span className="border border-line-strong px-1.5 py-0.5 uppercase tracking-[0.18em] text-gold">Mock mode</span> : <span className="text-subtle">{preview.model}</span>}
              {preview.note ? <span className="text-subtle">{preview.note}</span> : null}
            </div>
            <ul className="divide-y divide-line">
              {preview.rows.map((r, i) => (
                <li key={r.key} className="grid gap-3 px-4 py-4 lg:grid-cols-2">
                  <div>
                    <p className="mb-1.5 text-[0.625rem] uppercase tracking-[0.2em] text-subtle">{r.label} · changes</p>
                    <div dir={r.rtl ? "rtl" : undefined}>
                      <Diff before={r.before} after={r.after} />
                    </div>
                  </div>
                  <Field label={`${r.label} · edit before accepting`}>
                    {r.long ? (
                      <Textarea
                        dir={r.rtl ? "rtl" : undefined}
                        value={r.after}
                        className="min-h-28"
                        onChange={(e) => setPreview((p) => (p ? { ...p, rows: p.rows.map((x, j) => (j === i ? { ...x, after: e.target.value } : x)) } : p))}
                      />
                    ) : (
                      <Input
                        dir={r.rtl ? "rtl" : undefined}
                        value={r.after}
                        onChange={(e) => setPreview((p) => (p ? { ...p, rows: p.rows.map((x, j) => (j === i ? { ...x, after: e.target.value } : x)) } : p))}
                      />
                    )}
                  </Field>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap justify-end gap-3 border-t border-line px-4 py-3">
              <Button type="button" size="sm" variant="ghost" onClick={() => setPreview(null)}>
                <X className="size-3.5" aria-hidden /> Discard
              </Button>
              <Button type="button" size="sm" onClick={accept}>
                <Check className="size-3.5" aria-hidden /> Accept suggestion
              </Button>
            </div>
          </section>
        ) : null}

        <details className="group border border-line" open={copyDirty || undefined}>
          <summary className="cursor-pointer list-none px-4 py-3 text-[0.6875rem] uppercase tracking-[0.2em] text-muted hover:text-fg">SEO &amp; Arabic copy</summary>
          <div className="grid gap-5 border-t border-line p-4 sm:grid-cols-2">
            {(Object.keys(copy) as CopyKey[]).map((k) => (
              <Field key={k} label={LABELS[k]} hint={k === "seoTitle" ? `${copy[k].length}/60` : k === "seoDescription" ? `${copy[k].length}/155` : undefined} className={cn(k === "storyAr" || k === "seoDescription" ? "sm:col-span-2" : "")}>
                {k === "storyAr" || k === "seoDescription" ? (
                  <Textarea
                    dir={k.endsWith("Ar") ? "rtl" : undefined}
                    value={copy[k]}
                    className="min-h-24"
                    onChange={(e) => {
                      setCopy((c) => ({ ...c, [k]: e.target.value }));
                      setCopyDirty(true);
                    }}
                  />
                ) : (
                  <Input
                    dir={k.endsWith("Ar") ? "rtl" : undefined}
                    value={copy[k]}
                    onChange={(e) => {
                      setCopy((c) => ({ ...c, [k]: e.target.value }));
                      setCopyDirty(true);
                    }}
                  />
                )}
              </Field>
            ))}
            <div className="flex items-center justify-end gap-3 sm:col-span-2">
              {!productId ? <p className="me-auto text-xs text-subtle">Create the product first, then save its SEO &amp; Arabic copy.</p> : null}
              <Button
                type="button"
                size="sm"
                disabled={!productId || save.pending || !copyDirty}
                onClick={() => productId && save.run(() => aiSaveProductCopy({ productId, ...copy }), { onSuccess: () => setCopyDirty(false) })}
              >
                {save.pending ? "Saving…" : "Save SEO & Arabic"}
              </Button>
            </div>
          </div>
        </details>
      </div>
    </fieldset>
  );
}
