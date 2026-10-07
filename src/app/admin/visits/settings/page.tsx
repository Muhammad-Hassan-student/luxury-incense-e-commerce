import Link from "next/link";
import { PageHeader, Section, linkClass } from "@/components/admin/ui";
import { VisitSettingsForm } from "@/components/admin/visits/visit-settings-form";
import { VisitsTabs } from "@/components/admin/visits/ui";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { getVisitSettings } from "@/server/visits";
import { bookableDays, bookableWindow, fmtDayLabel } from "@/server/visit-schedule";

export const dynamic = "force-dynamic";
export const metadata = { title: "Visit availability" };

export default async function VisitSettingsPage() {
  await requirePermission("visits.manage");
  const [s, requested] = await Promise.all([getVisitSettings(), db.visit.count({ where: { status: "REQUESTED", startsAt: { gte: new Date() } } })]);
  const w = bookableWindow(s);
  const open = bookableDays(s).length;

  return (
    <>
      <PageHeader eyebrow="Visits" title="Availability">
        Visitors can book from {fmtDayLabel(w.first, { weekday: "short" })} to {fmtDayLabel(w.last, { weekday: "short", year: true })}: {open} open day{open === 1 ? "" : "s"}.{" "}
        <Link href="/visit" target="_blank" className={linkClass}>
          View booking page
        </Link>
      </PageHeader>
      <VisitsTabs active="settings" requested={requested} />
      <Section title="Visiting hours & rules">
        <VisitSettingsForm initial={s} />
      </Section>
      <p className="mt-6 text-xs text-subtle">
        Changes apply to new bookings immediately. Existing visits keep their times; move them from each visit’s page if a slot disappears.
      </p>
    </>
  );
}
