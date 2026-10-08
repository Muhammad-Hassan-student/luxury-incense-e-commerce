import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import type { Prisma, Visit, VisitStatus } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Empty, Kpi, PageHeader, Pagination, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { ReceptionActions } from "@/components/admin/visits/reception-actions";
import { VisitStatusBadge, VisitsTabs } from "@/components/admin/visits/ui";
import { WalkInButton } from "@/components/admin/visits/walk-in";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { getVisitSettings } from "@/server/visits";
import {
  VISIT_PURPOSES,
  VISIT_STATUSES,
  addDays,
  fmtClock,
  fmtDayLabel,
  fmtVisitTime,
  purposeLabel,
  slotsForDay,
  statusLabel,
  todayIn,
  zonedParts,
  zonedToUtc,
  type VisitSettings,
} from "@/server/visit-schedule";
import { param, parsePage } from "@/lib/admin-queries";
import { fmtDateTime } from "@/lib/admin-shared";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Visits" };

const PAGE_SIZE = 30;
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export default async function VisitsPage(props: PageProps<"/admin/visits">) {
  await requirePermission("visits.manage");
  const sp = await props.searchParams;
  const view = param(sp.view);
  const s = await getVisitSettings();
  const requested = await db.visit.count({ where: { status: "REQUESTED", startsAt: { gte: new Date() } } });

  if (view === "week") return <WeekView s={s} requested={requested} />;
  if (view === "list") return <ListView s={s} requested={requested} sp={sp} />;
  const dayParam = param(sp.day);
  return <TodayView s={s} requested={requested} day={isDay(dayParam) ? dayParam : todayIn(s.timezone)} />;
}

function NewVisitLink() {
  return (
    <Link href="/admin/visits/new" className="inline-flex h-11 items-center gap-2 bg-gold px-4 text-[0.6875rem] uppercase tracking-[0.2em] text-bg transition-colors hover:bg-fg">
      <Plus className="size-4" aria-hidden /> New visit
    </Link>
  );
}

// ─────────────────────────────── Reception (today) ───────────────────────────────

async function TodayView({ s, day, requested }: { s: VisitSettings; day: string; requested: number }) {
  const today = todayIn(s.timezone);
  const from = zonedToUtc(day, "00:00", s.timezone);
  const to = zonedToUtc(addDays(day, 1), "00:00", s.timezone);
  const visits = await db.visit.findMany({ where: { startsAt: { gte: from, lt: to } }, orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }] });
  const live = visits.filter((v) => v.status !== "CANCELLED" && v.status !== "DECLINED");
  const gone = visits.length - live.length;

  // Group by wall-clock slot; include configured slots with no bookings so the desk sees the whole day.
  const times = new Set(slotsForDay(s, day));
  for (const v of live) times.add(zonedParts(v.startsAt, s.timezone).time);
  const groups = [...times].sort().map((time) => ({ time, visits: live.filter((v) => zonedParts(v.startsAt, s.timezone).time === time) }));

  const expected = live.filter((v) => v.status !== "NO_SHOW").reduce((n, v) => n + v.groupSize, 0);
  const arrived = live.filter((v) => v.status === "CHECKED_IN" || v.status === "COMPLETED").reduce((n, v) => n + v.groupSize, 0);
  const waiting = live.filter((v) => v.status === "CONFIRMED" || v.status === "REQUESTED").length;
  const nav = "inline-flex size-11 items-center justify-center border border-line text-fg transition-colors hover:border-gold hover:text-gold";

  return (
    <>
      <PageHeader
        eyebrow={day === today ? "Reception · today" : "Reception"}
        title={fmtDayLabel(day, { year: true })}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {day === today ? <WalkInButton /> : null}
            <NewVisitLink />
            <Link href={`/admin/visits?day=${addDays(day, -1)}`} className={nav} aria-label="Previous day">
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
            {day !== today ? (
              <Link href="/admin/visits" className="inline-flex h-11 items-center border border-line px-4 text-[0.6875rem] uppercase tracking-[0.2em] hover:border-gold hover:text-gold">
                Today
              </Link>
            ) : null}
            <Link href={`/admin/visits?day=${addDays(day, 1)}`} className={nav} aria-label="Next day">
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          </div>
        }
      >
        {s.timezone} · capacity {s.capacityPerSlot} per slot
      </PageHeader>
      <VisitsTabs active="today" requested={requested} />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Guests expected" value={expected} hint={`${live.length} booking${live.length === 1 ? "" : "s"}`} />
        <Kpi label="Arrived" value={arrived} hint={expected ? `${Math.round((arrived / expected) * 100)}% of guests` : undefined} />
        <Kpi label="Still to arrive" value={waiting} hint="bookings" />
        <Kpi label="Awaiting confirmation" value={<Link href="/admin/visits?view=list&status=REQUESTED" className={linkClass}>{requested}</Link>} hint="upcoming requests" />
      </div>

      {groups.length ? (
        <div className="space-y-8">
          {groups.map((g) => {
            const held = g.visits.filter((v) => v.status !== "NO_SHOW").reduce((n, v) => n + v.groupSize, 0);
            return (
              <Section
                key={g.time}
                title={fmtClock(g.time)}
                actions={
                  <span className="text-xs tabular-nums text-muted">
                    {held} / {s.capacityPerSlot} guests
                  </span>
                }
              >
                {g.visits.length ? (
                  <ul className="divide-y divide-line">
                    {g.visits.map((v) => (
                      <ReceptionRow key={v.id} v={v} tz={s.timezone} />
                    ))}
                  </ul>
                ) : (
                  <Empty>No bookings for this slot.</Empty>
                )}
              </Section>
            );
          })}
        </div>
      ) : (
        <Section title="No visits">
          <Empty>The atelier isn’t open to visitors on this day.</Empty>
        </Section>
      )}
      {gone ? (
        <p className="mt-6 text-xs text-subtle">
          {gone} cancelled or declined booking{gone === 1 ? "" : "s"} hidden.{" "}
          <Link href={`/admin/visits?view=list&from=${day}&to=${day}`} className={linkClass}>
            See all
          </Link>
        </p>
      ) : null}
    </>
  );
}

