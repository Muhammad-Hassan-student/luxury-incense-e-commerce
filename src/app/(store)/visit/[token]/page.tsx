import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getIntlLocale } from "@/i18n/server";
import { MaskedHeading } from "@/components/motion/reveal";
import { ManageVisit } from "@/components/visit/manage-visit";
import { VisitorPass } from "@/components/visit/visitor-pass";
import { fmtVisitDayIn, fmtVisitTimeIn } from "@/components/visit/format";
import { getAvailability, getVisitByToken, getVisitSettings, visitorCanChange } from "@/server/visits";
import { VISIT_PURPOSES, VISIT_STATUSES, autoConfirms, todayIn } from "@/server/visit-schedule";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("visit.token");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

const HEADLINE_STATUSES = ["REQUESTED", "CONFIRMED", "CHECKED_IN", "COMPLETED", "DECLINED", "CANCELLED", "NO_SHOW"] as const;

export default async function VisitTokenPage(props: PageProps<"/visit/[token]">) {
  const { token } = await props.params;
  const sp = await props.searchParams;
  const visit = await getVisitByToken(token);
  if (!visit) notFound();
  const settings = await getVisitSettings();
  const canChange = visitorCanChange(visit);
  const days = canChange ? await getAvailability({ settings, excludeVisitId: visit.id }) : [];
  const t = await getTranslations("visit.token");
  const tv = await getTranslations("visit");
  const intl = await getIntlLocale();
  const headKey = (HEADLINE_STATUSES as readonly string[]).includes(visit.status) ? (visit.status as (typeof HEADLINE_STATUSES)[number]) : "REQUESTED";
  const head = { title: t(`title_${headKey}`), body: t(`body_${headKey}`) };
  const purpose = (VISIT_PURPOSES as readonly string[]).includes(visit.purpose) ? tv(`purpose_${visit.purpose as (typeof VISIT_PURPOSES)[number]}`) : visit.purpose;
  const status = (VISIT_STATUSES as readonly string[]).includes(visit.status) ? tv(`status_${visit.status as (typeof VISIT_STATUSES)[number]}`) : visit.status;
  const valid = visit.status === "CONFIRMED" || visit.status === "REQUESTED" || visit.status === "CHECKED_IN";
  const justBooked = sp.booked === "1";

  return (
    <div className="container-luxe max-w-5xl pb-32 pt-16 md:pt-24">
      <p className="eyebrow mb-6">{justBooked ? t("eyebrowThanks", { reference: visit.reference }) : t("eyebrow", { reference: visit.reference })}</p>
      <MaskedHeading as="h1" text={head.title} italicLine={1} className="text-5xl md:text-7xl" />
      <p className="mt-6 max-w-xl text-muted" role={justBooked ? "status" : undefined}>
        {justBooked ? t("copySent", { email: visit.email, body: head.body }) : head.body}
      </p>

      <div className="mt-14">
        <VisitorPass
          pass={{
            reference: visit.reference,
            name: visit.name,
            company: visit.company,
            groupSize: visit.groupSize,
            purpose,
            day: fmtVisitDayIn(intl, visit.startsAt, settings.timezone),
            time: fmtVisitTimeIn(intl, visit.startsAt, settings.timezone),
            durationMins: visit.durationMins,
            address: settings.address,
            status,
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
            {t("gettingHere")}
          </h2>
          <address className="whitespace-pre-line text-sm not-italic leading-relaxed text-fg">{settings.address}</address>
          <p className="mt-3 text-sm leading-relaxed text-muted">{settings.directions}</p>
        </div>
        <div>
          <h2 className="eyebrow mb-4">{t("onTheDay")}</h2>
          <p className="text-sm leading-relaxed text-muted">{t("onTheDayBody")}</p>
          {!valid ? (
            <Link href="/visit#book" className="link-draw mt-6 inline-block text-[0.6875rem] uppercase tracking-[0.28em] text-fg">
              {t("bookAnother")}
            </Link>
          ) : null}
        </div>
      </section>
    </div>
  );
}
