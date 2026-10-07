import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { brand } from "@/config/brand";
import { Button } from "@/components/ui/button";
import { MaskedHeading, Reveal } from "@/components/motion/reveal";
import { tradeStatusForVisitor } from "@/server/trade-portal";

export const metadata: Metadata = {
  title: "Trade & wholesale",
  description: `Wholesale incense, oud, bakhoor and candles from ${brand.name} for boutiques, distributors, hotels, spas and corporate gifting.`,
};

const audiences = [
  { title: "Boutiques & concept stores", body: "Small-batch fragrance that sells itself on the shelf, with testers and display guidance." },
  { title: "Distributors", body: "Case-packed SKUs, consistent batches and tiered pricing that leaves room for your margin." },
  { title: "Hotels & restaurants", body: "Signature lobby and suite scenting, refilled on a schedule that suits housekeeping." },
  { title: "Spas & wellness studios", body: "Calm, clean-burning incense and candles for treatment rooms and retail corners." },
  { title: "Corporate gifting", body: "Coffrets and custom blends for clients and teams, wrapped and dispatched to many addresses." },
  { title: "Online stores", body: "Reliable stock, product photography and a price list you can download any time." },
];

const benefits = [
  { n: "01", title: "Trade pricing tiers", body: "Wholesale prices on every tradeable SKU, set by your tier — with sharper prices on the lines you buy most." },
  { n: "02", title: "Case packs", body: "Order in sensible cases with clear minimums, from a quick-order grid built for restocking in minutes." },
  { n: "03", title: "Credit terms", body: "Approved accounts can move to Net 15, 30 or 60 with a credit limit, invoices and a live statement." },
  { n: "04", title: "Private label & custom blends", body: "Your name on our craft, or a scent composed for your space. Request a quote and our perfumers will reply." },
  { n: "05", title: "A dedicated contact", body: "One person on our trade desk who knows your account, your shelves and your seasons." },
];

const steps = [
  { title: "Apply", body: "Tell us about your business in a short form. It takes about three minutes." },
  { title: "We review", body: "Our trade desk reviews every application by hand, usually within two working days." },
  { title: "Order", body: "Once approved, your prices, terms and the quick-order grid are waiting in the trade portal." },
];

const faqs = [
  { q: "Is there a minimum order?", a: "Yes — usually modest, and set by your pricing tier. You’ll see it, and how far you are from it, as you build each order." },
  { q: "Do I need a GSTIN, NTN or VAT number?", a: "Retailers, distributors and online stores reselling our products do. Hotels, spas and corporate gifting buyers can apply without one." },
  { q: "How do payment terms work?", a: "New accounts usually start on prepaid terms: we send a proforma invoice and dispatch once payment arrives. Established accounts can move to Net 15, 30 or 60 with a credit limit." },
  { q: "Can you make a private-label or custom blend?", a: "Yes. Request a quote from the trade portal describing what you have in mind — quantities, packaging, scent direction — and we’ll price it." },
  { q: "Do you ship outside India?", a: "We ship to the Gulf, Pakistan and most of the world. Larger international orders can be quoted for freight." },
  { q: "Can I still buy at retail?", a: "Of course. Your trade account sits alongside your normal account — the bag and checkout stay exactly as they are." },
];

