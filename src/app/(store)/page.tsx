import { db } from "@/server/db";
import { getFlags } from "@/server/settings";
import { HomeBlock } from "@/components/home/blocks";
import { brand } from "@/config/brand";

export default async function HomePage() {
  const [blocks, flags] = await Promise.all([
    db.contentBlock.findMany({ where: { page: "home", enabled: true }, orderBy: { position: "asc" } }),
    getFlags(),
  ]);
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: brand.name,
    url: process.env.NEXT_PUBLIC_SITE_URL,
    email: brand.email,
    sameAs: [brand.instagram],
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }} />
      {blocks.map((b) => (
        <HomeBlock key={b.id} block={b} flags={flags} />
      ))}
    </>
  );
}
