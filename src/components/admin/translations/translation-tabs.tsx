"use client";

import { useState, useTransition } from "react";
import { Languages, Sparkles } from "lucide-react";
import { publishTranslationAction, saveTranslationAction, translateNowAction, type TabResult } from "@/actions/admin-translations";
import type { EditorData } from "@/server/translations/service";
import { Button } from "@/components/ui/button";
import { Badge, Input, Textarea } from "@/components/ui/field";
import { localeInfo } from "@/i18n/locales";
import { FIELD_SPECS, STATE_DOT, STATE_LABELS, STATE_TONE, type FieldMap, type FieldValue, type TranslationState } from "@/lib/translations-shared";
import { wordDiff } from "@/lib/word-diff";
import { fmtDateTime } from "@/lib/admin-shared";
import { cn } from "@/lib/utils";
import { notify } from "../use-admin-action";

export function StateBadge({ state }: { state: TranslationState }) {
  return <Badge tone={STATE_TONE[state]}>{STATE_LABELS[state]}</Badge>;
}

const show = (v: FieldValue | undefined) => (Array.isArray(v) ? v.join(", ") : (v ?? ""));

function Diff({ before, after }: { before: string; after: string }) {
  return (
    <p className="whitespace-pre-line text-xs leading-relaxed">
      {wordDiff(before, after).map((p, i) =>
        p.type === "same" ? (
          <span key={i} className="text-subtle">{p.text}</span>
        ) : p.type === "add" ? (
          <ins key={i} className="bg-gold/15 text-fg no-underline">{p.text}</ins>
        ) : (
          <del key={i} className="text-ember/80">{p.text}</del>
        ),
      )}
    </p>
  );
}

const toDraft = (fields: FieldMap) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, show(v)]));

/**
 * Language tabs for one catalogue item: English on the left, the chosen locale on the right, field by field.
 * Each locale shows its state (published / AI draft / stale / missing…), can be translated with Claude, edited,
 * saved as a draft or published. When the English changed since the translation, the English diff is shown.
 */
