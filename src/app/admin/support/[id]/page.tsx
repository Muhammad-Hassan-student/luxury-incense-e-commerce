import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/field";
import { PageHeader, Section, linkClass } from "@/components/admin/ui";
import { MergeForm, SlaBadge, StaffReplyBox, TicketControls } from "@/components/support/admin-support";
import { Thread } from "@/components/support/thread";
import { requirePermission } from "@/server/roles";
import { getTicketForStaff, listMacros, supportAgents } from "@/server/support";
import { fmtDate, fmtDateTime } from "@/lib/admin-shared";
import { formatMoney } from "@/lib/money";
import { CHANNEL_LABEL, PRIORITY_LABEL, STATUS_LABEL, slaState } from "@/lib/support-shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ticket" };

export default async function TicketPage(props: PageProps<"/admin/support/[id]">) {
  const access = await requirePermission("support.manage");
  const { id } = await props.params;
  const [t, macros, agents] = await Promise.all([getTicketForStaff(access, id), listMacros(), supportAgents()]);
  if (!t) notFound();
  const sla = slaState(t);

  return (
    <>
      <PageHeader
        eyebrow={`Ticket #${t.number} · ${CHANNEL_LABEL[t.channel]}`}
        title={t.subject}
        actions={
          <Link href="/admin/support" className={linkClass}>
            ← Inbox
          </Link>
        }
      >
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={t.status === "OPEN" ? "gold" : "muted"}>{STATUS_LABEL[t.status]}</Badge>
          <Badge tone={t.priority === "URGENT" || t.priority === "HIGH" ? "ember" : "muted"}>{PRIORITY_LABEL[t.priority]}</Badge>
          <SlaBadge sla={sla} />
          <span>Opened {fmtDateTime(t.createdAt)}</span>
          {t.externalRef ? <span>· ref {t.externalRef}</span> : null}
        </span>
      </PageHeader>

      {t.mergedIntoId ? (
        <p className="mb-6 border border-gold/40 px-4 py-3 text-sm text-muted">
          Merged into{" "}
          <Link href={`/admin/support/${t.mergedIntoId}`} className={linkClass}>
            another ticket
          </Link>
          . Reply there.
        </p>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-8">
          <Section title="Conversation">
            <div className="p-5">
              <Thread staffView messages={t.messages} labels={{ you: "Customer", team: "Staff", internal: "Internal note" }} />
            </div>
          </Section>
          {!t.mergedIntoId ? (
            <Section title="Reply">
              <StaffReplyBox id={t.id} macros={macros.map((m) => ({ id: m.id, title: m.title, body: m.body }))} ctx={{ name: t.customer?.name ?? t.name, order: t.order?.number ?? null, ticket: t.number }} />
            </Section>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-8">
          <Section title="Customer">
            <dl className="space-y-2 p-5 text-sm">
              <div>
                <dt className="text-xs text-subtle">Name</dt>
                <dd className="break-words text-fg">{t.customer?.name ?? t.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-subtle">Email</dt>
                <dd className="break-all text-fg">{t.customer?.email ?? t.email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-subtle">Phone</dt>
                <dd className="text-fg">{t.phone ?? t.customer?.phone ?? "—"}</dd>
              </div>
              {t.customer ? (
                <div>
                  <dt className="text-xs text-subtle">Account</dt>
                  <dd className="text-muted">
                    Since {fmtDate(t.customer.createdAt)} · {t.customer._count.orders} order{t.customer._count.orders === 1 ? "" : "s"}
                  </dd>
                </div>
              ) : (
                <p className="text-xs text-subtle">No account linked — replies go by {t.channel === "WHATSAPP" ? "WhatsApp" : "email"}.</p>
              )}
            </dl>
          </Section>
          {t.order ? (
            <Section title="Order">
              <div className="space-y-1 p-5 text-sm">
                <Link href={`/admin/orders/${t.order.id}`} className={linkClass}>
                  {t.order.number}
                </Link>
                <p className="text-muted">
                  {t.order.status.toLowerCase()} · {formatMoney(t.order.total)} · {fmtDate(t.order.placedAt)}
                </p>
              </div>
            </Section>
          ) : null}
          <Section title="Ticket">
            <TicketControls id={t.id} status={t.status} priority={t.priority} assigneeId={t.assigneeId} tags={t.tags} agents={agents} me={access.id} />
          </Section>
          {t.others.length ? (
            <Section title="Other tickets from this customer">
              <ul className="divide-y divide-line">
                {t.others.map((o) => (
                  <li key={o.id} className="px-5 py-3 text-sm">
                    <Link href={`/admin/support/${o.id}`} className="block truncate hover:text-gold">
                      #{o.number} {o.subject}
                    </Link>
                    <span className="text-xs text-subtle">
                      {STATUS_LABEL[o.status]} · {fmtDate(o.updatedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {t.merged.length ? (
            <Section title="Merged in">
              <ul className="p-5 text-sm text-muted">
                {t.merged.map((m) => (
                  <li key={m.id}>
                    #{m.number} {m.subject}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {!t.mergedIntoId ? (
            <Section title="Merge">
              <MergeForm id={t.id} />
            </Section>
          ) : null}
        </aside>
      </div>
    </>
  );
}
