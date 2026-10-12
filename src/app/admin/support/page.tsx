import Link from "next/link";
import type { SupportChannel, SupportPriority, SupportStatus } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Badge, Input, Select } from "@/components/ui/field";
import { Empty, Kpi, PageHeader, Pagination, Section } from "@/components/admin/ui";
import { SlaBadge, LogTicketForm } from "@/components/support/admin-support";
import { requirePermission } from "@/server/roles";
import { inboxCounts, listInbox, supportAgents } from "@/server/support";
import { param, parsePage } from "@/lib/admin-queries";
import { fmtDateTime } from "@/lib/admin-shared";
import { CHANNEL_LABEL, PRIORITY_LABEL, STATUS_LABEL, SUPPORT_CHANNELS, SUPPORT_PRIORITIES, SUPPORT_STATUSES, slaState } from "@/lib/support-shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Support" };

export default async function SupportInboxPage(props: PageProps<"/admin/support">) {
  const access = await requirePermission("support.manage");
  const sp = await props.searchParams;
  const status = (param(sp.status) || "OPEN") as SupportStatus | "ALL";
  const assignee = param(sp.assignee) || "all";
  const priority = (param(sp.priority) || "ALL") as SupportPriority | "ALL";
  const channel = (param(sp.channel) || "ALL") as SupportChannel | "ALL";
  const q = param(sp.q);
  const tag = param(sp.tag);
  const page = parsePage(sp.page);

  const valid = {
    status: status === "ALL" || SUPPORT_STATUSES.includes(status as SupportStatus) ? status : "OPEN",
    priority: priority === "ALL" || SUPPORT_PRIORITIES.includes(priority as SupportPriority) ? priority : "ALL",
    channel: channel === "ALL" || SUPPORT_CHANNELS.includes(channel as SupportChannel) ? channel : "ALL",
  } as const;
  const [inbox, counts, agents] = await Promise.all([
    listInbox(access, { status: valid.status as SupportStatus | "ALL", assignee, priority: valid.priority as SupportPriority | "ALL", channel: valid.channel as SupportChannel | "ALL", q, tag, page }),
    inboxCounts(access),
    supportAgents(),
  ]);
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const now = new Date();

  const href = (p: number, over: Record<string, string> = {}) => {
    const s = new URLSearchParams();
    const vals: Record<string, string> = { status: valid.status, assignee, priority: valid.priority, channel: valid.channel, q, tag, ...over };
    for (const [k, v] of Object.entries(vals)) if (v && !(k === "status" && v === "OPEN") && !(k === "assignee" && v === "all") && v !== "ALL") s.set(k, v);
    if (p > 1) s.set("page", String(p));
    const qs = s.toString();
    return qs ? `/admin/support?${qs}` : "/admin/support";
  };

  return (
    <>
      <PageHeader
        eyebrow="Customer care"
        title="Support"
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/support/macros">Canned replies</Link>
          </Button>
        }
      >
        Tickets from the account page, WhatsApp, the AI concierge and logged emails. Replying sets “waiting on customer”; their answer reopens it.
      </PageHeader>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Link href={href(1, { status: "OPEN", assignee: "all" })}>
          <Kpi label="Open" value={counts.open} />
        </Link>
        <Link href={href(1, { status: "PENDING", assignee: "all" })}>
          <Kpi label="Waiting on customer" value={counts.pending} />
        </Link>
        <Link href={href(1, { status: "ALL", assignee: "me" })}>
          <Kpi label="Mine (not resolved)" value={counts.mine} />
        </Link>
        <Link href={href(1, { status: "ALL", assignee: "unassigned" })}>
          <Kpi label="Unassigned" value={counts.unassigned} />
        </Link>
        <Kpi label="First reply overdue" value={<span className={counts.overdue ? "text-ember" : undefined}>{counts.overdue}</span>} />
      </div>

      <form method="get" className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_10rem_9rem_9rem_auto] lg:items-end" role="search">
        <label className="block sm:col-span-2 lg:col-span-1">
          <span className="sr-only">Search tickets</span>
          <Input name="q" defaultValue={q} placeholder="#number, subject, name, email or phone" type="search" />
        </label>
        <label className="block">
          <span className="sr-only">Status</span>
          <Select name="status" defaultValue={valid.status}>
            {SUPPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
            <option value="ALL">All statuses</option>
          </Select>
        </label>
        <label className="block">
          <span className="sr-only">Assignee</span>
          <Select name="assignee" defaultValue={assignee}>
            <option value="all">Anyone</option>
            <option value="me">Me</option>
            <option value="unassigned">Unassigned</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="sr-only">Priority</span>
          <Select name="priority" defaultValue={valid.priority}>
            <option value="ALL">Any priority</option>
            {SUPPORT_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="sr-only">Channel</span>
          <Select name="channel" defaultValue={valid.channel}>
            <option value="ALL">Any channel</option>
            {SUPPORT_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex gap-2">
          {tag ? <input type="hidden" name="tag" value={tag} /> : null}
          <Button type="submit" size="sm" variant="outline">
            Filter
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/admin/support">Clear</Link>
          </Button>
        </div>
      </form>

      <Section title={`Tickets · ${inbox.total}${tag ? ` · tag “${tag}”` : ""}`}>
        {inbox.rows.length ? (
          <ul className="divide-y divide-line">
            {inbox.rows.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-bg-soft/50 sm:flex-row sm:items-center sm:gap-6">
                <div className="min-w-0 flex-1">
                  <Link href={`/admin/support/${t.id}`} className="block truncate text-sm text-fg hover:text-gold">
                    <span className="text-subtle">#{t.number}</span> {t.subject}
                  </Link>
                  <p className="mt-1 truncate text-xs text-muted">
                    {t.name ?? t.email ?? t.phone ?? "Unknown"} · {CHANNEL_LABEL[t.channel]} · {fmtDateTime(t.updatedAt)}
                    {t.assigneeId ? ` · ${agentName.get(t.assigneeId) ?? "Assigned"}` : " · Unassigned"}
                  </p>
                  {t.tags.length ? (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {t.tags.map((g) => (
                        <Link key={g} href={href(1, { tag: g })} className="text-[0.625rem] uppercase tracking-[0.15em] text-subtle hover:text-gold">
                          #{g}
                        </Link>
                      ))}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {t.priority === "URGENT" || t.priority === "HIGH" ? <Badge tone="ember">{PRIORITY_LABEL[t.priority]}</Badge> : null}
                  <Badge tone={t.status === "RESOLVED" ? "muted" : t.status === "PENDING" ? "muted" : "gold"}>{STATUS_LABEL[t.status]}</Badge>
                  <SlaBadge sla={slaState(t, now)} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{q || tag ? "No tickets match." : "Inbox zero. Nothing waiting."}</Empty>
        )}
        <Pagination page={inbox.page} pages={inbox.pages} href={(p) => href(p)} />
      </Section>

      <Section title="Log a ticket (email or phone)" className="mt-8">
        <LogTicketForm />
      </Section>
    </>
  );
}