function ReceptionRow({ v, tz }: { v: Visit; tz: string }) {
  return (
    <li className={cn("grid gap-5 px-5 py-6 md:grid-cols-[1fr_auto] md:items-center", v.status === "COMPLETED" && "opacity-60")}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/admin/visits/${v.id}`} className="font-display text-2xl text-fg hover:text-gold md:text-3xl">
            {v.name}
          </Link>
          <VisitStatusBadge status={v.status} />
        </div>
        <p className="mt-2 text-sm text-muted">
          <span className="font-display text-lg text-fg">{v.groupSize}</span> {v.groupSize === 1 ? "guest" : "guests"} · {purposeLabel(v.purpose)}
          {v.company ? ` · ${v.company}` : ""} · <span className="font-mono text-xs">{v.reference}</span>
        </p>
        <p className="mt-1 text-xs text-subtle">
          {v.phone ? (
            <a href={`tel:${v.phone.replace(/[^\d+]/g, "")}`} className="hover:text-gold">
              {v.phone}
            </a>
          ) : null}
          {v.checkedInAt ? `${v.phone ? " · " : ""}arrived ${fmtVisitTime(v.checkedInAt, tz)}` : ""}
        </p>
        {v.staffNotes ? <p className="mt-2 line-clamp-2 text-xs italic text-muted">{v.staffNotes}</p> : null}
      </div>
      <ReceptionActions id={v.id} name={v.name} status={v.status} />
    </li>
  );
}

// ─────────────────────────────── Next 7 days ───────────────────────────────

async function WeekView({ s, requested }: { s: VisitSettings; requested: number }) {
  const today = todayIn(s.timezone);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const visits = await db.visit.findMany({
    where: { startsAt: { gte: zonedToUtc(today, "00:00", s.timezone), lt: zonedToUtc(addDays(today, 7), "00:00", s.timezone) }, status: { notIn: ["CANCELLED", "DECLINED"] } },
    orderBy: { startsAt: "asc" },
  });
  const byDay = new Map<string, Visit[]>();
  for (const v of visits) {
    const d = zonedParts(v.startsAt, s.timezone).day;
    byDay.set(d, [...(byDay.get(d) ?? []), v]);
  }

  return (
    <>
      <PageHeader eyebrow="Visits" title="Next 7 days" actions={<NewVisitLink />}>
        {visits.length} booking{visits.length === 1 ? "" : "s"} · {visits.reduce((n, v) => n + v.groupSize, 0)} guests
      </PageHeader>
      <VisitsTabs active="week" requested={requested} />
      <div className="space-y-6">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const open = slotsForDay(s, d).length > 0;
          return (
            <Section
              key={d}
              title={`${fmtDayLabel(d, { weekday: "short" })}${d === today ? " · today" : ""}`}
              actions={
                <Link href={`/admin/visits?day=${d}`} className="text-xs uppercase tracking-[0.18em] text-muted hover:text-gold">
                  Reception view
                </Link>
              }
            >
              {list.length ? (
                <ul className="divide-y divide-line">
                  {list.map((v) => (
                    <li key={v.id}>
                      <Link href={`/admin/visits/${v.id}`} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-4 px-5 py-3 text-sm transition-colors hover:bg-bg-soft sm:grid-cols-[5rem_1fr_8rem_auto]">
                        <span className="font-display text-lg tabular-nums text-fg">{fmtClock(zonedParts(v.startsAt, s.timezone).time)}</span>
                        <span className="min-w-0 truncate">
                          {v.name}
                          <span className="text-muted"> · {v.groupSize} · {purposeLabel(v.purpose)}</span>
                        </span>
                        <span className="hidden font-mono text-xs text-subtle sm:block">{v.reference}</span>
                        <VisitStatusBadge status={v.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>{open ? "No bookings yet." : "Closed to visitors."}</Empty>
              )}
            </Section>
          );
        })}
      </div>
    </>
  );
}

// ─────────────────────────────── List ───────────────────────────────

type SP = Record<string, string | string[] | undefined>;

async function ListView({ s, requested, sp }: { s: VisitSettings; requested: number; sp: SP }) {
  const status = param(sp.status);
  const purpose = param(sp.purpose);
  const from = param(sp.from);
  const to = param(sp.to);
  const q = param(sp.q).slice(0, 100);
  const page = parsePage(sp.page);

  const where: Prisma.VisitWhereInput = {};
  if ((VISIT_STATUSES as readonly string[]).includes(status)) where.status = status as VisitStatus;
  if ((VISIT_PURPOSES as readonly string[]).includes(purpose)) where.purpose = purpose;
  const range: Prisma.DateTimeFilter = {};
  if (isDay(from)) range.gte = zonedToUtc(from, "00:00", s.timezone);
  if (isDay(to)) range.lt = zonedToUtc(addDays(to, 1), "00:00", s.timezone);
  if (range.gte || range.lt) where.startsAt = range;
  if (q) {
    const contains = { contains: q, mode: "insensitive" as const };
    where.OR = [{ name: contains }, { email: contains }, { reference: contains }, { company: contains }, { phone: contains }];
  }

  const [total, visits] = await Promise.all([
    db.visit.count({ where }),
    db.visit.findMany({ where, orderBy: { startsAt: range.gte ? "asc" : "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (p: number) => {
    const u = new URLSearchParams({ view: "list" });
    for (const [k, v] of Object.entries({ status, purpose, from, to, q })) if (v) u.set(k, v);
    if (p > 1) u.set("page", String(p));
    return `/admin/visits?${u}`;
  };

  return (
    <>
      <PageHeader eyebrow="Visits" title="All visits" actions={<NewVisitLink />}>
        {total} visit{total === 1 ? "" : "s"}
      </PageHeader>
      <VisitsTabs active="list" requested={requested} />

      <form method="get" action="/admin/visits" className="mb-8 grid gap-5 border border-line bg-bg-elev p-5 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto] lg:items-end">
        <input type="hidden" name="view" value="list" />
        <label className="block">
          <span className="eyebrow !text-muted">Search</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-0 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
            <Input name="q" defaultValue={q} placeholder="Name, email, reference…" className="ps-6" />
          </div>
        </label>
        <label className="block">
          <span className="eyebrow !text-muted">Status</span>
          <Select name="status" defaultValue={status}>
            <option value="">Any</option>
            {VISIT_STATUSES.map((x) => (
              <option key={x} value={x}>
                {statusLabel(x)}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="eyebrow !text-muted">Purpose</span>
          <Select name="purpose" defaultValue={purpose}>
            <option value="">Any</option>
            {VISIT_PURPOSES.map((x) => (
              <option key={x} value={x}>
                {purposeLabel(x)}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="eyebrow !text-muted">From</span>
          <Input type="date" name="from" defaultValue={isDay(from) ? from : ""} />
        </label>
        <label className="block">
          <span className="eyebrow !text-muted">To</span>
          <Input type="date" name="to" defaultValue={isDay(to) ? to : ""} />
        </label>
        <div className="flex gap-3">
          <Button type="submit" size="sm">
            Filter
          </Button>
          <Link href="/admin/visits?view=list" className="inline-flex h-9 items-center px-2 text-[0.6875rem] uppercase tracking-[0.2em] text-muted hover:text-gold">
            Reset
          </Link>
        </div>
      </form>

      <Section title="Visits">
        {visits.length ? (
          <>
            <Table className="min-w-[860px]">
              <thead>
                <tr>
                  <Th>Reference</Th>
                  <Th>When</Th>
                  <Th>Guest</Th>
                  <Th>Purpose</Th>
                  <Th className="text-right">Party</Th>
                  <Th>Status</Th>
                  <Th>Booked</Th>
                </tr>
              </thead>
              <tbody>
                {visits.map((v) => {
                  const z = zonedParts(v.startsAt, s.timezone);
                  return (
                    <tr key={v.id} className="transition-colors hover:bg-bg-soft">
                      <Td>
                        <Link href={`/admin/visits/${v.id}`} className={cn("font-mono", linkClass)}>
                          {v.reference}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {fmtDayLabel(z.day, { weekday: "short", year: true })}
                        <span className="text-muted"> · {fmtClock(z.time)}</span>
                      </Td>
                      <Td>
                        <p>{v.name}</p>
                        <p className="text-xs text-subtle">
                          {v.email}
                          {v.company ? ` · ${v.company}` : ""}
                        </p>
                      </Td>
                      <Td className="text-muted">{purposeLabel(v.purpose)}</Td>
                      <Td className="text-right tabular-nums">{v.groupSize}</Td>
                      <Td>
                        <VisitStatusBadge status={v.status} />
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(v.createdAt)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={page} pages={pages} href={qs} />
          </>
        ) : (
          <Empty>No visits match these filters.</Empty>
        )}
      </Section>
    </>
  );
}
