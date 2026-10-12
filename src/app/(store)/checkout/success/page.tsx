import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { brand } from "@/config/brand";
import { MaskedHeading, Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import { formatOrderCharge, orderMoney } from "@/lib/money";
import { SuccessPoller } from "@/components/checkout/success-poller";
import { PurchaseEvent } from "@/components/analytics/purchase-event";
import { PushOptIn } from "@/components/pwa/push-opt-in";

const placedWithinHour = (d: Date) => Date.now() - d.getTime() < 60 * 60 * 1000;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("checkout");
  return { title: t("successMetaTitle"), robots: { index: false } };
}

export default async function SuccessPage(props: PageProps<"/checkout/success">) {
  const sp = await props.searchParams;
  const number = typeof sp.order === "string" ? sp.order : null;
  if (!number) notFound();
  const order = await db.order.findUnique({ where: { number }, include: { items: true, payments: true } });
  if (!order) notFound();
  // Order numbers are guessable-ish: only show details to the buyer's session or within the first hour.
  const session = await auth();
  const recent = placedWithinHour(order.placedAt);
  if (!recent && order.userId !== session?.user?.id) notFound();

  const confirmed = !order.reservedUntil && order.status !== "CANCELLED";
  const addr = order.shippingAddress as { fullName: string; line1: string; city: string; country: string };
  const physical = order.items.some((i) => !(i.meta as { giftCard?: unknown } | null)?.giftCard);
  const t = await getTranslations("checkout");
  return (
    <div className="container-luxe flex min-h-[70svh] flex-col items-center justify-center py-24 text-center">
      {!confirmed && order.status === "PENDING" && <SuccessPoller />}
      {confirmed && recent && (
        <PurchaseEvent number={order.number} value={order.total} currency={order.currency} items={order.items.map((i) => ({ id: i.variantId ?? i.sku, name: i.name, variant: i.label, price: i.unitPrice, quantity: i.quantity }))} />
      )}
      <Reveal><p className="eyebrow mb-8">{t("orderNumber", { number: order.number })}</p></Reveal>
      <MaskedHeading
        as="h1"
        text={order.status === "CANCELLED" ? t("successNotCompleted") : confirmed ? t("successThankYou", { name: addr.fullName.split(" ")[0] }) : t("successConfirming")}
        italicLine={1}
        className="text-6xl md:text-9xl"
      />
      <Reveal delay={0.2}>
        <p className="mx-auto mt-8 max-w-md text-muted">
          {order.status === "CANCELLED"
            ? t("successCancelledBody")
            : confirmed
              ? physical
                ? t("successPhysicalBody", { email: order.email, city: addr.city })
                : t("successGiftCardBody", { email: order.email })
              : t("successPendingBody")}
        </p>
      </Reveal>
      {confirmed && (
        <Reveal delay={0.3}>
          <ul className="mx-auto mt-12 w-full max-w-md divide-y divide-line border-y border-line text-start">
            {order.items.map((i) => (
              <li key={i.id} className="flex justify-between gap-4 py-4 text-sm">
                <span>
                  {i.name} <span className="text-muted">× {i.quantity}</span>
                </span>
                {orderMoney(order)(i.unitPrice * i.quantity)}
              </li>
            ))}
            <li className="flex justify-between py-4">
              <span className="eyebrow !text-muted">{t("total")}</span>
              <span className="font-display text-2xl tabular-nums">{order.giftCardAmount ? orderMoney(order)(order.total) : formatOrderCharge(order.total, order)}</span>
            </li>
          </ul>
        </Reveal>
      )}
      {confirmed && physical && order.userId && order.userId === session?.user?.id && (
        <PushOptIn context="order" signedIn className="mx-auto mt-10 w-full max-w-md text-start" />
      )}
      <Reveal delay={0.4}>
        <div className="mt-12 flex flex-wrap justify-center gap-4">
          {order.status === "CANCELLED" ? (
            <Button asChild size="lg"><Link href="/checkout">{t("tryAgain")}</Link></Button>
          ) : (
            <>
              {order.userId && <Button asChild variant="outline"><Link href={`/account/orders/${order.number}`}>{t("trackOrder")}</Link></Button>}
              <Button asChild><Link href="/shop">{t("continueExploring")}</Link></Button>
            </>
          )}
        </div>
        {order.codStatus === "AWAITING" && order.status === "PENDING" && (
          <p className="mx-auto mt-8 max-w-md border border-gold/40 p-4 text-sm text-fg" data-cod-awaiting>
            {t("codAwaiting", { whatsapp: order.whatsappOptIn ? "yes" : "no", email: order.email })}
          </p>
        )}
        {confirmed && !order.userId && <p className="mt-8 text-xs text-subtle">{t("createAccount", { email: order.email, loyalty: brand.loyalty.name })}</p>}
      </Reveal>
    </div>
  );
}
