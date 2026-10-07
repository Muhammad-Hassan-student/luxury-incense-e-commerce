import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MaskedHeading } from "@/components/motion/reveal";
import { ManageVisit } from "@/components/visit/manage-visit";
import { VisitorPass } from "@/components/visit/visitor-pass";
import { getAvailability, getVisitByToken, getVisitSettings, visitorCanChange } from "@/server/visits";
import { autoConfirms, fmtVisitDay, fmtVisitTime, purposeLabel, statusLabel, todayIn } from "@/server/visit-schedule";

export const metadata: Metadata = { title: "Your visit", robots: { index: false, follow: false } };

const HEADLINES: Record<string, { title: string; body: string }> = {
  REQUESTED: { title: "Requested,\nawaiting confirmation", body: "Your places are held. We’ll email you as soon as a member of the house has confirmed, usually within one working day." },
  CONFIRMED: { title: "We look forward\nto welcoming you", body: "Your visit is confirmed. Show this pass at the gate, printed or on your phone." },
  CHECKED_IN: { title: "Welcome to\nthe atelier", body: "You’re checked in. Enjoy the visit." },
  COMPLETED: { title: "Thank you\nfor visiting", body: "We hope you left smelling faintly of smoke and resin. Come back whenever you like." },
  DECLINED: { title: "We couldn’t\nhost this visit", body: "We’re sorry we weren’t able to welcome you at this time. You’re welcome to request another day." },
  CANCELLED: { title: "This visit is\ncancelled", body: "The places have been released. You’re welcome to book again whenever suits you." },
  NO_SHOW: { title: "We missed\nyou", body: "We kept your places but didn’t see you. If you’d still like to visit, book another time." },
};

export default async function VisitTokenPage(props: PageProps<"/visit/[token]">) {
  const { token } = await props.params;
  const sp = await props.searchParams;
  const visit = await getVisitByToken(token);
  if (!visit) notFound();
  const settings = await getVisitSettings();
  const canChange = visitorCanChange(visit);
  const days = canChange ? await getAvailability({ settings, excludeVisitId: visit.id }) : [];
  const head = HEADLINES[visit.status] ?? HEADLINES.REQUESTED!;
  const valid = visit.status === "CONFIRMED" || visit.status === "REQUESTED" || visit.status === "CHECKED_IN";
  const justBooked = sp.booked === "1";

  return (
    <div className="container-luxe max-w-5xl pb-32 pt-16 md:pt-24">
      <p className="eyebrow mb-6">{justBooked ? "Thank you" : "Your visit"} · {visit.reference}</p>
      <MaskedHeading as="h1" text={head.title} italicLine={1} className="text-5xl md:text-7xl" />
      <p className="mt-6 max-w-xl text-muted" role={justBooked ? "status" : undefined}>
        {justBooked ? `A copy is on its way to ${visit.email}. ` : ""}
        {head.body}
      </p>

      <div className="mt-14">
        <VisitorPass
          pass={{
            reference: visit.reference,
            name: visit.name,
            company: visit.company,
            groupSize: visit.groupSize,
            purpose: purposeLabel(visit.purpose),
            day: fmtVisitDay(visit.startsAt, settings.timezone),
            time: fmtVisitTime(visit.startsAt, settings.timezone),
            durationMins: visit.durationMins,
            address: settings.address,
            status: statusLabel(visit.status),
            valid,
          }}
        />
      </div>

      <div className="mt-10">
        <ManageVisit
          token={visit.token}
          canChange={canChange}
          days={days}
          today={todayIn(settings.timezone)}
          groupSize={visit.groupSize}
          slotMinutes={settings.slotMinutes}
          willAutoConfirm={autoConfirms(settings, visit.groupSize)}
          showCalendar={valid}
        />
      </div>

      <section aria-labelledby="getting-here" className="visit-noprint mt-20 grid gap-10 border-t border-line pt-12 md:grid-cols-2">
        <div>
          <h2 id="getting-here" className="eyebrow mb-4">
            Getting here
          </h2>
          <address className="whitespace-pre-line text-sm not-italic leading-relaxed text-fg">{settings.address}</address>
          <p className="mt-3 text-sm leading-relaxed text-muted">{settings.directions}</p>
        </div>
        <div>
          <h2 className="eyebrow mb-4">On the day</h2>
          <p className="text-sm leading-relaxed text-muted">
            Wear closed shoes and leave your own perfume at home. Arrive five minutes early; the gate opens a quarter of an hour before each visit. Keep this page: it’s your link to change or cancel.
          </p>
          {!valid ? (
            <Link href="/visit#book" className="link-draw mt-6 inline-block text-[0.6875rem] uppercase tracking-[0.28em] text-fg">
              Book another visit
            </Link>
          ) : null}
        </div>
      </section>
    </div>
  );
}
