import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { brand } from "@/config/brand";
import { Button } from "@/components/ui/button";
import { MaskedHeading, Reveal } from "@/components/motion/reveal";
import { tradeStatusForVisitor } from "@/server/trade-portal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("trade.landing");
  return { title: t("metaTitle"), description: t("metaDescription", { brand: brand.name }) };
}

const audiences = ["boutiques", "distributors", "hotels", "spas", "corporate", "online"] as const;
const benefits = ["tiers", "cases", "credit", "privateLabel", "contact"] as const;
const steps = ["apply", "review", "order"] as const;
const faqs = ["minimum", "taxId", "terms", "custom", "shipping", "retail"] as const;

export default async function TradeLandingPage() {
  const t = await getTranslations("trade.landing");
  const visitor = await tradeStatusForVisitor();
  const approved = visitor.status === "APPROVED";
  const primary = approved
    ? { href: "/trade/portal", label: t("ctaPortal") }
    : visitor.status
      ? { href: "/trade/apply", label: t("ctaView") }
      : { href: "/trade/apply", label: t("ctaApply") };

  return (
    <div className="pb-32">
      {/* Hero */}
      <section className="container-luxe grid min-h-[78vh] items-end gap-12 pb-20 pt-24 md:pt-36 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="eyebrow mb-8">{t("eyebrow", { brand: brand.name })}</p>
          <MaskedHeading as="h1" text={t("heroTitle")} italicLine={1} className="text-6xl md:text-8xl" />
        </div>
        <Reveal delay={0.2} className="space-y-8 lg:pb-4">
          <p className="max-w-md text-lg leading-relaxed text-muted">
            {t("heroBody")}
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <Button asChild>
              <Link href={primary.href}>
                <span>{primary.label}</span>
              </Link>
            </Button>
            {!approved && (
              <Link href="/trade/portal" className="link-draw eyebrow !text-muted">
                {t("signIn")}
              </Link>
            )}
          </div>
        </Reveal>
      </section>

      <div className="hairline container-luxe" aria-hidden />

      {/* Who it's for */}
      <section className="container-luxe py-24 md:py-32" aria-labelledby="who">
        <div className="mb-16 grid gap-8 md:grid-cols-[1fr_2fr]">
          <p className="eyebrow" id="who">{t("whoEyebrow")}</p>
          <MaskedHeading text={t("whoTitle")} italicLine={1} className="text-4xl md:text-6xl" />
        </div>
        <ul className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {audiences.map((a, i) => (
            <li key={a} className="bg-bg">
              <Reveal delay={(i % 3) * 0.08} className="h-full p-8 md:p-10">
                <h3 className="font-display text-2xl">{t(`audiences.${a}.title`)}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{t(`audiences.${a}.body`)}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </section>

      {/* Benefits */}
      <section className="bg-bg-elev py-24 md:py-32" aria-labelledby="benefits">
        <div className="container-luxe grid gap-16 lg:grid-cols-[1fr_1.6fr]">
          <div className="lg:sticky lg:top-32 lg:self-start">
            <p className="eyebrow mb-6" id="benefits">{t("benefitsEyebrow")}</p>
            <MaskedHeading text={t("benefitsTitle")} italicLine={1} className="text-5xl md:text-7xl" />
          </div>
          <ol className="divide-y divide-line border-y border-line">
            {benefits.map((b, i) => (
              <li key={b}>
                <Reveal className="grid gap-4 py-10 sm:grid-cols-[4rem_1fr]">
                  <span className="font-display text-2xl italic text-gold">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <h3 className="font-display text-3xl">{t(`benefits.${b}.title`)}</h3>
                    <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">{t(`benefits.${b}.body`)}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* How it works */}
      <section className="container-luxe py-24 md:py-32" aria-labelledby="how">
        <p className="eyebrow mb-6" id="how">{t("howEyebrow")}</p>
        <MaskedHeading text={t("howTitle")} italicLine={1} className="mb-16 text-4xl md:text-6xl" />
        <ol className="grid gap-12 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s}>
              <Reveal delay={i * 0.1}>
                <div className="mb-6 flex items-center gap-4">
                  <span className="flex size-10 items-center justify-center rounded-full border border-gold/50 font-display text-lg text-gold">{i + 1}</span>
                  <span className="h-px flex-1 bg-line-strong" aria-hidden />
                </div>
                <h3 className="font-display text-3xl">{t(`steps.${s}.title`)}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{t(`steps.${s}.body`)}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      {/* FAQ */}
      <section className="container-luxe grid gap-12 py-16 lg:grid-cols-[1fr_2fr]" aria-labelledby="faq">
        <p className="eyebrow" id="faq">{t("faqEyebrow")}</p>
        <div className="divide-y divide-line border-y border-line">
          {faqs.map((f) => (
            <details key={f} className="group py-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 font-display text-2xl transition-colors hover:text-gold [&::-webkit-details-marker]:hidden">
                {t(`faqs.${f}.q`)}
                <span aria-hidden className="text-gold transition-transform duration-500 group-open:rotate-45">+</span>
              </summary>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">{t(`faqs.${f}.a`)}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="container-luxe pt-24">
        <Reveal className="border border-line px-8 py-16 text-center md:px-16 md:py-24">
          <p className="eyebrow mb-6">{t("ctaEyebrow")}</p>
          <h2 className="display mx-auto max-w-3xl text-4xl md:text-6xl">
            {t.rich("ctaTitle", { em: (c) => <span className="italic text-gold">{c}</span> })}
          </h2>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-6">
            <Button asChild>
              <Link href={primary.href}>
                <span>{primary.label}</span>
              </Link>
            </Button>
            <a href={`mailto:${brand.email}?subject=${encodeURIComponent(t("mailSubject"))}`} className="link-draw eyebrow inline-flex items-center gap-2 !text-muted">
              {t("writeToDesk")} <ArrowRight className="size-3 rtl:-scale-x-100" aria-hidden />
            </a>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
