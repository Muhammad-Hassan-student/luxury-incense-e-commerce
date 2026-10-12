import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getIntlLocale } from "@/i18n/server";
import { db } from "@/server/db";
import { localizeMany } from "@/server/translations/localize";
import { MaskedHeading, Reveal } from "@/components/motion/reveal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("journalTitle"), description: t("journalDescription") };
}

export default async function JournalPage() {
  const [t, intl, posts] = await Promise.all([
    getTranslations("journal"),
    getIntlLocale(),
    db.journalPost.findMany({ where: { published: true }, orderBy: { publishedAt: "desc" } }).then((rows) => localizeMany("journal", rows)),
  ]);
  return (
    <div className="container-luxe pt-20">
      <p className="eyebrow mb-6">{t("eyebrow")}</p>
      <MaskedHeading as="h1" text={t("title")} italicLine={1} className="mb-24 text-6xl md:text-9xl" />
      <ul className="divide-y divide-line border-y border-line">
        {posts.map((p, i) => (
          <li key={p.id}>
            <Reveal delay={i * 0.05}>
              <Link href={`/journal/${p.slug}`} className="group grid gap-4 py-12 md:grid-cols-[12rem_1fr_auto] md:items-baseline">
                <span className="font-display text-sm italic text-subtle">{p.publishedAt?.toLocaleDateString(intl, { day: "numeric", month: "long", year: "numeric" })}</span>
                <span>
                  <span className="block font-display text-4xl transition-colors group-hover:text-gold md:text-5xl">{p.title}</span>
                  <span className="mt-3 block max-w-xl text-muted">{p.excerpt}</span>
                </span>
                <span className="eyebrow opacity-0 transition-opacity group-hover:opacity-100">{t("read")}</span>
              </Link>
            </Reveal>
          </li>
        ))}
      </ul>
    </div>
  );
}
