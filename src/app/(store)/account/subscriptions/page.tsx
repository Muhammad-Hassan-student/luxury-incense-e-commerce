import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/server/db";
import { requireUser } from "@/server/roles";
import { discounted, intervalLabel, payLinkPath } from "@/server/subscriptions";
import { SubscriptionCard, type SubscriptionView } from "@/components/account/subscription-card";

export const metadata: Metadata = { title: "Subscriptions", robots: { index: false } };

export default async function SubscriptionsPage() {
  const user = await requireUser("/account/subscriptions");
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
        <p className="eyebrow">Subscribe &amp; Save</p>
        <p className="text-muted">
          No subscriptions yet. Choose “Subscribe &amp; save” on any incense, bakhoor or oil and we’ll send it every one, two or three months.{" "}
          <Link href="/shop" className="link-draw text-gold">Explore the house</Link>
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
        <p className="eyebrow mb-2">Subscribe &amp; Save</p>
        <p className="text-sm text-muted">Skip a delivery, change how often or how many, pause or cancel — changes apply from your next renewal. We email you 3 days before each one.</p>
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
