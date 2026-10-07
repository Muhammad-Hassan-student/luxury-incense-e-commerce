import type { Metadata } from "next";
import { auth } from "@/auth";
import { brand } from "@/config/brand";
import { MaskedHeading, Reveal } from "@/components/motion/reveal";
import { BookingFlow } from "@/components/visit/booking-flow";
import { getAvailability, getVisitSettings } from "@/server/visits";
import { todayIn } from "@/server/visit-schedule";

export const metadata: Metadata = {
  title: "Visit the atelier",
  description: `Book a visit to the ${brand.name} atelier: hand-rolling, deg-bhapka distillation and the blending room. Tours, workshops, trade and press.`,
};

const SEE = [
  {
    n: "I",
    title: "The rolling tables",
    body: "Bamboo slivers dipped, rolled and rolled again in charcoal, jigat and resin by hands that have done it for thirty years. You’ll be offered a stick to try. It’s harder than it looks.",
  },
  {
    n: "II",
    title: "The still room",
    body: "Copper deg and bhapka pots over wood fire: the centuries-old way of drawing attar from rose, vetiver and monsoon earth into sandalwood oil. Slow, warm and fragrant.",
  },
  {
    n: "III",
    title: "The blending room",
    body: "Where aged oud, bakhoor and candle blends are composed and left to rest. Smell the raw materials side by side, and the same blend at one week and one year.",
  },
];

export default async function VisitPage() {
  const [settings, session] = await Promise.all([getVisitSettings(), auth()]);
  const days = await getAvailability({ settings });
  const today = todayIn(settings.timezone);
  const weekdays = Object.entries(settings.weekly).filter(([, slots]) => slots.length).length;

  return (
    <div className="pb-32">
      {/* Opening */}
      <header className="container-luxe pt-16 md:pt-24">
        <p className="eyebrow mb-6">The atelier</p>
        <MaskedHeading as="h1" text={"Come and\nsmell the smoke"} italicLine={1} className="text-6xl md:text-9xl" />
        <div className="mt-10 grid gap-10 md:grid-cols-[1.2fr_1fr] md:gap-20">
          <p className="max-w-xl text-lg leading-relaxed text-muted">
            Everything we make is rolled, distilled and blended under one roof. We open the doors {weekdays} days a week to small groups: the curious, the trade, the press, and anyone who wants to
            see how slow fragrance is made.
          </p>
          <div className="flex flex-col justify-end gap-4 md:items-end">
            <a
              href="#book"
              className="link-draw self-start text-[0.6875rem] uppercase tracking-[0.28em] text-fg md:self-end"
            >
              Book a visit
            </a>
            <p className="text-xs text-subtle">About {settings.slotMinutes} minutes · up to {settings.maxGroupSize} guests per booking · free of charge</p>
          </div>
        </div>
      </header>

      <div className="container-luxe">
        <div className="hairline my-20 md:my-28" />
      </div>

      {/* What you'll see */}
      <section aria-labelledby="see-title" className="container-luxe">
        <h2 id="see-title" className="eyebrow mb-12">
          What you’ll see
        </h2>
        <ol className="grid gap-px border border-line bg-line md:grid-cols-3">
          {SEE.map((s, i) => (
            <li key={s.n} className="bg-bg p-8 md:p-10">
              <Reveal delay={i * 0.08} y={24}>
                <span className="font-display text-xl italic text-gold">{s.n}</span>
                <h3 className="mt-6 font-display text-3xl font-light text-fg md:text-4xl">{s.title}</h3>
                <p className="mt-4 text-sm leading-relaxed text-muted">{s.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      {/* Practicalities */}
      <section aria-labelledby="know-title" className="container-luxe mt-24 md:mt-32">
        <h2 id="know-title" className="eyebrow mb-12">
          Before you come
        </h2>
        <div className="grid gap-12 md:grid-cols-3 md:gap-16">
          <Reveal y={24}>
            <h3 className="font-display text-2xl text-fg">How long</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              About {settings.slotMinutes} minutes, ending with tea and a smelling of the current batches. Workshops run a little longer; we’ll let you know.
            </p>
          </Reveal>
          <Reveal y={24} delay={0.08}>
            <h3 className="font-display text-2xl text-fg">What to wear</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Closed shoes, clothes you don’t mind smelling of smoke, and no perfume of your own, so you can smell ours. The still room is warm; the floors are stone.
            </p>
          </Reveal>
          <Reveal y={24} delay={0.16}>
            <h3 className="font-display text-2xl text-fg">Getting here</h3>
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
            <p className="eyebrow mb-4">Reservations</p>
            <h2 id="book-title" className="display text-5xl md:text-7xl">
              Book your <span className="italic text-gold">visit</span>
            </h2>
          </div>
          <p className="max-w-sm text-sm text-muted">
            Bookable from {settings.leadDays === 0 ? "today" : `${settings.leadDays} day${settings.leadDays === 1 ? "" : "s"} ahead`}, up to {settings.horizonDays} days out.
            {settings.autoConfirm.enabled ? ` Parties of ${settings.autoConfirm.maxGroupSize} or fewer are confirmed instantly.` : ""}
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
