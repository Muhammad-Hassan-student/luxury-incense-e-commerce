import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { brand } from "@/config/brand";
import { EnrollFlow } from "./enroll-flow";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("signin");
  return { title: t("enrollMetaTitle"), robots: { index: false }, referrer: "no-referrer" };
}

/**
 * One-time enrollment link: /signin/enroll#<token>. The token lives in the URL fragment, so it never reaches server
 * logs or Referer headers. The page asks only for the account's email + the emailed code, then adds a phone lock or a
 * face to THAT account. It never signs anyone in.
 */
export default async function EnrollPage() {
  const t = await getTranslations("signin");
  return (
    <div className="container-luxe grid min-h-[70svh] items-start gap-12 py-16 md:py-20 lg:grid-cols-2 lg:items-center lg:gap-16">
      <div>
        <p className="eyebrow mb-6">{t("eyebrowSignInSecurity")}</p>
        <h1 className="display text-5xl md:text-7xl">
          {t.rich("enrollHeading", { em: (c) => <em className="text-gold">{c}</em> })}
        </h1>
        <p className="mt-6 max-w-sm text-muted">
          {t("enrollIntro", { brand: brand.name })}
        </p>
      </div>
      <div className="w-full max-w-md">
        <EnrollFlow />
      </div>
    </div>
  );
}
