import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getIntlLocale } from "@/i18n/server";
import { db } from "@/server/db";
import { requireUser } from "@/server/roles";
import { REFERRAL_BONUS } from "@/server/orders";
import { brand } from "@/config/brand";
import { Price } from "@/components/money";
import { orderMoney } from "@/lib/money";
import { CopyLink } from "@/components/account/copy-link";
import { ProfileForm } from "@/components/account/profile-form";
import { OrderStatusBadge } from "@/components/account/order-status";
import { YourData } from "@/components/account/your-data";
import { JourneyEmails } from "@/components/account/journey-emails";
import { SecurityOverview } from "@/components/account/security-overview";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/server/prefs";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account");
  return { title: t("metaTitle"), robots: { index: false } };
}

export default async function AccountPage() {
  const session = await requireUser();
  const user = await db.user.findUniqueOrThrow({
    where: { id: session.id },
    include: {
      orders: { orderBy: { placedAt: "desc" }, take: 3, where: { reservedUntil: null } },
      loyaltyLedger: { orderBy: { createdAt: "desc" }, take: 8 },
      _count: { select: { referrals: true } },
    },
  });
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const [t, locale] = await Promise.all([getTranslations("account"), getIntlLocale()]);

  return (
    <div className="space-y-16">
      <SecurityOverview userId={user.id} />
      <section className="grid gap-px border border-line bg-line md:grid-cols-3">
        <div className="bg-bg p-8">
          <p className="eyebrow mb-4">{brand.loyalty.name}</p>
          <p className="display text-6xl text-gold">{user.loyaltyPoints}</p>
          <p className="mt-2 text-xs text-muted">
            {t.rich("worthAtCheckout", { price: () => <Price amount={user.loyaltyPoints * brand.loyalty.pointValue} /> })}
          </p>
        </div>
        <div className="bg-bg p-8 md:col-span-2">
          <p className="eyebrow mb-4">{t("shareTitle")}</p>
          <p className="text-sm text-muted">
            {t("shareBody", { bonus: REFERRAL_BONUS, points: brand.loyalty.name })} {user._count.referrals > 0 && t("joinedSoFar", { count: user._count.referrals })}
          </p>
          <CopyLink url={`${site}/?ref=${user.referralCode}`} />
        </div>
      </section>

      <section>
        <div className="mb-6 flex items-baseline justify-between">
          <h2 className="font-display text-3xl">{t("recentOrders")}</h2>
          <Link href="/account/orders" className="link-draw eyebrow">{t("allOrders")}</Link>
        </div>
        {user.orders.length ? (
          <ul className="divide-y divide-line border-y border-line">
            {user.orders.map((o) => (
              <li key={o.id}>
                <Link href={`/account/orders/${o.number}`} className="flex flex-wrap items-center justify-between gap-4 py-5 hover:text-gold">
                  <span className="font-display text-xl">{o.number}</span>
                  <span className="text-xs text-muted">{o.placedAt.toLocaleDateString(locale)}</span>
                  <OrderStatusBadge status={o.status} />
                  <span className="tabular-nums">{orderMoney(o)(o.total)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            {t.rich("noOrders", {
              link: (c) => (
                <Link href="/shop" className="link-draw text-gold">
                  {c}
                </Link>
              ),
            })}
          </p>
        )}
      </section>

      <section className="grid gap-16 md:grid-cols-2">
        <div>
          <h2 className="mb-6 font-display text-3xl">{t("details")}</h2>
          <ProfileForm name={user.name ?? ""} phone={user.phone ?? ""} email={user.email} />
        </div>
        <div>
          <h2 className="mb-6 font-display text-3xl">{t("loyaltyHistory", { points: brand.loyalty.name })}</h2>
          <ul className="divide-y divide-line border-y border-line text-sm">
            {user.loyaltyLedger.map((e) => (
              <li key={e.id} className="flex justify-between py-3">
                <span className="text-muted">{e.reason}</span>
                <span className={e.points > 0 ? "text-gold" : "text-muted"}>{e.points > 0 ? `+${e.points}` : e.points}</span>
              </li>
            ))}
            {!user.loyaltyLedger.length && <li className="py-3 text-muted">{t("earnHint", { earn: brand.loyalty.earnPer100, points: brand.loyalty.name, amount: formatMoney(10000, await getCurrency()) })}</li>}
          </ul>
        </div>
      </section>

      <JourneyEmails />

      <section aria-labelledby="your-data">
        <h2 id="your-data" className="mb-6 font-display text-3xl">{t("yourData")}</h2>
        <YourData email={user.email} isStaff={user.role !== "CUSTOMER"} />
      </section>
    </div>
  );
}
