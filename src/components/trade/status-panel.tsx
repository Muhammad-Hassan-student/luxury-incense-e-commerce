import Link from "next/link";
import { useTranslations } from "next-intl";
import type { TradeStatus } from "@/generated/prisma/enums";
import { brand } from "@/config/brand";
import { useIntlLocale } from "@/i18n/format";
import { Badge } from "@/components/ui/field";
import { BUSINESS_TYPE_VALUES, tradeStatusTone } from "./trade-rules";

/** What a buyer sees about their own application/account when they can't use the portal (or have already applied). */
export function TradeStatusPanel({
  account,
}: {
  account: { status: TradeStatus; businessName: string; businessType: string; createdAt: Date; rejectionReason: string | null };
}) {
  const t = useTranslations("trade.statusPanel");
  const tt = useTranslations("trade");
  const intl = useIntlLocale();
  const knownType = (BUSINESS_TYPE_VALUES as readonly string[]).includes(account.businessType);
  const c = { title: t(`title_${account.status}`), body: t(`body_${account.status}`) };
  return (
    <section className="mx-auto max-w-3xl border border-line bg-bg-elev p-8 md:p-14" aria-labelledby="trade-status">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <p className="eyebrow">{account.businessName}</p>
        <Badge tone={tradeStatusTone(account.status)}>{tt(`status_${account.status}`)}</Badge>
      </div>
      <h2 id="trade-status" className="display text-4xl md:text-5xl">
        {c.title}
      </h2>
      <p className="mt-6 max-w-xl leading-relaxed text-muted">{c.body}</p>
      {account.status === "REJECTED" && account.rejectionReason ? (
        <blockquote className="mt-8 border-l border-gold/60 pl-6 font-display text-xl italic text-fg">{account.rejectionReason}</blockquote>
      ) : null}
      <dl className="mt-10 grid gap-6 border-t border-line pt-8 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">{t("businessType")}</dt>
          <dd className="mt-1">{knownType ? tt(`businessType_${account.businessType}` as Parameters<typeof tt>[0]) : account.businessType}</dd>
        </div>
        <div>
          <dt className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">{t("applied")}</dt>
          <dd className="mt-1">{account.createdAt.toLocaleDateString(intl, { day: "numeric", month: "long", year: "numeric" })}</dd>
        </div>
      </dl>
      <div className="mt-10 flex flex-wrap gap-6">
        {account.status === "APPROVED" ? (
          <Link href="/trade/portal" className="link-draw eyebrow">
            {t("openPortal")}
          </Link>
        ) : (
          <a href={`mailto:${brand.email}?subject=${encodeURIComponent(t("mailSubject", { business: account.businessName }))}`} className="link-draw eyebrow">
            {t("writeToDesk")}
          </a>
        )}
        <Link href="/shop" className="link-draw eyebrow !text-muted">
          {t("shopRetail")}
        </Link>
      </div>
    </section>
  );
}