export default async function TradeLandingPage() {
  const visitor = await tradeStatusForVisitor();
  const approved = visitor.status === "APPROVED";
  const primary = approved
    ? { href: "/trade/portal", label: "Open the trade portal" }
    : visitor.status
      ? { href: "/trade/apply", label: "View your application" }
      : { href: "/trade/apply", label: "Apply for a trade account" };

  return (
    <div className="pb-32">
      {/* Hero */}
      <section className="container-luxe grid min-h-[78vh] items-end gap-12 pb-20 pt-24 md:pt-36 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="eyebrow mb-8">{brand.name} · Trade</p>
          <MaskedHeading as="h1" text={"For houses that\nshare the ritual"} italicLine={1} className="text-6xl md:text-8xl" />
        </div>
        <Reveal delay={0.2} className="space-y-8 lg:pb-4">
          <p className="max-w-md text-lg leading-relaxed text-muted">
            Wholesale incense, aged oud, bakhoor and candles for boutiques, distributors, hotels, spas and corporate gifting — composed in the same small batches as everything we make.
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <Button asChild>
              <Link href={primary.href}>
                <span>{primary.label}</span>
              </Link>
            </Button>
            {!approved && (
              <Link href="/trade/portal" className="link-draw eyebrow !text-muted">
                Trade sign in
              </Link>
            )}
          </div>
        </Reveal>
      </section>

      <div className="hairline container-luxe" aria-hidden />

      {/* Who it's for */}
      <section className="container-luxe py-24 md:py-32" aria-labelledby="who">
        <div className="mb-16 grid gap-8 md:grid-cols-[1fr_2fr]">
          <p className="eyebrow" id="who">Who it’s for</p>
          <MaskedHeading text={"Places where fragrance\nis part of the welcome"} italicLine={1} className="text-4xl md:text-6xl" />
        </div>
        <ul className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {audiences.map((a, i) => (
            <li key={a.title} className="bg-bg">
              <Reveal delay={(i % 3) * 0.08} className="h-full p-8 md:p-10">
                <h3 className="font-display text-2xl">{a.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{a.body}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </section>

      {/* Benefits */}
      <section className="bg-bg-elev py-24 md:py-32" aria-labelledby="benefits">
        <div className="container-luxe grid gap-16 lg:grid-cols-[1fr_1.6fr]">
          <div className="lg:sticky lg:top-32 lg:self-start">
            <p className="eyebrow mb-6" id="benefits">What trade partners receive</p>
            <MaskedHeading text={"Built for\nrestocking"} italicLine={1} className="text-5xl md:text-7xl" />
          </div>
          <ol className="divide-y divide-line border-y border-line">
            {benefits.map((b) => (
              <li key={b.n}>
                <Reveal className="grid gap-4 py-10 sm:grid-cols-[4rem_1fr]">
                  <span className="font-display text-2xl italic text-gold">{b.n}</span>
                  <div>
                    <h3 className="font-display text-3xl">{b.title}</h3>
                    <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">{b.body}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* How it works */}
      <section className="container-luxe py-24 md:py-32" aria-labelledby="how">
        <p className="eyebrow mb-6" id="how">How it works</p>
        <MaskedHeading text={"Three steps,\nthen your shelves"} italicLine={1} className="mb-16 text-4xl md:text-6xl" />
        <ol className="grid gap-12 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title}>
              <Reveal delay={i * 0.1}>
                <div className="mb-6 flex items-center gap-4">
                  <span className="flex size-10 items-center justify-center rounded-full border border-gold/50 font-display text-lg text-gold">{i + 1}</span>
                  <span className="h-px flex-1 bg-line-strong" aria-hidden />
                </div>
                <h3 className="font-display text-3xl">{s.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{s.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      {/* FAQ */}
      <section className="container-luxe grid gap-12 py-16 lg:grid-cols-[1fr_2fr]" aria-labelledby="faq">
        <p className="eyebrow" id="faq">Questions</p>
        <div className="divide-y divide-line border-y border-line">
          {faqs.map((f) => (
            <details key={f.q} className="group py-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 font-display text-2xl transition-colors hover:text-gold [&::-webkit-details-marker]:hidden">
                {f.q}
                <span aria-hidden className="text-gold transition-transform duration-500 group-open:rotate-45">+</span>
              </summary>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="container-luxe pt-24">
        <Reveal className="border border-line px-8 py-16 text-center md:px-16 md:py-24">
          <p className="eyebrow mb-6">Begin a trade relationship</p>
          <h2 className="display mx-auto max-w-3xl text-4xl md:text-6xl">
            Bring the house of <span className="italic text-gold">slow fragrance</span> to your guests
          </h2>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-6">
            <Button asChild>
              <Link href={primary.href}>
                <span>{primary.label}</span>
              </Link>
            </Button>
            <a href={`mailto:${brand.email}?subject=Trade%20enquiry`} className="link-draw eyebrow inline-flex items-center gap-2 !text-muted">
              Write to the trade desk <ArrowRight className="size-3" aria-hidden />
            </a>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
