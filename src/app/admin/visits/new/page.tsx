import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Section } from "@/components/admin/ui";
import { CreateVisitForm } from "@/components/admin/visits/create-visit-form";
import { requirePermission } from "@/server/roles";
import { getAvailability, getVisitSettings } from "@/server/visits";

export const dynamic = "force-dynamic";
export const metadata = { title: "New visit" };

export default async function NewVisitPage() {
  await requirePermission("visits.manage");
  const settings = await getVisitSettings();
  const days = await getAvailability({ settings, staff: true });

  return (
    <>
      <Link href="/admin/visits" className="mb-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted hover:text-gold">
        <ArrowLeft className="size-3.5" aria-hidden /> Visits
      </Link>
      <PageHeader eyebrow="Visits" title="New visit">
        Book a visit for someone who called or wrote in. It’s confirmed straight away.
      </PageHeader>
      <Section title="Booking">
        <CreateVisitForm days={days} capacity={settings.capacityPerSlot} durationMins={settings.slotMinutes} timezone={settings.timezone} />
      </Section>
    </>
  );
}
