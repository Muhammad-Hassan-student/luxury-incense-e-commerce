"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { bulkPublishAction, saveTranslationSettingsAction, translateMissingAction } from "@/actions/admin-translations";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { localeInfo } from "@/i18n/locales";
import { TRANSLATION_LOCALES } from "@/lib/translations-shared";
import { useAdminAction } from "../use-admin-action";

export function TranslateMissingButton() {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  return (
    <Button type="button" size="sm" disabled={pending} onClick={() => run(() => translateMissingAction(), { onSuccess: () => router.refresh() })} title="Queue everything missing or out of date, then translate a batch with Claude">
      <Sparkles className="size-3.5" aria-hidden />
      {pending ? "Translating…" : "Translate missing"}
    </Button>
  );
}

export function BulkPublishButton({ locale, label = "Publish ready drafts" }: { locale?: string; label?: string }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  return (
    <Button type="button" size="sm" variant={locale ? "ghost" : "outline"} disabled={pending} onClick={() => run(() => bulkPublishAction({ locale }), { onSuccess: () => router.refresh() })} title="Publishes AI drafts that match the current English and passed the glossary check">
      {pending ? "Publishing…" : label}
    </Button>
  );
}

type Settings = { auto: boolean; autoPublish: boolean; locales: string[]; monthlyCapUsd: number; batchSize: number };

export function TranslationSettingsForm({ initial, canEdit }: { initial: Settings; canEdit: boolean }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [s, setS] = useState(initial);
  const toggleLocale = (l: string) => setS((p) => ({ ...p, locales: p.locales.includes(l) ? p.locales.filter((x) => x !== l) : [...p.locales, l] }));
  return (
    <form
      className="space-y-6 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveTranslationSettingsAction(s), { onSuccess: () => router.refresh() });
      }}
    >
      <fieldset disabled={!canEdit} className="space-y-6">
        <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <label className="flex cursor-pointer items-center gap-3">
            <input type="checkbox" className="size-4 accent-[var(--gold)]" checked={s.auto} onChange={(e) => setS({ ...s, auto: e.target.checked })} />
            Translate automatically (English edits + daily run)
          </label>
          <label className="flex cursor-pointer items-center gap-3">
            <input type="checkbox" className="size-4 accent-[var(--gold)]" checked={s.autoPublish} onChange={(e) => setS({ ...s, autoPublish: e.target.checked })} />
            Publish AI translations without review
          </label>
        </div>
        <div>
          <p className="eyebrow !text-muted">Languages</p>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3 text-sm">
            {TRANSLATION_LOCALES.map((l) => {
              const info = localeInfo(l);
              return (
                <label key={l} className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" className="size-4 accent-[var(--gold)]" checked={s.locales.includes(l)} onChange={() => toggleLocale(l)} />
                  <span lang={l} dir={info.dir}>{info.native}</span>
                  <span className="text-xs text-subtle">{info.english}</span>
                </label>
              );
            })}
          </div>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Monthly translation budget (USD)" hint="On top of the global AI cap in Integrations. 0 = only the global cap.">
            <Input type="number" min={0} step="0.5" value={s.monthlyCapUsd} onChange={(e) => setS({ ...s, monthlyCapUsd: Number(e.target.value) })} />
          </Field>
          <Field label="Translations per run" hint="Most (item, language) pairs one run translates.">
            <Input type="number" min={1} max={500} step={1} value={s.batchSize} onChange={(e) => setS({ ...s, batchSize: Math.round(Number(e.target.value)) })} />
          </Field>
        </div>
      </fieldset>
      {canEdit ? (
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      ) : null}
    </form>
  );
}
