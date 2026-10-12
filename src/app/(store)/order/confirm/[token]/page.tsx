import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { peekCodLink } from "@/server/cod";
import { getIntlLocale } from "@/i18n/server";
import { formatMoney } from "@/lib/money";
import { storeTz } from "@/lib/region-runtime";
import { CodConfirmForm } from "@/components/order/cod-confirm-form";

// The token is a credential: keep it out of search engines and Referer headers.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("codConfirm");
  return { title: t("metaTitle"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

const fmt = (locale: string, d: Date) => d.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: storeTz() });

export default async function ConfirmCodPage(props: PageProps<"/order/confirm/[token]">) {
  const { token } = await props.params;
  // Viewing never confirms anything (WhatsApp/email link previews open this page too).
  const [s, t, locale] = await Promise.all([peekCodLink(decodeURIComponent(token)), getTranslations("codConfirm"), getIntlLocale()]);
  const b = (c: React.ReactNode) => <span className="text-fg">{c}</span>;

  return (
    <section className="mx-auto max-w-xl px-6 pt-40 pb-32 text-center">
      <p className="eyebrow mb-4">{t("eyebrow")}</p>
      {s.state === "awaiting" ? (
        <>
          <h1 className="font-display text-4xl font-light sm:text-5xl">{s.name ? t("titleName", { name: s.name }) : t("title")}</h1>
          <p className="mt-6 text-sm text-muted">
            {s.city
              ? t.rich("summaryCity", { number: s.number, city: s.city, amount: formatMoney(s.payable), b })
              : t.rich("summary", { number: s.number, amount: formatMoney(s.payable), b })}
            {s.confirmBy ? ` ${t("confirmBy", { date: fmt(locale, s.confirmBy) })}` : ""}
          </p>
          <ul className="mx-auto mt-8 max-w-sm divide-y divide-line border-y border-line text-start text-sm">
            {s.items.map((i, n) => (
              <li key={n} className="flex justify-between gap-4 py-3">
                <span>
                  {i.name} <span className="text-subtle">{i.label}</span>
                </span>
                <span className="text-muted">× {i.quantity}</span>
              </li>
            ))}
          </ul>
          <CodConfirmForm token={decodeURIComponent(token)} />
        </>
      ) : (
        <>
          <h1 className="font-display text-4xl font-light sm:text-5xl">
            {s.state === "confirmed" ? t("confirmedTitle") : s.state === "cancelled" ? t("cancelledTitle") : s.state === "expired" ? t("expiredTitle") : t("invalidTitle")}
          </h1>
          <p className="mt-6 text-sm text-muted">
            {s.state === "confirmed"
              ? t("confirmedBody", { number: s.number })
              : s.state === "cancelled"
                ? t("cancelledBody", { number: s.number })
                : s.state === "expired"
                  ? t("expiredBody", { number: s.number })
                  : t("invalidBody")}
          </p>
          <Link href="/shop" className="link-draw mt-10 inline-block text-sm text-gold">
            {t("continue")}
          </Link>
        </>
      )}
    </section>
  );
}