export function TranslationTabs({ initial, canEdit, initialLocale }: { initial: EditorData; canEdit: boolean; initialLocale?: string }) {
  const [data, setData] = useState(initial);
  const [active, setActive] = useState(() => initial.cells.find((c) => c.locale === initialLocale)?.locale ?? initial.cells.find((c) => c.state !== "published")?.locale ?? initial.cells[0].locale);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>(() => Object.fromEntries(initial.cells.map((c) => [c.locale, toDraft(c.fields)])));
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const cell = data.cells.find((c) => c.locale === active)!;
  const info = localeInfo(active);
  const specs = FIELD_SPECS[data.type].filter((s) => s.key in data.english || s.humanOnly || cell.fields[s.key]);
  const draft = drafts[active] ?? {};
  const dirty = specs.some((s) => (draft[s.key] ?? "") !== show(cell.fields[s.key]));
  const stale = cell.state === "stale";

  const apply = (res: TabResult, locales: string[]) => {
    if (!res.ok) return notify.error(res.error);
    if (res.message) notify.success(res.message);
    setData(res.data);
    setDrafts((d) => ({ ...d, ...Object.fromEntries(res.data.cells.filter((c) => locales.includes(c.locale)).map((c) => [c.locale, toDraft(c.fields)])) }));
  };

  const act = (label: string, locales: string[], call: () => Promise<TabResult>) => {
    setBusy(label);
    start(async () => {
      try {
        apply(await call(), locales);
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        notify.error("Something went wrong. Please try again.");
      } finally {
        setBusy(null);
      }
    });
  };

  const fieldsPayload = () => Object.fromEntries(specs.map((s) => [s.key, s.list ? (draft[s.key] ?? "").split(",").map((x) => x.trim()).filter(Boolean) : (draft[s.key] ?? "")]));
  const missingOrStale = data.cells.filter((c) => data.enabledLocales.includes(c.locale) && c.state !== "published" && c.state !== "ai_draft" && c.state !== "draft").map((c) => c.locale);

  return (
    <div className="border border-line bg-bg-elev" data-translation-tabs>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="eyebrow flex items-center gap-2">
          <Languages className="size-3.5" aria-hidden /> Translations
        </p>
        {canEdit ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || missingOrStale.length === 0}
            title={missingOrStale.length ? `Missing or stale: ${missingOrStale.join(", ")}` : "Every enabled language has a translation"}
            onClick={() => act("all", missingOrStale, () => translateNowAction({ type: data.type, id: data.id, locales: missingOrStale }))}
          >
            <Sparkles className="size-3.5" aria-hidden />
            {busy === "all" ? "Translating…" : `Translate missing (${missingOrStale.length})`}
          </Button>
        ) : null}
      </div>

      <div role="tablist" aria-label="Languages" className="flex gap-px overflow-x-auto border-b border-line bg-line">
        {data.cells.map((c) => {
          const l = localeInfo(c.locale);
          const on = c.locale === active;
          return (
            <button
              key={c.locale}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls="translation-panel"
              onClick={() => setActive(c.locale)}
              className={cn("flex shrink-0 items-center gap-2 bg-bg-elev px-4 py-3 text-xs transition-colors", on ? "text-gold" : "text-muted hover:text-fg", !data.enabledLocales.includes(c.locale) && "opacity-50")}
              title={`${l.english}: ${STATE_LABELS[c.state]}`}
            >
              <span className={cn("size-2 shrink-0 rounded-full", STATE_DOT[c.state])} aria-hidden />
              <span lang={c.locale} dir={l.dir}>{l.native}</span>
              <span className="sr-only">({STATE_LABELS[c.state]})</span>
            </button>
          );
        })}
      </div>

      <div id="translation-panel" role="tabpanel" className="p-5">
        <div className="mb-5 flex flex-wrap items-center gap-3 text-xs text-muted">
          <StateBadge state={cell.state} />
          {cell.published && cell.state !== "published" ? <Badge tone="gold">Live version kept</Badge> : null}
          <span>{info.english}</span>
          {cell.source ? <span>· by {cell.source === "ai" ? `Claude${cell.model ? ` (${cell.model})` : ""}` : "staff"}</span> : null}
          {cell.translatedAt ? <span>· {fmtDateTime(cell.translatedAt)}</span> : null}
          {cell.publishedAt ? <span>· published {fmtDateTime(cell.publishedAt)}</span> : null}
          {!data.enabledLocales.includes(active) ? <span className="text-ember">· not enabled for automatic translation</span> : null}
        </div>
        {cell.lastError ? <p className="mb-5 border border-ember/40 px-4 py-3 text-xs text-ember">{cell.lastError}</p> : null}
        {stale ? <p className="mb-5 text-xs text-ember">The English changed after this was translated — the changes are highlighted under each English field.</p> : null}

        <div className="space-y-6">
          {specs.map((s) => {
            const en = show(data.english[s.key]);
            const was = cell.sourceText ? show(cell.sourceText[s.key]) : null;
            const value = draft[s.key] ?? "";
            const set = (v: string) => setDrafts((d) => ({ ...d, [active]: { ...d[active], [s.key]: v } }));
            const label = `${s.label} — ${info.english}`;
            return (
              <div key={s.key} className="grid gap-4 md:grid-cols-2">
                <div className="min-w-0">
                  <p className="eyebrow !text-muted">{s.label} · English</p>
                  <p className={cn("mt-3 whitespace-pre-line break-words text-sm text-fg/90", s.markdown && "max-h-64 overflow-y-auto font-mono text-xs")}>{en || <span className="text-subtle">—</span>}</p>
                  {stale && was !== null && was !== en ? (
                    <div className="mt-2 border-s border-ember/40 ps-3">
                      <p className="mb-1 text-[0.625rem] uppercase tracking-[0.2em] text-ember">Changed since translation</p>
                      <Diff before={was} after={en} />
                    </div>
                  ) : null}
                </div>
                <label className="block min-w-0">
                  <span className="eyebrow !text-muted">
                    {s.label} · <span lang={active} dir={info.dir}>{info.native}</span>
                    {s.humanOnly ? <span className="ms-2 normal-case tracking-normal text-subtle">(optional — kept as written unless you localise it)</span> : null}
                  </span>
                  {s.long ? (
                    <Textarea aria-label={label} lang={active} dir={info.dir} value={value} maxLength={s.max} disabled={!canEdit} onChange={(e) => set(e.target.value)} className={cn(s.markdown ? "min-h-64 font-mono text-xs" : "min-h-28")} placeholder={en ? "Falls back to English" : ""} />
                  ) : (
                    <Input aria-label={label} lang={active} dir={info.dir} value={value} maxLength={s.list ? 600 : s.max} disabled={!canEdit} onChange={(e) => set(e.target.value)} placeholder={s.list ? "Comma-separated" : en ? "Falls back to English" : ""} />
                  )}
                  {cell.published && show(cell.published[s.key]) !== value && show(cell.published[s.key]) ? (
                    <span className="mt-1 block text-xs text-subtle" lang={active} dir={info.dir}>
                      Live: {show(cell.published[s.key]).slice(0, 160)}
                      {show(cell.published[s.key]).length > 160 ? "…" : ""}
                    </span>
                  ) : null}
                </label>
              </div>
            );
          })}
        </div>

        {canEdit ? (
          <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => act("one", [active], () => translateNowAction({ type: data.type, id: data.id, locales: [active] }))}>
              <Sparkles className="size-3.5" aria-hidden />
              {busy === "one" ? "Translating…" : cell.state === "missing" || cell.state === "needs_translation" ? "Translate with AI" : "Re-translate with AI"}
            </Button>
            <span className="flex-1" />
            {cell.published ? (
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => act("unpublish", [], () => publishTranslationAction({ type: data.type, id: data.id, locale: active, unpublish: true }))}>
                Unpublish
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="ghost" disabled={pending || !dirty} onClick={() => act("save", [active], () => saveTranslationAction({ type: data.type, id: data.id, locale: active, fields: fieldsPayload() }))}>
              {busy === "save" ? "Saving…" : "Save draft"}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending || (!dirty && cell.state === "published") || specs.every((s) => !(draft[s.key] ?? "").trim())}
              onClick={() =>
                act("publish", [active], () =>
                  dirty || stale ? saveTranslationAction({ type: data.type, id: data.id, locale: active, fields: fieldsPayload(), publish: true }) : publishTranslationAction({ type: data.type, id: data.id, locale: active }),
                )
              }
            >
              {busy === "publish" ? "Publishing…" : dirty ? "Save & publish" : "Publish"}
            </Button>
          </div>
        ) : (
          <p className="mt-6 text-xs text-subtle">Read-only — editors can translate and publish.</p>
        )}
      </div>
    </div>
  );
}
