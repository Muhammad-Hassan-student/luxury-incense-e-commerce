import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pages } from "@/content/pages";
import { MaskedHeading, Reveal } from "@/components/motion/reveal";
import { Prose } from "@/components/prose";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(pages).map((page) => ({ page }));
}

export async function generateMetadata(props: PageProps<"/[page]">): Promise<Metadata> {
  const p = pages[(await props.params).page];
  return p ? { title: p.title.replace("\n", " "), description: p.description } : {};
}

export default async function ContentPage(props: PageProps<"/[page]">) {
  const p = pages[(await props.params).page];
  if (!p) notFound();
  return (
    <article className="container-luxe max-w-4xl pt-20">
      <p className="eyebrow mb-6">{p.eyebrow}</p>
      <MaskedHeading as="h1" text={p.title} italicLine={1} className="text-6xl md:text-8xl" />
      <div className="hairline my-14" />
      <Reveal>
        <Prose markdown={p.body} />
      </Reveal>
    </article>
  );
}
