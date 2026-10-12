import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/server/db";
import { orderIdFromPayToken } from "@/server/subscriptions";
import { paymentProviders } from "@/server/payments";
import { Button } from "@/components/ui/button";
import { Price } from "@/components/money";
import { PayRenewal } from "@/components/checkout/pay-renewal";
import { SuccessPoller } from "@/components/checkout/success-poller";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pay");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

/** One-click payment link emailed for Subscribe & Save renewals (signed, bound to a single order). */
export default async function PayLinkPage(props: PageProps<"/pay/[token]">) {
  const [{ token }, sp] = await Promise.all([props.params, props.searchParams]);
  const returned = sp.paid === "1";
  const orderId = orderIdFromPayToken(token);
  if (!orderId) notFound();
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) notFound();
  const online = await paymentProviders();
  const paid = !order.reservedUntil && order.status !== "CANCELLED";
  const confirming = returned && !paid && order.status === "PENDING";
  const t = await getTranslations("pay");

  return (
    <div className="container-luxe flex min-h-[70svh] flex-col items-center justify-center py-24">
      <div className="w-full max-w-lg">
        <p className="eyebrow mb-6 text-center">{t("eyebrow", { number: order.number })}</p>
        {confirming && <SuccessPoller />}
        <h1 className="display text-center text-5xl md:text-6xl">{paid ? (returned ? t("thankYou") : t("alreadyPaid")) : confirming ? t("confirming") : order.status === "CANCELLED" ? t("expired") : t("complete")}</h1>
        <ul className="mt-12 divide-y divide-line border-y border-line">
          {order.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-4 py-4 text-sm">
              <span>
                {i.name} <span className="text-muted">· {i.label} × {i.quantity}</span>
              </span>
              <Price amount={i.unitPrice * i.quantity} />
            </li>
          ))}
          {order.shipping > 0 && (
            <li className="flex justify-between py-4 text-sm text-muted">
              <span>{t("shipping")}</span>
              <Price amount={order.shipping} />
            </li>
          )}
          <li className="flex justify-between py-4">
            <span className="eyebrow !text-muted">{t("total")}</span>
            <Price amount={order.total} className="font-display text-2xl" />
          </li>
        </ul>
        <div className="mt-10">
          {paid ? (
            <p className="text-center text-sm text-muted">{t("paidBody")}</p>
          ) : confirming ? (
            <p className="text-center text-sm text-muted">{t("confirmingBody")}</p>
          ) : order.status === "CANCELLED" ? (
            <div className="space-y-6 text-center">
              <p className="text-sm text-muted">{t("expiredBody")}</p>
              <Button asChild variant="outline">
                <Link href="/account/subscriptions">{t("manage")}</Link>
              </Button>
            </div>
          ) : (
            <PayRenewal token={token} number={order.number} total={order.total} stripeKey={online.stripePublishableKey} razorpayKey={online.razorpayKeyId} canStripe={online.stripe} canRazorpay={online.razorpay} />
          )}
        </div>
      </div>
    </div>
  );
}
