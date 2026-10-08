import Link from "next/link";
import { notFound } from "next/navigation";
import { render } from "@react-email/components";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Empty, Kpi, PageHeader, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { EmailPreview, JourneyConfigForm, JourneySwitch, PauseAll } from "@/components/admin/automations/journey-controls";
import { JourneyFlow } from "@/components/admin/automations/journey-flow";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { ensureJourneys, getJourneySettings, journeyStats, previewEntries, samplePreview } from "@/server/automations";
import { ENROLLMENT_STATUS_LABEL, isJourneyKey, JOURNEYS, journeySteps, journeyTemplates, parseJourneyConfig, TEMPLATE_LABEL, type TemplateKey } from "@/lib/journeys";
import { fmtDate, fmtDateTime } from "@/lib/admin-shared";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "Journey" };

const statusTone = (s: string) => (s === "CONVERTED" ? "gold" : s === "EXITED" ? "ember" : "muted") as "gold" | "ember" | "muted";

export default async function JourneyPage(props: PageProps<"/admin/automations/[key]">) {
  await requirePermission("automations.manage");
  const { key } = await props.params;
  if (!isJourneyKey(key)) notFound();
  const sp = await props.searchParams;
  const wantsPreview = sp.preview === "1";

  const journey = (await ensureJourneys()).find((j) => j.key === key)!;
  const meta = JOURNEYS[key];
  const config = parseJourneyConfig(key, journey.config);
  const steps = journeySteps(key, config);
  const [settings, stats, enrollments, messages, preview, previews] = await Promise.all([
    getJourneySettings(),
    journeyStats(),
    db.journeyEnrollment.findMany({
      where: { journeyId: journey.id },
      orderBy: { updatedAt: "desc" },
      take: 15,
      include: { user: { select: { id: true, email: true, name: true } } },
    }),
    db.journeyMessage.findMany({
      where: { enrollment: { journeyId: journey.id } },
      orderBy: { sentAt: "desc" },
      take: 15,
    }),
    wantsPreview ? previewEntries(key, { limit: 20 }) : null,
    Promise.all(
      [...new Set(journeyTemplates(key, config))].map(async (template: TemplateKey) => {
        const { subject, react } = samplePreview(template, key, config);
        return { template, subject, html: await render(react) };
      }),
    ),
  ]);
  const s = stats.get(key) ?? { active: 0, sent: 0, converted: 0, revenue: 0 };

  return (
    <>
      <PageHeader
        eyebrow={meta.segment ? `Journeys · segment ${meta.segment}` : "Journeys · after delivery"}
        title={meta.name}
        actions={
          <>
            <span className="flex items-center gap-3 text-[0.6875rem] uppercase tracking-[0.2em] text-muted">
              {journey.enabled ? "On" : "Off"}
              <JourneySwitch journeyKey={key} name={meta.name} enabled={journey.enabled} />
            </span>
            <PauseAll paused={settings.paused} />
          </>
        }
      >
        <Link href="/admin/automations" className={linkClass}>
          All journeys
        </Link>{" "}
        · {meta.summary}
      </PageHeader>

      {settings.paused ? (
        <p role="status" className="mb-6 border border-ember/50 px-5 py-4 text-sm text-ember">
          All journeys are paused.
        </p>
      ) : null}

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Active runs" value={s.active.toLocaleString("en-IN")} />
        <Kpi label="Sent · 30 days" value={s.sent.toLocaleString("en-IN")} />
        <Kpi label="Converted · 30 days" value={s.converted.toLocaleString("en-IN")} hint={s.sent ? `${Math.round((s.converted / s.sent) * 100)}% of emails` : undefined} />
        <Kpi label="Revenue attributed" value={formatMoney(s.revenue)} hint={`Last touch, ${settings.attributionDays}-day window`} />
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <Section title="Flow">
          <JourneyFlow journeyKey={key} steps={steps} frequencyCapHours={settings.frequencyCapHours} attributionDays={settings.attributionDays} />
        </Section>
        <div className="min-w-0 space-y-8">
          <Section title="Timing & offers">
            <JourneyConfigForm journeyKey={key} config={config as Record<string, number>} />
          </Section>
          <Section title="Email preview">
            <EmailPreview previews={previews} />
          </Section>
        </div>
      </div>

      <Section
        title={preview ? `Would enter now · ${preview.total}` : "Who would enter now"}
        className="mt-8"
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href={wantsPreview ? `/admin/automations/${key}` : `/admin/automations/${key}?preview=1`} scroll={false}>
              {wantsPreview ? "Hide" : "Preview (dry run)"}
            </Link>
          </Button>
        }
      >
        {preview ? (
          preview.people.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Customer</Th>
                  <Th>Entered</Th>
                  <Th>Because</Th>
                </tr>
              </thead>
              <tbody>
                {preview.people.map((p) => (
                  <tr key={`${p.userId}:${p.entryKey}`}>
                    <Td>
                      <Link href={`/admin/customers?q=${encodeURIComponent(p.email)}`} className={linkClass}>
                        {p.name ?? p.email}
                      </Link>
                      {p.name ? <span className="block text-xs text-muted">{p.email}</span> : null}
                    </Td>
                    <Td className="whitespace-nowrap text-muted">{fmtDate(p.enteredAt)}</Td>
                    <Td className="text-muted">{meta.segment ? `Entered ${meta.segment}` : "Delivered, not yet reviewed"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty>Nobody would enter right now — no one new in this segment within the {settings.entryWindowDays}-day entry window, or they are excluded by the guardrails.</Empty>
          )
        ) : (
          <p className="px-5 py-5 text-sm text-muted">Runs the entry rules and guardrails without enrolling or sending anything, and lists the first 20 people.</p>
        )}
      </Section>

      <div className="mt-8 grid gap-8 xl:grid-cols-2">
        <Section title="Recent runs">
          {enrollments.length ? (
            <Table className="min-w-[520px]">
              <thead>
                <tr>
                  <Th>Customer</Th>
                  <Th>Entered</Th>
                  <Th>Step</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((e) => (
                  <tr key={e.id}>
                    <Td className="max-w-[14rem] truncate">
                      <Link href={`/admin/customers?q=${encodeURIComponent(e.user.email)}`} className={linkClass}>
                        {e.user.name ?? e.user.email}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap text-muted">{fmtDate(e.enteredAt)}</Td>
                    <Td className="text-muted">
                      {Math.min(e.step, steps.length)}/{steps.length}
                      {e.status === "ACTIVE" && e.nextRunAt ? <span className="block text-xs text-subtle">next {fmtDateTime(e.nextRunAt)}</span> : null}
                    </Td>
                    <Td>
                      <Badge tone={statusTone(e.status)}>{ENROLLMENT_STATUS_LABEL[e.status]}</Badge>
                      {e.exitReason && e.status !== "COMPLETED" ? <span className="mt-1 block text-xs text-subtle">{e.exitReason}</span> : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty>No runs yet{journey.enabled ? "." : " — switch the journey on to start."}</Empty>
          )}
        </Section>
        <Section title="Recent emails">
          {messages.length ? (
            <Table className="min-w-[520px]">
              <thead>
                <tr>
                  <Th>Sent</Th>
                  <Th>Email</Th>
                  <Th>Offer</Th>
                  <Th className="text-right">Result</Th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <tr key={m.id}>
                    <Td className="whitespace-nowrap text-muted">{fmtDateTime(m.sentAt)}</Td>
                    <Td>
                      {TEMPLATE_LABEL[m.template as TemplateKey]?.split(" · ")[1] ?? m.template}
                      <span className="block max-w-[12rem] truncate text-xs text-subtle">{m.email}</span>
                    </Td>
                    <Td className="text-xs text-muted">{m.couponCode ?? (m.points ? `+${m.points} pts` : "—")}</Td>
                    <Td className="text-right">
                      {m.convertedOrderId ? (
                        <span className="tabular-nums text-gold">{formatMoney(m.revenue ?? 0)}</span>
                      ) : m.status === "FAILED" ? (
                        <Badge tone="ember">Failed</Badge>
                      ) : (
                        <span className="text-xs text-subtle">{m.status === "SENT" ? "Sent" : "Sending"}</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty>No emails sent yet.</Empty>
          )}
        </Section>
      </div>
    </>
  );
}
