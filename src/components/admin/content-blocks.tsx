"use client";

import { useId, useRef, useState, useTransition } from "react";
import { uploadMedia } from "@/lib/upload-client";
import { ChevronDown, ChevronUp, Pencil } from "lucide-react";
import { moveBlock, saveBlockData } from "@/actions/admin-content";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { BlockEnabledToggle } from "./toggles";
import { notify, useAdminAction } from "./use-admin-action";

export type BlockRow = { id: string; type: string; position: number; enabled: boolean; data: unknown; updatedAt: string };

type JsonObject = Record<string, unknown>;
const isObject = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);

const TEXT_FIELDS = ["eyebrow", "title", "subtitle"] as const;

/** Splits block data into the typed fields we have inputs for, and everything else (edited as JSON). */
function split(data: unknown) {
  const d = isObject(data) ? { ...data } : {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const typed = {
    eyebrow: str(d.eyebrow),
    title: str(d.title),
    subtitle: str(d.subtitle),
    body: str(d.body),
    productSlug: str(d.productSlug),
    imageUrl: str(d.imageUrl),
    videoUrl: str(d.videoUrl),
    ctaLabel: "",
    ctaHref: "",
  };
  for (const k of [...TEXT_FIELDS, "body", "productSlug", "imageUrl", "videoUrl"]) if (typeof d[k] === "string") delete d[k];
  if (isObject(d.cta)) {
    const cta = { ...d.cta };
    typed.ctaLabel = str(cta.label);
    typed.ctaHref = str(cta.href);
    if (typeof cta.label === "string") delete cta.label;
    if (typeof cta.href === "string") delete cta.href;
    if (Object.keys(cta).length) d.cta = cta;
    else delete d.cta;
  }
  return { typed, rest: Object.keys(d).length ? JSON.stringify(d, null, 2) : "" };
}

function summary(data: unknown) {
  if (!isObject(data)) return "";
  const t = typeof data.title === "string" ? data.title : "";
  return t.replace(/\n/g, " ");
}

function BlockEditor({ block, productSlugs, onClose }: { block: BlockRow; productSlugs: string[]; onClose: () => void }) {
  const initial = split(block.data);
  const [typed, setTyped] = useState(initial.typed);
  const [rest, setRest] = useState(initial.rest);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const { pending, run } = useAdminAction();
  const listId = useId();
  const set = (k: keyof typeof typed, v: string) => setTyped((p) => ({ ...p, [k]: v }));

  function save() {
    let extra: JsonObject = {};
    if (rest.trim()) {
      try {
        const parsed: unknown = JSON.parse(rest);
        if (!isObject(parsed)) throw new Error("Must be a JSON object, e.g. { \"key\": \"value\" }");
        extra = parsed;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Invalid JSON";
        setJsonError(msg);
        return notify.error(`Other fields: ${msg}`);
      }
    }
    setJsonError(null);
    const data: JsonObject = { ...extra };
    for (const k of [...TEXT_FIELDS, "body", "productSlug", "imageUrl", "videoUrl"] as const) if (typed[k].trim()) data[k] = typed[k].trim();
    if (typed.ctaLabel.trim() || typed.ctaHref.trim()) {
      const extraCta = isObject(extra.cta) ? extra.cta : {};
      data.cta = { ...extraCta, label: typed.ctaLabel.trim(), href: typed.ctaHref.trim() };
    }
    run(() => saveBlockData({ id: block.id, data }), { onSuccess: onClose });
  }

  return (
    <form
      className="grid gap-6 border-t border-line bg-bg px-5 py-6 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Field label="Eyebrow">
        <Input value={typed.eyebrow} onChange={(e) => set("eyebrow", e.target.value)} maxLength={80} />
      </Field>
      <Field label="Title" hint="Line breaks are kept">
        <Textarea value={typed.title} onChange={(e) => set("title", e.target.value)} maxLength={200} className="min-h-12" rows={2} />
      </Field>
      <Field label="Subtitle" className="sm:col-span-2">
        <Input value={typed.subtitle} onChange={(e) => set("subtitle", e.target.value)} maxLength={300} />
      </Field>
      <Field label="Body" className="sm:col-span-2">
        <Textarea value={typed.body} onChange={(e) => set("body", e.target.value)} maxLength={3000} />
      </Field>
      <Field label="Button label">
        <Input value={typed.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} maxLength={60} />
      </Field>
      <Field label="Button link" hint="e.g. /shop or /collections/oud">
        <Input value={typed.ctaHref} onChange={(e) => set("ctaHref", e.target.value)} maxLength={300} />
      </Field>
      <Field label="Product slug" hint="For 3D / gifting blocks">
        <Input value={typed.productSlug} onChange={(e) => set("productSlug", e.target.value)} list={listId} maxLength={120} />
        <datalist id={listId}>
          {productSlugs.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>
      <MediaUrlField label="Image (optional)" hint="Background image, or the video’s poster" accept="image/jpeg,image/png,image/webp,image/avif" value={typed.imageUrl} onChange={(v) => set("imageUrl", v)} />
      <MediaUrlField label="Video (optional)" hint="Hero: replaces the 3D scene. Muted, looping." accept="video/mp4,video/quicktime,video/webm" value={typed.videoUrl} onChange={(v) => set("videoUrl", v)} />
      <Field label="Other fields (JSON)" error={jsonError ?? undefined} hint="Any extra keys this block uses. Leave blank if none." className="sm:col-span-2">
        <Textarea
          value={rest}
          onChange={(e) => setRest(e.target.value)}
          spellCheck={false}
          aria-invalid={jsonError ? true : undefined}
          className="min-h-28 font-mono text-xs"
          placeholder="{ }"
        />
      </Field>
      <div className="flex justify-end gap-3 sm:col-span-2">
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save block"}
        </Button>
      </div>
    </form>
  );
}

export function ContentBlocks({ blocks, productSlugs, canEdit }: { blocks: BlockRow[]; productSlugs: string[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const { pending, run } = useAdminAction();

  return (
    <ol className="divide-y divide-line border border-line bg-bg-elev">
      {blocks.map((b, i) => (
        <li key={b.id}>
          <div className={cn("flex flex-wrap items-center gap-4 px-5 py-4", !b.enabled && "opacity-60")}>
            <span className="w-6 font-display text-xl font-light tabular-nums text-subtle">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="eyebrow">{b.type}</p>
              <p className="truncate text-sm text-fg">{summary(b.data) || <span className="text-subtle">Untitled</span>}</p>
            </div>
            <BlockEnabledToggle id={b.id} type={b.type} enabled={b.enabled} canEdit={canEdit} />
            {canEdit ? (
              <div className="flex items-center">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Move ${b.type} up`}
                  disabled={i === 0 || pending}
                  onClick={() => run(() => moveBlock({ id: b.id, direction: "up" }))}
                >
                  <ChevronUp className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Move ${b.type} down`}
                  disabled={i === blocks.length - 1 || pending}
                  onClick={() => run(() => moveBlock({ id: b.id, direction: "down" }))}
                >
                  <ChevronDown className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Edit ${b.type}`}
                  aria-expanded={editing === b.id}
                  onClick={() => setEditing((cur) => (cur === b.id ? null : b.id))}
                >
                  <Pencil className="size-4" aria-hidden />
                </Button>
              </div>
            ) : null}
          </div>
          {canEdit && editing === b.id ? <BlockEditor key={b.updatedAt} block={b} productSlugs={productSlugs} onClose={() => setEditing(null)} /> : null}
        </li>
      ))}
    </ol>
  );
}

/** URL input with an upload button that fills it in. */
function MediaUrlField({ label, hint, accept, value, onChange }: { label: string; hint: string; accept: string; value: string; onChange: (v: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [, start] = useTransition();
  return (
    <Field label={label} hint={pct !== null ? `Uploading… ${pct}%` : hint}>
      <div className="flex items-center gap-2">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://… or upload" maxLength={2000} />
        <button
          type="button"
          disabled={pct !== null}
          onClick={() => input.current?.click()}
          className="shrink-0 border border-line-strong px-3 py-2 text-[0.625rem] uppercase tracking-[0.2em] hover:border-gold hover:text-gold disabled:opacity-40"
        >
          Upload
        </button>
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          start(async () => {
            try {
              setPct(0);
              onChange((await uploadMedia(file, "content", setPct)).url);
            } catch (err) {
              notify.error(err instanceof Error ? err.message : "Upload failed");
            } finally {
              setPct(null);
            }
          });
        }}
      />
    </Field>
  );
}
