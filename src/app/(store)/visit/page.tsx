import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { brand } from "@/config/brand";
import { MaskedHeading, Reveal } from "@/components/motion/reveal";
import { BookingFlow } from "@/components/visit/booking-flow";
import { getAvailability, getVisitSettings } from "@/server/visits";
import { todayIn } from "@/server/visit-schedule";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("visit.page");
  return { title: t("metaTitle"), description: t("metaDescription", { brand: brand.name }) };
}

const SEE = [
  { n: "I", key: "rolling" },
  { n: "II", key: "still" },
  { n: "III", key: "blending" },
] as const;

export default async function VisitPage() {
  const [settings, session] = await Promise.all([getVisitSettings(), auth()]);
  const days = await getAvailability({ settings });
  const today = todayIn(settings.timezone);
  const weekdays = Object.entries(settings.weekly).filter(([, slots]) => slots.length).length;
  const t = await getTranslations("visit.page");

  return (
    <div className="pb-32">
      {/* Opening */}
      <header className="container-luxe pt-16 md:pt-24">
        <p className="eyebrow mb-6">{t("eyebrow")}</p>
        <MaskedHeading as="h1" text={t("title")} italicLine={1} className="text-6xl md:text-9xl" />
        <div className="mt-10 grid gap-10 md:grid-cols-[1.2fr_1fr] md:gap-20">
          <p className="max-w-xl text-lg leading-relaxed text-muted">
            {t("intro", { days: weekdays })}
          </p>
          <div className="flex flex-col justify-end gap-4 md:items-end">
            <a
              href="#book"
              className="link-draw self-start text-[0.6875rem] uppercase tracking-[0.28em] text-fg md:self-end"
            >
              {t("bookCta")}
            </a>
            <p className="text-xs text-subtle">{t("facts", { minutes: settings.slotMinutes, max: settings.maxGroupSize })}</p>
          </div>
        </div>
      </header>

      <div className="container-luxe">
        <div className="hairline my-20 md:my-28" />
      </div>

      {/* What you'll see */}
      <section aria-labelledby="see-title" className="container-luxe">
        <h2 id="see-title" className="eyebrow mb-12">
          {t("seeTitle")}
        </h2>
        <ol className="grid gap-px border border-line bg-line md:grid-cols-3">
          {SEE.map((s, i) => (
            <li key={s.key} className="bg-bg p-8 md:p-10">
              <Reveal delay={i * 0.08} y={24}>
                <span className="font-display text-xl italic text-gold">{s.n}</span>
                <h3 className="mt-6 font-display text-3xl font-light text-fg md:text-4xl">{t(`see.${s.key}.title`)}</h3>
                <p className="mt-4 text-sm leading-relaxed text-muted">{t(`see.${s.key}.body`)}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      {/* Practicalities */}
      <section aria-labelledby="know-title" className="container-luxe mt-24 md:mt-32">
        <h2 id="know-title" className="eyebrow mb-12">
          {t("knowTitle")}
        </h2>
        <div className="grid gap-12 md:grid-cols-3 md:gap-16">
          <Reveal y={24}>
            <h3 className="font-display text-2xl text-fg">{t("howLong")}</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted">{t("howLongBody", { minutes: settings.slotMinutes })}</p>
          </Reveal>
          <Reveal y={24} delay={0.08}>
            <h3 className="font-display text-2xl text-fg">{t("wear")}</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted">{t("wearBody")}</p>
          </Reveal>
          <Reveal y={24} delay={0.16}>
            <h3 className="font-display text-2xl text-fg">{t("gettingHere")}</h3>
            <address className="mt-3 whitespace-pre-line text-sm not-italic leading-relaxed text-fg">{settings.address}</address>
            <p className="mt-3 text-sm leading-relaxed text-muted">{settings.directions}</p>
          </Reveal>
        </div>
      </section>

      <div className="container-luxe">
        <div className="hairline my-20 md:my-28" />
      </div>

      {/* Booking */}
      <section aria-labelledby="book-title" className="container-luxe">
        <div className="mb-12 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="eyebrow mb-4">{t("reservations")}</p>
            <h2 id="book-title" className="display text-5xl md:text-7xl">
              {t.rich("bookTitle", { em: (c) => <span className="italic text-gold">{c}</span> })}
            </h2>
          </div>
          <p className="max-w-sm text-sm text-muted">
            {settings.leadDays === 0 ? t("bookableToday", { horizon: settings.horizonDays }) : t("bookableAhead", { lead: settings.leadDays, horizon: settings.horizonDays })}
            {settings.autoConfirm.enabled ? ` ${t("autoConfirm", { max: settings.autoConfirm.maxGroupSize })}` : ""}
          </p>
        </div>
        <BookingFlow
          initialDays={days}
          today={today}
          config={{ maxGroupSize: settings.maxGroupSize, slotMinutes: settings.slotMinutes, autoConfirm: settings.autoConfirm }}
          prefill={{ name: session?.user?.name ?? "", email: session?.user?.email ?? "" }}
        />
      </section>
    </div>
  );
}
