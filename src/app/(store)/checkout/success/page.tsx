import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { brand } from "@/config/brand";
import { MaskedHeading, Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import { Price } from "@/components/money";
import { SuccessPoller } from "@/components/checkout/success-poller";
import { PurchaseEvent } from "@/components/analytics/purchase-event";

const placedWithinHour = (d: Date) => Date.now() - d.getTime() < 60 * 60 * 1000;

export const metadata: Metadata = { title: "Thank you", robots: { index: false } };

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
  return (
    <div className="container-luxe flex min-h-[70svh] flex-col items-center justify-center py-24 text-center">
      {!confirmed && order.status === "PENDING" && <SuccessPoller />}
      {confirmed && recent && (
        <PurchaseEvent number={order.number} value={order.total} currency={order.currency} items={order.items.map((i) => ({ id: i.variantId ?? i.sku, name: i.name, variant: i.label, price: i.unitPrice, quantity: i.quantity }))} />
      )}
      <Reveal><p className="eyebrow mb-8">Order {order.number}</p></Reveal>
      <MaskedHeading
        as="h1"
        text={order.status === "CANCELLED" ? "Payment\nnot completed" : confirmed ? `Thank you,\n${addr.fullName.split(" ")[0]}` : "Confirming\nyour payment"}
        italicLine={1}
        className="text-6xl md:text-9xl"
      />
      <Reveal delay={0.2}>
        <p className="mx-auto mt-8 max-w-md text-muted">
          {order.status === "CANCELLED"
            ? "Your payment didn’t go through and nothing was charged. Your bag is still saved."
            : confirmed
              ? physical
                ? `We’re wrapping your order by hand. A confirmation is on its way to ${order.email}, and we’ll write again when it ships to ${addr.city}.`
                : `Your gift card is on its way by email. A receipt has been sent to ${order.email}.`
              : "This usually takes a few seconds. You can safely leave this page — we’ll email you as soon as it’s confirmed."}
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
                <Price amount={i.unitPrice * i.quantity} />
              </li>
            ))}
            <li className="flex justify-between py-4">
              <span className="eyebrow !text-muted">Total</span>
              <Price amount={order.total} className="font-display text-2xl" />
            </li>
          </ul>
        </Reveal>
      )}
      <Reveal delay={0.4}>
        <div className="mt-12 flex flex-wrap justify-center gap-4">
          {order.status === "CANCELLED" ? (
            <Button asChild size="lg"><Link href="/checkout">Try again</Link></Button>
          ) : (
            <>
              {order.userId && <Button asChild variant="outline"><Link href={`/account/orders/${order.number}`}>Track order</Link></Button>}
              <Button asChild><Link href="/shop">Continue exploring</Link></Button>
            </>
          )}
        </div>
        {order.codStatus === "AWAITING" && order.status === "PENDING" && (
          <p className="mx-auto mt-8 max-w-md border border-gold/40 p-4 text-sm text-fg" data-cod-awaiting>
            One more step: please confirm your cash-on-delivery order {order.whatsappOptIn ? "on WhatsApp or " : ""}via the link we’ve emailed to {order.email}. We’ll start wrapping as soon as you do.
          </p>
        )}
        {confirmed && !order.userId && <p className="mt-8 text-xs text-subtle">Create an account with {order.email} to track orders and earn {brand.loyalty.name}.</p>}
      </Reveal>
    </div>
  );
}
