import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Section, linkClass } from "@/components/admin/ui";
import { ReceptionActions } from "@/components/admin/visits/reception-actions";
import { VisitStatusBadge } from "@/components/admin/visits/ui";
import { TradeInvite, VisitDecisionActions, VisitNotes } from "@/components/admin/visits/visit-actions";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { getAvailability, getVisitSettings } from "@/server/visits";
import { fmtVisitDay, fmtVisitTime, purposeLabel } from "@/server/visit-schedule";
import { fmtDateTime } from "@/lib/admin-shared";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/admin/visits/[id]">) {
  const { id } = await props.params;
  const v = await db.visit.findUnique({ where: { id }, select: { reference: true } });
  return { title: v ? `Visit ${v.reference}` : "Visit" };
}

const ACTION_LABEL: Record<string, string> = {
  "visit.confirmed": "Confirmed",
  "visit.declined": "Declined",
  "visit.cancelled": "Cancelled",
  "visit.checked_in": "Checked in",
  "visit.completed": "Completed",
  "visit.no_show": "Marked no-show",
  "visit.reschedule": "Rescheduled",
  "visit.notes": "Notes edited",
  "visit.trade_invite": "Trade invitation sent",
};

export default async function VisitDetailPage(props: PageProps<"/admin/visits/[id]">) {
  await requirePermission("visits.manage");
  const { id } = await props.params;
  const v = await db.visit.findUnique({ where: { id }, include: { user: { select: { id: true, email: true, name: true } } } });
  if (!v) notFound();
  const s = await getVisitSettings();
  const open = v.status === "REQUESTED" || v.status === "CONFIRMED";
  const [days, history, others] = await Promise.all([
    open ? getAvailability({ settings: s, excludeVisitId: v.id, staff: true }) : Promise.resolve([]),
    db.auditLog.findMany({ where: { entity: "Visit", entityId: v.id }, orderBy: { createdAt: "desc" }, take: 50, include: { actor: { select: { name: true, email: true } } } }),
    db.visit.count({ where: { email: v.email, id: { not: v.id } } }),
  ]);

  const facts: [string, ReactNode][] = [
    ["When", `${fmtVisitDay(v.startsAt, s.timezone)}, ${fmtVisitTime(v.startsAt, s.timezone)} · ${v.durationMins} min`],
    ["Purpose", purposeLabel(v.purpose)],
    ["Party", `${v.groupSize} ${v.groupSize === 1 ? "guest" : "guests"}`],
    ["Name", v.name],
    ["Company", v.company ?? "—"],
    [
      "Email",
      <a key="e" href={`mailto:${v.email}`} className={linkClass}>
        {v.email}
      </a>,
    ],
    [
      "Phone",
      <a key="p" href={`tel:${v.phone.replace(/[^\d+]/g, "")}`} className={linkClass}>
        {v.phone}
      </a>,
    ],
    ["Checked in", v.checkedInAt ? fmtVisitTime(v.checkedInAt, s.timezone) : "—"],
    ["Booked", fmtDateTime(v.createdAt)],
    [
      "Account",
      v.user ? (
        <Link key="u" href={`/admin/customers?q=${encodeURIComponent(v.user.email)}`} className={linkClass}>
          {v.user.name ?? v.user.email}
        </Link>
      ) : (
        "Guest booking"
      ),
    ],
  ];

  return (
    <>
      <Link href="/admin/visits?view=list" className="mb-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted hover:text-gold">
        <ArrowLeft className="size-3.5" aria-hidden /> Visits
      </Link>
      <PageHeader
        eyebrow={`Visit ${v.reference}`}
        title={v.name}
        actions={
          <div className="flex items-center gap-4">
            <Link href={`/visit/${v.token}`} target="_blank" className={`text-xs uppercase tracking-[0.2em] ${linkClass}`}>
              Visitor’s page
            </Link>
            <VisitStatusBadge status={v.status} />
          </div>
        }
      >
        {fmtVisitDay(v.startsAt, s.timezone)} · {fmtVisitTime(v.startsAt, s.timezone)}
        {others ? (
          <>
            {" · "}
            <Link href={`/admin/visits?view=list&q=${encodeURIComponent(v.email)}`} className={linkClass}>
              {others} other visit{others === 1 ? "" : "s"}
            </Link>
          </>
        ) : null}
      </PageHeader>

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-8">
          <Section title="Booking">
            <dl className="divide-y divide-line">
              {facts.map(([k, val]) => (
                <div key={k} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[9rem_1fr]">
                  <dt className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">{k}</dt>
                  <dd className="text-fg">{val}</dd>
                </div>
              ))}
            </dl>
            {v.message ? (
              <div className="border-t border-line px-5 py-4">
                <p className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">Message from the visitor</p>
                <p className="mt-2 whitespace-pre-line font-display text-lg italic text-fg">“{v.message}”</p>
              </div>
            ) : null}
          </Section>

          <Section title="Decision">
            <div className="p-5">
              <VisitDecisionActions id={v.id} status={v.status} groupSize={v.groupSize} days={days} />
            </div>
          </Section>

          <Section title="Reception">
            <div className="p-5">
              {["REQUESTED", "CONFIRMED", "CHECKED_IN", "NO_SHOW"].includes(v.status) ? (
                <ReceptionActions id={v.id} name={v.name} status={v.status} size="sm" />
              ) : (
                <p className="text-sm text-muted">Nothing to do at the desk.</p>
              )}
            </div>
          </Section>
        </div>

        <div className="space-y-8">
          <Section title="Notes">
            <div className="p-5">
              <VisitNotes key={v.updatedAt.toISOString()} id={v.id} initial={v.staffNotes ?? ""} />
            </div>
          </Section>
          {v.purpose === "WHOLESALE" ? (
            <Section title="Trade">
              <div className="p-5">
                <TradeInvite id={v.id} email={v.email} />
              </div>
            </Section>
          ) : null}
          <Section title="History">
            {history.length ? (
              <ol className="divide-y divide-line">
                {history.map((h) => {
                  const meta = h.meta && typeof h.meta === "object" && !Array.isArray(h.meta) ? (h.meta as Record<string, unknown>) : {};
                  return (
                    <li key={h.id} className="px-5 py-3 text-sm">
                      <p className="text-fg">{ACTION_LABEL[h.action] ?? h.action}</p>
                      {typeof meta.reason === "string" ? <p className="mt-1 text-xs italic text-muted">“{meta.reason}”</p> : null}
                      {typeof meta.to === "string" && h.action === "visit.reschedule" ? (
                        <p className="mt-1 text-xs text-muted">to {fmtVisitDay(new Date(meta.to), s.timezone)}, {fmtVisitTime(new Date(meta.to), s.timezone)}</p>
                      ) : null}
                      <p className="mt-1 text-xs text-subtle">
                        {h.actor.name ?? h.actor.email} · {fmtDateTime(h.createdAt)}
                      </p>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="px-5 py-6 text-sm text-muted">No staff changes yet.</p>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
