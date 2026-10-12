import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { brand } from "@/config/brand";
import { journeyEmailsAllowed, verifyUnsubscribeToken } from "@/server/marketing";
import { UnsubscribeForm } from "@/components/account/unsubscribe-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("unsubscribe");
  return { title: t("metaTitle"), robots: { index: false } };
}

const mask = (email: string) => {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, name.length - 2)))}@${domain}`;
};

export default async function UnsubscribePage(props: PageProps<"/unsubscribe">) {
  const sp = await props.searchParams;
  const token = typeof sp.t === "string" ? sp.t : "";
  const email = verifyUnsubscribeToken(token);
  const allowed = email ? await journeyEmailsAllowed(email) : false;
  const t = await getTranslations("unsubscribe");

  return (
    <section className="mx-auto max-w-xl px-6 pt-40 pb-32 text-center">
      <p className="eyebrow mb-4">{t("eyebrow")}</p>
      {email ? (
        <>
          <h1 className="font-display text-4xl font-light sm:text-5xl">{allowed ? t("fewer") : t("unsubscribed")}</h1>
          <p className="mt-6 text-sm text-muted">
            {allowed ? t("stopBody", { brand: brand.name, email: mask(email) }) : t("unsubscribedBody", { brand: brand.name, email: mask(email) })}
          </p>
          <UnsubscribeForm token={token} allowed={allowed} />
        </>
      ) : (
        <>
          <h1 className="font-display text-4xl font-light sm:text-5xl">{t("invalidTitle")}</h1>
          <p className="mt-6 text-sm text-muted">
            {t.rich("invalidBody", {
              link: (c) => (
                <Link href="/account" className="link-draw text-gold">
                  {c}
                </Link>
              ),
            })}
          </p>
        </>
      )}
    </section>
  );
}
