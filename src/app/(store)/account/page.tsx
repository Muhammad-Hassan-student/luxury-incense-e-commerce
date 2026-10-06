import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/server/db";
import { requireUser } from "@/server/roles";
import { REFERRAL_BONUS } from "@/server/orders";
import { brand } from "@/config/brand";
import { Price } from "@/components/money";
import { CopyLink } from "@/components/account/copy-link";
import { ProfileForm } from "@/components/account/profile-form";
import { OrderStatusBadge } from "@/components/account/order-status";

export const metadata: Metadata = { title: "Account", robots: { index: false } };

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

  return (
    <div className="space-y-16">
      <section className="grid gap-px border border-line bg-line md:grid-cols-3">
        <div className="bg-bg p-8">
          <p className="eyebrow mb-4">{brand.loyalty.name}</p>
          <p className="display text-6xl text-gold">{user.loyaltyPoints}</p>
          <p className="mt-2 text-xs text-muted">
            Worth <Price amount={user.loyaltyPoints * brand.loyalty.pointValue} /> at checkout
          </p>
        </div>
        <div className="bg-bg p-8 md:col-span-2">
          <p className="eyebrow mb-4">Share the ritual</p>
          <p className="text-sm text-muted">
            Friends who join through your link and place their first order earn you {REFERRAL_BONUS} {brand.loyalty.name}. {user._count.referrals > 0 && `${user._count.referrals} joined so far.`}
          </p>
          <CopyLink url={`${site}/?ref=${user.referralCode}`} />
        </div>
      </section>

      <section>
        <div className="mb-6 flex items-baseline justify-between">
          <h2 className="font-display text-3xl">Recent orders</h2>
          <Link href="/account/orders" className="link-draw eyebrow">All orders</Link>
        </div>
        {user.orders.length ? (
          <ul className="divide-y divide-line border-y border-line">
            {user.orders.map((o) => (
              <li key={o.id}>
                <Link href={`/account/orders/${o.number}`} className="flex flex-wrap items-center justify-between gap-4 py-5 hover:text-gold">
                  <span className="font-display text-xl">{o.number}</span>
                  <span className="text-xs text-muted">{o.placedAt.toLocaleDateString("en-GB")}</span>
                  <OrderStatusBadge status={o.status} />
                  <Price amount={o.total} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            No orders yet. <Link href="/shop" className="link-draw text-gold">Begin a ritual</Link>
          </p>
        )}
      </section>

      <section className="grid gap-16 md:grid-cols-2">
        <div>
          <h2 className="mb-6 font-display text-3xl">Details</h2>
          <ProfileForm name={user.name ?? ""} phone={user.phone ?? ""} email={user.email} />
        </div>
        <div>
          <h2 className="mb-6 font-display text-3xl">{brand.loyalty.name} history</h2>
          <ul className="divide-y divide-line border-y border-line text-sm">
            {user.loyaltyLedger.map((e) => (
              <li key={e.id} className="flex justify-between py-3">
                <span className="text-muted">{e.reason}</span>
                <span className={e.points > 0 ? "text-gold" : "text-muted"}>{e.points > 0 ? `+${e.points}` : e.points}</span>
              </li>
            ))}
            {!user.loyaltyLedger.length && <li className="py-3 text-muted">Earn {brand.loyalty.earnPer100} {brand.loyalty.name} for every ₹100 you spend.</li>}
          </ul>
        </div>
      </section>
    </div>
  );
}
