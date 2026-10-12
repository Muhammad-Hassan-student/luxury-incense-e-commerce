import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getIntlLocale } from "@/i18n/server";
import { db } from "@/server/db";
import { cache } from "react";
import { getLocalized } from "@/server/translations/localize";
import { fieldAttrs } from "@/lib/translations-shared";
import { brand } from "@/config/brand";
import { MaskedHeading, Reveal } from "@/components/motion/reveal";
import { Prose } from "@/components/prose";

/** The published post in the shopper's language (translated fields over English). */
const getPost = cache(async (slug: string) => {
  const p = await db.journalPost.findFirst({ where: { slug, published: true } });
  return p ? getLocalized("journal", p) : null;
});

export async function generateMetadata(props: PageProps<"/journal/[slug]">): Promise<Metadata> {
  const p = await getPost((await props.params).slug);
  return p ? { title: p.title, description: p.excerpt, openGraph: { type: "article", title: p.title, description: p.excerpt } } : {};
}

export default async function PostPage(props: PageProps<"/journal/[slug]">) {
  const post = await getPost((await props.params).slug);
  if (!post) notFound();
  const [t, intl] = await Promise.all([getTranslations("journal"), getIntlLocale()]);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.publishedAt?.toISOString(),
    publisher: { "@type": "Organization", name: brand.name },
  };
  return (
    <article className="container-luxe max-w-4xl pt-20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Link href="/journal" className="link-draw eyebrow">{t("eyebrow")}</Link>
      <MaskedHeading as="h1" text={post.title} className="mt-8 text-5xl md:text-7xl" />
      <Reveal delay={0.1}>
        <p className="mt-6 font-display text-2xl italic text-muted">{post.excerpt}</p>
        <p className="mt-6 text-xs uppercase tracking-[0.24em] text-subtle">{post.publishedAt?.toLocaleDateString(intl, { day: "numeric", month: "long", year: "numeric" })}</p>
      </Reveal>
      <div className="hairline my-14" />
      <Reveal delay={0.2}>
        <div {...fieldAttrs(post, "body")}>
          <Prose markdown={post.body} />
        </div>
      </Reveal>
    </article>
  );
}
