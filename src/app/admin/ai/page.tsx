import Link from "next/link";
import { Badge } from "@/components/ui/field";
import { Empty, Kpi, PageHeader, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { AiFeatureToggles, JournalDrafter } from "@/components/admin/ai/ai-controls";
import { db } from "@/server/db";
import { can, requireAnyPermission } from "@/server/roles";
import { featureLabels, getAiFeatures, mockReasonText, monthStart, resolveAiMode } from "@/server/ai/config";
import { supportHandoffRegistered } from "@/server/ai/handoff";
import { fmtDateTime } from "@/lib/admin-shared";
import { param } from "@/lib/admin-queries";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI" };

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(micros < 10_000_000 ? 2 : 0)}`;
const num = new Intl.NumberFormat("en-IN");

export default async function AiPage(props: PageProps<"/admin/ai">) {
  const user = await requireAnyPermission("settings.manage", "content.edit");
  const isOwner = can(user, "settings.manage");
  const sp = await props.searchParams;
  const view = param(sp.view) === "unhelpful" ? "unhelpful" : param(sp.view) === "handoff" ? "handoff" : "all";
  const since = monthStart();

  const [mode, features, usage, convoCount, helpfulYes, helpfulNo, conversations] = await Promise.all([
    resolveAiMode(),
    getAiFeatures(),
    db.aiUsage.groupBy({
      by: ["feature", "mock"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, costMicros: true },
    }),
    db.aiConversation.count({ where: { createdAt: { gte: since } } }),
    db.aiConversation.count({ where: { createdAt: { gte: since }, helpful: true } }),
    db.aiConversation.count({ where: { createdAt: { gte: since }, helpful: false } }),
    isOwner
      ? db.aiConversation.findMany({
          where: view === "unhelpful" ? { helpful: false } : view === "handoff" ? { handoffRequestedAt: { not: null } } : {},
          orderBy: { updatedAt: "desc" },
          take: 25,
          include: { messages: { orderBy: { createdAt: "asc" }, select: { id: true, role: true, content: true, mode: true, createdAt: true, tools: true } } },
        })
      : Promise.resolve([]),
  ]);

  const pct = mode.capMicros > 0 ? Math.min(100, Math.round((mode.spentMicros / mode.capMicros) * 100)) : 0;
  const tab = (active: boolean) => cn("border-b-2 px-1 pb-2 text-[0.6875rem] uppercase tracking-[0.2em] transition-colors", active ? "border-gold text-fg" : "border-transparent text-muted hover:text-fg");

  return (
    <>
      <PageHeader
        eyebrow="Owner"
        title="AI"
        actions={mode.live ? <Badge>Live · Claude</Badge> : <Badge tone="muted">Mock mode</Badge>}
      >
        Scent concierge and admin writing tools. Key, models and monthly cap live in{" "}
        <Link href="/admin/integrations" className={linkClass}>
          Integrations → AI
        </Link>
        .{!mode.live ? ` ${mockReasonText[mode.reason]}` : ""}
      </PageHeader>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Spend this month" value={usd(mode.spentMicros)} hint={mode.capMicros > 0 ? `of ${usd(mode.capMicros)} cap · ${pct}%` : "No cap set"} />
        <Kpi label="Concierge chats" value={num.format(convoCount)} hint="This month" />
        <Kpi label="Helpful" value={helpfulYes + helpfulNo ? `${Math.round((helpfulYes / (helpfulYes + helpfulNo)) * 100)}%` : "—"} hint={`${helpfulYes} yes · ${helpfulNo} no`} />
        <Kpi label="Models" value={<span className="text-base">{mode.models.concierge}</span>} hint={`Admin ${mode.models.admin} · summaries ${mode.models.fast}`} />
      </div>
      {mode.capMicros > 0 ? (
        <div className="mb-8 h-1.5 w-full bg-line" role="progressbar" aria-label="Monthly AI budget used" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn("h-full", pct >= 90 ? "bg-ember" : "bg-gold")} style={{ width: `${pct}%` }} />
        </div>
      ) : null}

      <div className="space-y-8">
        <Section title="Usage this month">
          {usage.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Feature</Th>
                  <Th>Mode</Th>
                  <Th className="text-right">Calls</Th>
                  <Th className="text-right">Tokens in</Th>
                  <Th className="text-right">Tokens out</Th>
                  <Th className="text-right">Cache read</Th>
                  <Th className="text-right">Est. cost</Th>
                </tr>
              </thead>
              <tbody>
                {usage
                  .sort((a, b) => a.feature.localeCompare(b.feature) || Number(a.mock) - Number(b.mock))
                  .map((u) => (
                    <tr key={`${u.feature}-${u.mock}`}>
                      <Td>{u.feature.replace(/_/g, " ")}</Td>
                      <Td>{u.mock ? <Badge tone="muted">Mock</Badge> : <Badge>Live</Badge>}</Td>
                      <Td className="text-right tabular-nums">{num.format(u._count._all)}</Td>
                      <Td className="text-right tabular-nums">{num.format(u._sum.inputTokens ?? 0)}</Td>
                      <Td className="text-right tabular-nums">{num.format(u._sum.outputTokens ?? 0)}</Td>
                      <Td className="text-right tabular-nums">{num.format(u._sum.cacheReadTokens ?? 0)}</Td>
                      <Td className="text-right tabular-nums">{usd(u._sum.costMicros ?? 0)}</Td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          ) : (
            <Empty>No AI activity this month yet.</Empty>
          )}
        </Section>

        {isOwner ? (
          <Section title="Features">
            <AiFeatureToggles initial={features} labels={featureLabels} />
          </Section>
        ) : null}

        {can(user, "content.edit") ? (
          <Section title="Journal · draft a post">
            {features.journalDraft ? <JournalDrafter /> : <Empty>Journal drafts are switched off.</Empty>}
          </Section>
        ) : null}

        {isOwner ? (
          <Section title="Concierge conversations">
            <nav className="flex gap-6 border-b border-line px-5 pt-3" aria-label="Conversation filter">
              <Link href="/admin/ai" className={tab(view === "all")} aria-current={view === "all" ? "page" : undefined}>
                Recent
              </Link>
              <Link href="/admin/ai?view=unhelpful" className={tab(view === "unhelpful")} aria-current={view === "unhelpful" ? "page" : undefined}>
                Not helpful
              </Link>
              <Link href="/admin/ai?view=handoff" className={tab(view === "handoff")} aria-current={view === "handoff" ? "page" : undefined}>
                Asked for a person
              </Link>
            </nav>
            <p className="px-5 pt-3 text-xs text-subtle">
              Messages are stored with emails, phone and card numbers removed; guest chats carry no account or IP.
              {supportHandoffRegistered() ? "" : " Support desk not connected yet — hand-off requests are listed here."}
            </p>
            {conversations.length ? (
              <ul className="divide-y divide-line">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <details className="group px-5 py-4">
                      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 text-sm">
                        <span className="min-w-0 flex-1 truncate text-fg">{c.messages.find((m) => m.role === "user")?.content ?? "—"}</span>
                        <span className="text-xs text-subtle">{c.userId ? "Customer" : "Guest (anonymised)"}</span>
                        <span className="text-xs text-subtle">{c.turns} turns</span>
                        {c.mode === "mock" ? <Badge tone="muted">Mock</Badge> : <Badge>Live</Badge>}
                        {c.helpful === true ? <Badge>Helpful</Badge> : c.helpful === false ? <Badge tone="ember">Not helpful</Badge> : null}
                        {c.handoffRequestedAt ? <Badge tone="ember">{c.supportTicketId ? "Ticket opened" : "Wants a person"}</Badge> : null}
                        <span className="text-xs text-subtle">{fmtDateTime(c.updatedAt)}</span>
                      </summary>
                      <ol className="mt-4 space-y-3 border-s border-line ps-4">
                        {c.messages.map((m) => (
                          <li key={m.id} className="text-sm">
                            <p className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">
                              {m.role === "user" ? "Shopper" : `Perfumer · ${m.mode}`}
                              {Array.isArray(m.tools) && m.tools.length ? ` · tools: ${(m.tools as { name: string; ok: boolean }[]).map((t) => `${t.name}${t.ok ? "" : " ✕"}`).join(", ")}` : ""}
                            </p>
                            <p dir="auto" className="mt-1 whitespace-pre-line text-muted">
                              {m.content}
                            </p>
                          </li>
                        ))}
                        {c.feedbackNote ? <li className="text-xs text-ember">Feedback: {c.feedbackNote}</li> : null}
                      </ol>
                    </details>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No conversations yet.</Empty>
            )}
          </Section>
        ) : null}
      </div>
    </>
  );
}
