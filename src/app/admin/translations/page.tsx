import Link from "next/link";
import { Empty, Kpi, PageHeader, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { Badge } from "@/components/ui/field";
import { BulkPublishButton, TranslateMissingButton, TranslationSettingsForm } from "@/components/admin/translations/overview-controls";
import { can, requireAnyPermission } from "@/server/roles";
import { translationsOverview } from "@/server/translations/service";
import { localeInfo } from "@/i18n/locales";
import { ENTITY_LABELS, ENTITY_TYPES, STATE_DOT, STATE_LABELS, TRANSLATION_LOCALES, type EntityType, type TranslationState } from "@/lib/translations-shared";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Translations" };

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
const editHref = (type: EntityType, id: string, locale?: string) => (type === "product" ? `/admin/products/${id}#translations` : `/admin/translations/${type}/${id}${locale ? `?locale=${locale}` : ""}`);
const STATES: TranslationState[] = ["published", "ai_draft", "draft", "stale", "queued", "needs_translation", "missing"];

export default async function TranslationsPage() {
  const user = await requireAnyPermission("catalog.view", "content.view");
  const canEdit = can(user, "catalog.edit") || can(user, "content.edit");
  const o = await translationsOverview();
  const enabled = o.matrix.filter((m) => m.enabled);
  const avg = enabled.length ? Math.round(enabled.reduce((n, m) => n + m.coverage, 0) / enabled.length) : 0;
  const visibleTypes = ENTITY_TYPES.filter((t) => (ENTITY_LABELS[t].permission === "content.edit" ? can(user, "content.view") : can(user, "catalog.view")));

  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title="Translations"
        actions={
          canEdit ? (
            <>
              <BulkPublishButton />
              <TranslateMissingButton />
            </>
          ) : null
        }
      >
        Product, category, collection and journal copy in every store language. English is always the source: a missing or unpublished field shows the English, and editing the English marks translations stale. Claude drafts; you review and publish.
      </PageHeader>

      {!o.usage.live ? <p className="mb-6 border border-ember/40 px-4 py-3 text-sm text-ember">{o.usage.reason} Queued items wait as “Needs translation”; the store keeps showing English.</p> : null}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Published coverage" value={`${avg}%`} hint={`${enabled.length} languages enabled`} />
        <Kpi label="Queued" value={o.queued} hint="Worked by the daily run or Translate missing" />
        <Kpi label="Stale" value={o.stale.length} hint="English changed since translating" />
        <Kpi
          label="Translation spend (month)"
          value={usd(o.usage.spentMicros)}
          hint={`${o.usage.capMicros ? `budget ${usd(o.usage.capMicros)}` : "no separate budget"} · AI total ${usd(o.usage.globalSpentMicros)}${o.usage.globalCapMicros ? ` / ${usd(o.usage.globalCapMicros)}` : ""} · ${o.usage.model}`}
        />
      </div>

      <Section title="Coverage by language" className="mb-8">
        <Table>
          <thead>
            <tr>
              <Th>Language</Th>
              {STATES.map((s) => (
                <Th key={s} className="text-end">{STATE_LABELS[s]}</Th>
              ))}
              <Th className="text-end">Coverage</Th>
              {canEdit ? <Th /> : null}
            </tr>
          </thead>
          <tbody>
            {o.matrix.map((m) => {
              const info = localeInfo(m.locale);
              return (
                <tr key={m.locale} className={cn(!m.enabled && "opacity-50")}>
                  <Td>
                    <span lang={m.locale} dir={info.dir}>{info.native}</span> <span className="text-xs text-subtle">{info.english}</span>
                    {!m.enabled ? <Badge tone="muted" className="ms-2">Off</Badge> : null}
                  </Td>
                  {STATES.map((s) => (
                    <Td key={s} className={cn("text-end tabular-nums", m.counts[s] === 0 && "text-subtle", s === "stale" && m.counts[s] > 0 && "text-ember")}>{m.counts[s]}</Td>
                  ))}
                  <Td className="text-end tabular-nums">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-1 w-16 bg-line" aria-hidden>
                        <span className="block h-1 bg-gold" style={{ width: `${m.coverage}%` }} />
                      </span>
                      {m.coverage}%
                    </span>
                  </Td>
                  {canEdit ? <Td className="text-end">{m.counts.ai_draft + m.counts.draft > 0 ? <BulkPublishButton locale={m.locale} label="Publish ready" /> : null}</Td> : null}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Section>

      {o.stale.length > 0 || o.flagged.length > 0 ? (
        <div className="mb-8 grid gap-8 lg:grid-cols-2">
          <Section title={`Stale · ${o.stale.length}`}>
            {o.stale.length ? (
              <ul className="divide-y divide-line text-sm">
                {o.stale.slice(0, 40).map((s) => (
                  <li key={`${s.type}-${s.id}-${s.locale}`} className="flex items-center justify-between gap-4 px-5 py-3">
                    <span className="min-w-0 truncate">
                      <span className="text-subtle">{ENTITY_LABELS[s.type].one} · </span>
                      {s.label}
                    </span>
                    <Link href={editHref(s.type, s.id, s.locale)} className={linkClass}>
                      {localeInfo(s.locale).english}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Nothing stale.</Empty>
            )}
          </Section>
          <Section title={`Needs a look · ${o.flagged.length}`}>
            {o.flagged.length ? (
              <ul className="divide-y divide-line text-sm">
                {o.flagged.map((f) => (
                  <li key={`${f.type}-${f.id}-${f.locale}`} className="px-5 py-3">
                    <Link href={editHref(f.type, f.id, f.locale)} className={linkClass}>
                      {ENTITY_LABELS[f.type].one} · {localeInfo(f.locale).english}
                    </Link>
                    <p className="mt-1 text-xs text-ember">{f.error}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No flagged translations.</Empty>
            )}
          </Section>
        </div>
      ) : null}

      {visibleTypes.map((type) => {
        const rows = o.items.filter((i) => i.type === type);
        return (
          <Section key={type} title={`${ENTITY_LABELS[type].many} · ${rows.length}`} className="mb-8">
            {rows.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>{ENTITY_LABELS[type].one}</Th>
                    {TRANSLATION_LOCALES.map((l) => (
                      <Th key={l} className="px-2 text-center" title={localeInfo(l).english}>{l}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <Td className="max-w-[18rem] truncate">
                        <Link href={editHref(type, r.id)} className={linkClass}>{r.label}</Link>
                      </Td>
                      {TRANSLATION_LOCALES.map((l) => (
                        <Td key={l} className="px-2 text-center">
                          <Link href={editHref(type, r.id, l)} title={`${localeInfo(l).english}: ${STATE_LABELS[r.states[l]]}`} className="inline-grid size-6 place-items-center">
                            <span className={cn("size-2.5 rounded-full", STATE_DOT[r.states[l]])} />
                            <span className="sr-only">{`${localeInfo(l).english}: ${STATE_LABELS[r.states[l]]}`}</span>
                          </Link>
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <Empty>Nothing to translate yet.</Empty>
            )}
          </Section>
        );
      })}

      <div className="mb-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted">
        {STATES.map((s) => (
          <span key={s} className="inline-flex items-center gap-2">
            <span className={cn("size-2.5 rounded-full", STATE_DOT[s])} aria-hidden /> {STATE_LABELS[s]}
          </span>
        ))}
      </div>

      <Section title="Settings">
        <TranslationSettingsForm initial={o.settings} canEdit={can(user, "catalog.edit")} />
        <p className="border-t border-line px-5 py-4 text-xs text-subtle">
          Claude ({o.usage.model}) translates several fields per call with a cached glossary: the house name and product names stay as written, prices and units are never changed, and attar, bakhoor, dhoop and oud follow each language’s convention.
          This month: {o.usage.calls} calls, {o.usage.inputTokens.toLocaleString("en-IN")} input + {o.usage.outputTokens.toLocaleString("en-IN")} output tokens ({o.usage.cacheReadTokens.toLocaleString("en-IN")} from cache). Translations a person wrote are never overwritten automatically — they show as stale.
        </p>
      </Section>
    </>
  );
}
