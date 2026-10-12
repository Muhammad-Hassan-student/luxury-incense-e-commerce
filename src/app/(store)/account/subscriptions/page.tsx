import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { db } from "@/server/db";
import { requireUser } from "@/server/roles";
import { discounted, intervalLabel, payLinkPath } from "@/server/subscriptions";
import { SubscriptionCard, type SubscriptionView } from "@/components/account/subscription-card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("subscriptions");
  return { title: t("metaTitle"), robots: { index: false } };
}

export default async function SubscriptionsPage() {
  const user = await requireUser("/account/subscriptions");
  const t = await getTranslations("subscriptions");
  const subs = await db.subscription.findMany({
    where: { userId: user.id },
    orderBy: [{ status: "asc" }, { nextRunAt: "asc" }],
    include: {
      variant: { select: { label: true, price: true, product: { select: { name: true, slug: true } } } },
      renewals: { where: { status: "PENDING" }, select: { orderId: true } },
    },
  });
  if (!subs.length) {
    return (
      <div className="space-y-4">
        <p className="eyebrow">{t("eyebrow")}</p>
        <p className="text-muted">
          {t.rich("empty", {
            link: (c) => (
              <Link href="/shop" className="link-draw text-gold">
                {c}
              </Link>
            ),
          })}
        </p>
      </div>
    );
  }
  const views: SubscriptionView[] = subs.map((s) => ({
    id: s.id,
    name: s.variant.product.name,
    slug: s.variant.product.slug,
    label: s.variant.label,
    quantity: s.quantity,
    intervalMonths: s.intervalMonths as 1 | 2 | 3,
    intervalLabel: intervalLabel(s.intervalMonths),
    status: s.status,
    pauseReason: s.pauseReason,
    nextRunAt: s.nextRunAt.toISOString(),
    unitPrice: discounted(s.variant.price, s.discountPercent),
    fullPrice: s.variant.price,
    discountPercent: s.discountPercent,
    lastError: s.failureCount > 0 ? s.lastError : null,
    payPath: s.renewals[0]?.orderId ? payLinkPath(s.renewals[0].orderId) : null,
    savedCard: Boolean(s.paymentMethodRef),
  }));
  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow mb-2">{t("eyebrow")}</p>
        <p className="text-sm text-muted">{t("intro")}</p>
      </div>
      <ul className="space-y-6">
        {views.map((v) => (
          <li key={v.id}>
            <SubscriptionCard sub={v} />
          </li>
        ))}
      </ul>
    </div>
  );
}
