import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { brand } from "@/config/brand";
import { lookupTracking } from "@/server/courier/tracking";
import { TrackForm } from "@/components/tracking/track-form";
import { TrackingTimeline } from "@/components/tracking/tracking-timeline";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("track");
  return { title: t("metaTitle"), description: t("metaDescription", { brand: brand.name }), robots: { index: false } };
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function TrackPage(props: PageProps<"/track">) {
  const sp = await props.searchParams;
  const number = one(sp.order).slice(0, 40);
  const key = one(sp.k).slice(0, 64);
  // Signed links from our emails open straight to the timeline; anything else asks for email/phone.
  const signed = number && key ? await lookupTracking({ number, key }) : null;
  const t = await getTranslations("track");

  return (
    <section className="mx-auto max-w-2xl px-6 pb-32 pt-36 sm:pt-40">
      {signed?.ok ? (
        <div className="space-y-12">
          <TrackingTimeline view={signed.view} />
          <p className="text-xs text-subtle">
            {t.rich("questions", {
              email: brand.email,
              link: (c) => (
                <a href={`mailto:${brand.email}?subject=${encodeURIComponent(signed.view.number)}`} className="link-draw text-fg">
                  {c}
                </a>
              ),
            })}
          </p>
        </div>
      ) : (
        <div className="text-center">
          <p className="eyebrow mb-4">{t("eyebrow")}</p>
          <h1 className="font-display text-4xl font-light sm:text-5xl">{t("title")}</h1>
          <p className="mx-auto mt-6 max-w-md text-sm text-muted">
            {t.rich("intro", {
              link: (c) => (
                <Link href="/account/orders" className="link-draw text-gold">
                  {c}
                </Link>
              ),
            })}
          </p>
          {signed && !signed.ok ? <p className="mt-6 text-sm text-ember">{t("invalidLink")}</p> : null}
          <div className="mt-12">
            <TrackForm defaultNumber={number} />
          </div>
        </div>
      )}
    </section>
  );
}
