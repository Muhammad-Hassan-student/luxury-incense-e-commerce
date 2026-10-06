import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { brand } from "@/config/brand";
import { MaskedHeading, Reveal } from "@/components/motion/reveal";
import { Prose } from "@/components/prose";

const getPost = (slug: string) => db.journalPost.findFirst({ where: { slug, published: true } });

export async function generateMetadata(props: PageProps<"/journal/[slug]">): Promise<Metadata> {
  const p = await getPost((await props.params).slug);
  return p ? { title: p.title, description: p.excerpt, openGraph: { type: "article", title: p.title, description: p.excerpt } } : {};
}

export default async function PostPage(props: PageProps<"/journal/[slug]">) {
  const post = await getPost((await props.params).slug);
  if (!post) notFound();
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
      <Link href="/journal" className="link-draw eyebrow">Journal</Link>
      <MaskedHeading as="h1" text={post.title} className="mt-8 text-5xl md:text-7xl" />
      <Reveal delay={0.1}>
        <p className="mt-6 font-display text-2xl italic text-muted">{post.excerpt}</p>
        <p className="mt-6 text-xs uppercase tracking-[0.24em] text-subtle">{post.publishedAt?.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
      </Reveal>
      <div className="hairline my-14" />
      <Reveal delay={0.2}>
        <Prose markdown={post.body} />
      </Reveal>
    </article>
  );
}
