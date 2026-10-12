import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getIntlLocale } from "@/i18n/server";
import { db } from "@/server/db";
import { requireUser } from "@/server/roles";
import { affiliateStats, getAffiliateSettings, rateOf } from "@/server/affiliates";
import { Price } from "@/components/money";
import { JoinAffiliateButton, PayoutDetailsForm, SelfDevicePing, ShareBox } from "@/components/account/affiliate-panel";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("affiliate");
  return { title: t("metaTitle"), robots: { index: false } };
}

function Stat({ label, children, hint, gold }: { label: string; children: React.ReactNode; hint?: string; gold?: boolean }) {
  return (
    <div className="min-w-0 bg-bg p-5 sm:p-6">
      <p className="eyebrow mb-3 !text-muted">{label}</p>
      <p className={cn("display truncate text-3xl sm:text-4xl", gold && "text-gold")}>{children}</p>
      {hint ? <p className="mt-2 text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

export default async function AffiliatePage() {
  const user = await requireUser("/account/affiliate");
  const t = await getTranslations("affiliate");
  const [settings, a] = await Promise.all([getAffiliateSettings(), db.affiliate.findUnique({ where: { userId: user.id } })]);
  const invited = !a && user.email ? await db.affiliate.findFirst({ where: { userId: null, status: "INVITED", email: { equals: user.email, mode: "insensitive" } }, select: { id: true } }) : null;
  const rate = (rateOf(a ?? { commissionBps: null }, settings) / 100).toString();

  if (!a || a.status === "INVITED") {
    return (
      <section className="max-w-2xl space-y-6" data-affiliate-join>
        <h2 className="font-display text-4xl">{t("title")}</h2>
        <p className="text-muted">{t("intro", { percent: rate })}</p>
        <p className="text-xs text-subtle">{t("window", { days: settings.cookieDays })}</p>
        {settings.enabled || invited ? <JoinAffiliateButton /> : <p className="text-sm text-ember">{t("disabled")}</p>}
      </section>
    );
  }
  if (a.status === "PENDING" || a.status === "SUSPENDED") {
    return (
      <section className="max-w-2xl space-y-4">
        <h2 className="font-display text-4xl">{t("title")}</h2>
        <p className="text-muted">{a.status === "PENDING" ? t("pending") : t("suspended")}</p>
      </section>
    );
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const link = `${site}/?aff=${a.code}`;
  const [stats, recent, payouts] = await Promise.all([
    affiliateStats(a.id),
    db.affiliateCommission.findMany({ where: { affiliateId: a.id }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, orderNumber: true, createdAt: true, status: true, amount: true } }),
    db.affiliatePayout.findMany({ where: { affiliateId: a.id }, orderBy: { createdAt: "desc" }, take: 6 }),
  ]);
  const locale = await getIntlLocale();
  const fmt = (d: Date) => d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="space-y-12" data-affiliate-dashboard>
      <SelfDevicePing />
      <section className="space-y-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-4xl">{t("title")}</h2>
          <p className="text-xs text-subtle">
            {t("rate", { percent: rate })} · {t("window", { days: settings.cookieDays })}
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <ShareBox label={t("yourLink")} value={link} share />
          {a.couponCode ? <ShareBox label={t("yourCode")} value={a.couponCode} /> : null}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-5">
        <Stat label={t("clicks")} hint={t("clicks30", { count: stats.clicks30 })}>
          {stats.clicks}
        </Stat>
        <Stat label={t("orders")} hint={t("conversion", { percent: (stats.conversion * 100).toFixed(1) })}>
          {stats.orders}
        </Stat>
        <Stat label={t("pendingEarnings")} hint={t("pendingHint")}>
          <Price amount={stats.pending} />
        </Stat>
        <Stat label={t("approvedEarnings")} hint={t("approvedHint")} gold>
          <Price amount={stats.approved} />
        </Stat>
        <Stat label={t("paidEarnings")}>
          <Price amount={stats.paid} />
        </Stat>
      </section>

      <section>
        <h3 className="mb-4 font-display text-2xl">{t("recentOrders")}</h3>
        {recent.length ? (
          <ul className="divide-y divide-line border-y border-line">
            {recent.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-4 text-sm">
                <span className="min-w-0">
                  <span className="font-mono" dir="ltr">
                    {c.orderNumber}
                  </span>
                  <span className="ms-3 text-xs text-subtle">{fmt(c.createdAt)}</span>
                </span>
                <span className="flex items-center gap-4">
                  <span className={cn("text-xs uppercase tracking-[0.18em]", c.status === "APPROVED" || c.status === "PAID" ? "text-gold" : c.status === "REVERSED" || c.status === "REJECTED" ? "text-ember" : "text-muted")}>{t(`status_${c.status}`)}</span>
                  <Price amount={c.amount} className="tabular-nums" />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t("noOrders")}</p>
        )}
      </section>

      <section className="space-y-6">
        <h3 className="font-display text-2xl">{t("payouts")}</h3>
        {payouts.length ? (
          <ul className="divide-y divide-line border-y border-line">
            {payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
                <span className="text-muted">
                  {fmt(p.createdAt)}
                  {p.reference ? ` · ${p.reference}` : ""}
                </span>
                <Price amount={p.amount} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t("noPayouts")}</p>
        )}
        <PayoutDetailsForm initial={a.payoutDetails ?? ""} />
      </section>
    </div>
  );
}
