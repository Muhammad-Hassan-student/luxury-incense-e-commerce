import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/field";
import { PageHeader, Section } from "@/components/admin/ui";
import { GuardrailsForm, JourneySwitch, PauseAll } from "@/components/admin/automations/journey-controls";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { ensureJourneys, getJourneySettings, journeyStats, segmentSizes } from "@/server/automations";
import { JOURNEY_KEYS, JOURNEYS, journeySteps } from "@/lib/journeys";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "Journeys" };

const DAY = 86_400_000;

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.5625rem] uppercase tracking-[0.2em] text-subtle">{label}</p>
      <p className="mt-1 truncate font-display text-xl font-light tabular-nums text-fg">{value}</p>
    </div>
  );
}

export default async function AutomationsPage() {
  await requirePermission("automations.manage");
  const now = new Date();
  const [journeys, settings, stats, sizes, abandoned30, awaitingReview] = await Promise.all([
    ensureJourneys(),
    getJourneySettings(),
    journeyStats(now),
    segmentSizes(now),
    db.cart.count({ where: { remindedAt: { gte: new Date(now.getTime() - 30 * DAY) } } }),
    db.order.count({ where: { status: "DELIVERED", userId: { not: null }, tradeAccountId: null, items: { some: { variant: { product: { isGiftCard: false } } } } } }),
  ]);
  const byKey = new Map(journeys.map((j) => [j.key, j]));
  const on = journeys.filter((j) => j.enabled).length;

  return (
    <>
      <PageHeader eyebrow="Marketing" title="Customer journeys" actions={<PauseAll paused={settings.paused} />}>
        Segment → flow automations. {on} of {JOURNEY_KEYS.length} switched on · max 1 email per customer every {settings.frequencyCapHours}h · {settings.dailySendCap} a day
        {settings.dryRun ? " · dry-run mode" : ""}
      </PageHeader>

      {settings.paused ? (
        <p role="status" className="mb-6 border border-ember/50 px-5 py-4 text-sm text-ember">
          All journeys are paused — nothing enrolls or sends until you resume. Runs in progress wait where they are.
        </p>
      ) : settings.dryRun ? (
        <p role="status" className="mb-6 border border-gold/40 px-5 py-4 text-sm text-gold">
          Dry-run mode — the hourly job only reports who it would enroll and which steps are due.
        </p>
      ) : null}

      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {JOURNEY_KEYS.map((key) => {
          const j = byKey.get(key)!;
          const meta = JOURNEYS[key];
          const s = stats.get(key) ?? { active: 0, sent: 0, converted: 0, revenue: 0 };
          const steps = journeySteps(key, j.config).length;
          return (
            <li key={key} className="flex min-w-0 flex-col border border-line bg-bg-elev">
              <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
                <div className="min-w-0">
                  <p className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">{meta.segment ? `Segment · ${meta.segment}` : "Event · delivered"}</p>
                  <h2 className="mt-1 font-display text-2xl font-light text-fg">{meta.name}</h2>
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <Badge tone={j.enabled ? "gold" : "muted"}>{j.enabled ? "On" : "Off"}</Badge>
                  <JourneySwitch journeyKey={key} name={meta.name} enabled={j.enabled} />
                </div>
              </div>
              <p className="px-5 pt-4 text-sm text-muted">{meta.summary}</p>
              <div className="grid grid-cols-3 gap-4 px-5 py-4">
                <Stat label={meta.segment ? "In segment" : "Delivered"} value={(meta.segment ? sizes[meta.segment] : awaitingReview).toLocaleString("en-IN")} />
                <Stat label="Active runs" value={s.active.toLocaleString("en-IN")} />
                <Stat label="Steps" value={steps} />
                <Stat label="Sent · 30d" value={s.sent.toLocaleString("en-IN")} />
                <Stat label="Converted" value={s.converted.toLocaleString("en-IN")} />
                <Stat label="Revenue" value={formatMoney(s.revenue)} />
              </div>
              <Link
                href={`/admin/automations/${key}`}
                className="mt-auto flex items-center justify-between border-t border-line px-5 py-3 text-[0.6875rem] uppercase tracking-[0.2em] text-muted transition-colors hover:text-gold"
              >
                View flow & edit <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </li>
          );
        })}
        <li className="flex min-w-0 flex-col border border-dashed border-line-strong bg-bg">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <p className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">System · hourly job</p>
              <h2 className="mt-1 font-display text-2xl font-light text-fg">Abandoned bag</h2>
            </div>
            <Badge tone="muted" className="mt-1">Read-only</Badge>
          </div>
          <p className="px-5 pt-4 text-sm text-muted">One gentle reminder per bag, three hours after it was last touched. Runs separately from journeys and is always on.</p>
          <div className="grid grid-cols-3 gap-4 px-5 py-4">
            <Stat label="Reminded · 30d" value={abandoned30.toLocaleString("en-IN")} />
            <Stat label="Steps" value={1} />
            <Stat label="Delay" value="3h" />
          </div>
        </li>
      </ul>

      <Section title="Guardrails" className="mt-8">
        <p className="px-5 pt-5 text-sm text-muted">
          Journeys never email staff, deleted accounts, opted-out customers or invalid addresses. Every email carries a signed one-click unsubscribe link.
        </p>
        <GuardrailsForm settings={settings} />
      </Section>
    </>
  );
}
