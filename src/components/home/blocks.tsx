import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ContentBlock } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { getIntlLocale } from "@/i18n/server";
import { cmsTranslator, localizeCmsData } from "@/i18n/cms";
import { getBestsellers, getCategories, getProductCard } from "@/server/catalog";
import { localizeMany } from "@/server/translations/localize";
import { Hero, type HeroData } from "@/components/hero/hero";
import { MaskedHeading, Marquee, Parallax, Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import { ProductViewerLazy } from "@/components/three/lazy";
import { ProductArt } from "@/components/product/product-art";
import { Price } from "@/components/money";
import { NewsletterForm } from "@/components/nav/newsletter-form";
import { CategoryTile } from "./category-tile";
import { ProductRail } from "./rail";
import { productHref } from "@/lib/product-href";

type Data = Record<string, unknown> & { eyebrow?: string; title?: string; subtitle?: string; body?: string; productSlug?: string; cta?: { label: string; href: string } };

export async function HomeBlock({ block, flags }: { block: ContentBlock; flags: Record<string, boolean> }) {
  // CMS copy is English in the database; known texts are translated via the `cms` messages (src/i18n/cms.ts).
  const data = localizeCmsData((block.data ?? {}) as Data, cmsTranslator(await getTranslations("cms")));
  switch (block.type) {
    case "hero":
      return <Hero data={data as HeroData} threeD={flags["three-d"] ?? true} />;
    case "collections":
      return <Collections data={data} />;
    case "featured3d":
      return <Featured3D data={data} threeD={flags["three-d"] ?? true} />;
    case "story":
      return <Story data={data} />;
    case "bestsellers":
      return <Bestsellers data={data} />;
    case "ritual":
      return flags["scent-quiz"] === false ? null : <RitualTeaser data={data} />;
    case "gifting":
      return <Gifting data={data} />;
    case "journal":
      return <Journal data={data} />;
    case "newsletter":
      return <Newsletter data={data} />;
    default:
      return null;
  }
}

function SectionHead({ eyebrow, title, link }: { eyebrow?: string; title: string; link?: { href: string; label: string } }) {
  return (
    <div className="mb-14 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && <Reveal><p className="eyebrow mb-5">{eyebrow}</p></Reveal>}
        <MaskedHeading text={title} className="text-5xl md:text-7xl" />
      </div>
      {link && (
        <Link href={link.href} className="link-draw eyebrow self-start md:self-end">
          {link.label}
        </Link>
      )}
    </div>
  );
}

async function Collections({ data }: { data: Data }) {
  const [t, categories] = await Promise.all([getTranslations("home"), getCategories()]);
  // Asymmetric editorial grid: large, small, small / small, small, large.
  const spans = ["md:col-span-7 md:row-span-2", "md:col-span-5", "md:col-span-5", "md:col-span-5", "md:col-span-7 md:row-span-2", "md:col-span-5"];
  return (
    <section className="container-luxe py-32">
      <SectionHead eyebrow={t("collectionsEyebrow")} title={data.title ?? t("collectionsTitle")} link={{ href: "/shop", label: t("shopAll") }} />
      <div className="grid auto-rows-[22rem] gap-4 md:grid-cols-12">
        {categories.map((c, i) => (
          <CategoryTile key={c.slug} index={i} slug={c.slug} name={c.name} tagline={c.tagline} ambient={c.ambient} accent={c.accent} image={c.heroImage} className={spans[i % spans.length]} />
        ))}
      </div>
    </section>
  );
}

async function Featured3D({ data, threeD }: { data: Data; threeD: boolean }) {
  const product = data.productSlug ? await db.product.findFirst({ where: { slug: data.productSlug, isActive: true }, include: { variants: { orderBy: { position: "asc" } } } }) : null;
  if (!product) return null;
  const [t, tp] = await Promise.all([getTranslations("home"), getTranslations("product")]);
  const v = product.variants[0];
  return (
    <section className="relative border-y border-line bg-bg-elev">
      <div className="container-luxe grid items-center gap-12 py-24 lg:grid-cols-2">
        <div className="relative aspect-square w-full">
          <ProductViewerLazy model={product.model} palette={product.palette} enabled={threeD} />
          <p className="absolute bottom-2 start-0 text-[0.625rem] uppercase tracking-[0.3em] text-subtle">{t("dragToTurn")}</p>
        </div>
        <div>
          <Reveal><p className="eyebrow mb-6">{data.title ?? t("featuredTitle")}</p></Reveal>
          <MaskedHeading text={product.name} className="text-6xl md:text-8xl" />
          <Reveal delay={0.1}><p className="mt-6 max-w-md text-muted">{product.story}</p></Reveal>
          <Reveal delay={0.2}>
            <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-line pt-8 text-sm">
              {[[tp("top"), product.topNotes], [tp("heart"), product.heartNotes], [tp("base"), product.baseNotes]].map(([k, notes]) => (
                <div key={k as string}>
                  <dt className="eyebrow mb-3 !text-subtle">{k as string}</dt>
                  <dd className="font-display text-xl leading-snug">{(notes as string[]).join(", ")}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
          <Reveal delay={0.3}>
            <div className="mt-10 flex items-center gap-8">
              <Button asChild size="lg">
                <Link href={productHref(product.slug)}>{t("discover")}</Link>
              </Button>
              {v && <Price amount={v.price} className="font-display text-2xl" />}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

async function Story({ data }: { data: Data }) {
  const t = await getTranslations("home");
  return (
    <section className="py-32">
      <div className="container-luxe grid gap-16 lg:grid-cols-[5fr_7fr] lg:items-center">
        <Parallax className="arch aspect-[3/4] w-full max-w-md border border-line bg-bg-elev" speed={0.12}>
          <div className="h-[120%] w-full">
            <ProductArt model="DHOOP" palette={["#2A1E16", "#8C6A43"]} />
          </div>
        </Parallax>
        <div>
          {data.eyebrow && <Reveal><p className="eyebrow mb-6">{data.eyebrow}</p></Reveal>}
          <MaskedHeading text={data.title ?? ""} className="text-6xl md:text-8xl" />
          <Reveal delay={0.15}>
            <p className="mt-8 max-w-xl font-display text-2xl leading-relaxed text-muted md:text-3xl">{data.body}</p>
          </Reveal>
          <Reveal delay={0.25}>
            <Link href="/about" className="link-draw eyebrow mt-10 inline-block">
              {t("readStory")}
            </Link>
          </Reveal>
        </div>
      </div>
      <Marquee className="mt-32" items={[t("marquee1"), t("marquee2"), t("marquee3"), t("marquee4"), t("marquee5"), t("marquee6")]} />
    </section>
  );
}

async function Bestsellers({ data }: { data: Data }) {
  const [t, tc, products] = await Promise.all([getTranslations("home"), getTranslations("common"), getBestsellers()]);
  if (!products.length) return null;
  return (
    <section className="container-luxe py-32">
      <SectionHead eyebrow={t("bestsellersEyebrow")} title={data.title ?? t("bestsellersTitle")} link={{ href: "/shop?sort=rating", label: tc("viewAll") }} />
      <ProductRail products={products} />
    </section>
  );
}

async function RitualTeaser({ data }: { data: Data }) {
  const [t, tn] = await Promise.all([getTranslations("home"), getTranslations("nav")]);
  return (
    <section className="relative overflow-hidden border-y border-line">
      <div className="container-luxe flex flex-col items-center py-36 text-center">
        <Reveal><p className="eyebrow mb-8">{t("ritualEyebrow")}</p></Reveal>
        <MaskedHeading text={data.title ?? tn("ritual")} className="text-6xl md:text-9xl" />
        <Reveal delay={0.15}><p className="mt-8 max-w-md text-muted">{data.subtitle}</p></Reveal>
        <Reveal delay={0.25}>
          <Button asChild variant="outline" size="lg" className="mt-12">
            <Link href="/ritual">{t("begin")}</Link>
          </Button>
        </Reveal>
      </div>
      <div className="pointer-events-none absolute -bottom-1/2 start-1/2 size-[60rem] -translate-x-1/2 animate-breathe rounded-full bg-[radial-gradient(circle,var(--gold)_0%,transparent_60%)] opacity-10 rtl:translate-x-1/2" />
    </section>
  );
}

async function Gifting({ data }: { data: Data }) {
  const t = await getTranslations("home");
  const product = data.productSlug ? await getProductCard(data.productSlug) : null;
  return (
    <section className="container-luxe py-32">
      <div className="grid gap-4 md:grid-cols-2">
        <Link href={product ? productHref(product.slug) : "/shop/gifts"} className="group relative block aspect-[4/5] overflow-hidden bg-bg-elev md:aspect-auto md:min-h-[38rem]">
          <div className="absolute inset-0 transition-transform duration-[1.8s] ease-luxe group-hover:scale-105">
            <ProductArt model="GIFTBOX" palette={product?.palette ?? ["#1A1714", "#C8A46A"]} />
          </div>
          <div className="absolute inset-x-8 bottom-8">
            <p className="eyebrow mb-3">{t("readyToGive")}</p>
            <p className="display text-5xl">{product?.name ?? t("giftSets")}</p>
          </div>
        </Link>
        <Link href="/gifts/coffret" className="group relative flex min-h-[28rem] flex-col justify-between overflow-hidden border border-line p-8 md:p-12">
          <div>
            <p className="eyebrow mb-6">{t("bespoke")}</p>
            <MaskedHeading text={data.title ?? t("giftingTitle")} className="text-5xl md:text-7xl" italicLine={1} />
          </div>
          <div>
            <p className="max-w-sm text-muted">{t("giftingBody")}</p>
            <span className="link-draw eyebrow mt-8 inline-block">{t("buildCoffret")}</span>
          </div>
        </Link>
      </div>
    </section>
  );
}

async function Journal({ data }: { data: Data }) {
  const posts = await localizeMany("journal", await db.journalPost.findMany({ where: { published: true }, orderBy: { publishedAt: "desc" }, take: 3 }));
  if (!posts.length) return null;
  const [t, tn, intl] = await Promise.all([getTranslations("home"), getTranslations("nav"), getIntlLocale()]);
  return (
    <section className="container-luxe py-32">
      <SectionHead eyebrow={tn("journal")} title={data.title ?? t("journalTitle")} link={{ href: "/journal", label: t("allStories") }} />
      <div className="grid gap-px border border-line bg-line md:grid-cols-3">
        {posts.map((p, i) => (
          <Reveal key={p.id} delay={i * 0.08} className="bg-bg">
            <Link href={`/journal/${p.slug}`} className="group flex h-full flex-col justify-between gap-16 p-8 transition-colors duration-700 hover:bg-bg-elev md:p-10">
              <span className="font-display text-sm italic text-subtle">{p.publishedAt?.toLocaleDateString(intl, { day: "numeric", month: "long", year: "numeric" })}</span>
              <div>
                <h3 className="font-display text-3xl leading-tight transition-colors group-hover:text-gold">{p.title}</h3>
                <p className="mt-4 text-sm text-muted">{p.excerpt}</p>
              </div>
            </Link>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

async function Newsletter({ data }: { data: Data }) {
  const t = await getTranslations("footer");
  return (
    <section className="container-luxe py-24">
      <div className="mx-auto max-w-2xl text-center">
        <MaskedHeading text={data.title ?? t("newsletter")} className="text-5xl md:text-7xl" />
        <Reveal delay={0.1}><p className="mt-6 text-muted">{data.subtitle}</p></Reveal>
        <Reveal delay={0.2}>
          <div className="mx-auto max-w-md">
            <NewsletterForm placeholder={t("emailPlaceholder")} cta={t("subscribe")} />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
