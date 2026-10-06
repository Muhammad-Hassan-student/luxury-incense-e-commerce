import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { brand } from "@/config/brand";
import { cartLines, getCart } from "@/server/cart";
import { quote } from "@/server/orders";
import { toLineView } from "@/components/cart/cart-drawer";
import { CartLine } from "@/components/cart/cart-line";
import { CouponForm, GiftCardForm, GiftWrapToggle } from "@/components/cart/cart-extras";
import { MaskedHeading } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import { Price } from "@/components/money";

export const metadata: Metadata = { title: "Your bag", robots: { index: false } };

export default async function CartPage() {
  const [cart, session] = await Promise.all([getCart(), auth()]);
  const lines = await cartLines(cart);
  const { pricing, settings, giftCard } = await quote({ lines, cart, userId: session?.user.id });
  const physical = lines.some((l) => !l.digital);

  if (!lines.length) {
    return (
      <div className="container-luxe flex min-h-[60svh] flex-col items-center justify-center text-center">
        <MaskedHeading as="h1" text="Your bag is empty" className="text-6xl md:text-8xl" />
        <p className="mt-6 text-muted">Every ritual begins with a single stick.</p>
        <Button asChild size="lg" className="mt-10">
          <Link href="/shop">Explore the house</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container-luxe pt-16">
      <MaskedHeading as="h1" text="Your bag" className="mb-16 text-6xl md:text-8xl" />
      <div className="grid gap-16 lg:grid-cols-[1fr_26rem]">
        <ul className="divide-y divide-line border-y border-line">
          {lines.map((l) => (
            <CartLine key={l.id} line={toLineView(l)} />
          ))}
        </ul>
        <aside className="h-fit space-y-8 border border-line bg-bg-elev p-8 lg:sticky lg:top-28">
          <CouponForm applied={cart?.coupon?.code ?? null} error={pricing.couponError} />
          <GiftCardForm applied={giftCard?.code ?? null} appliedAmount={pricing.giftCardApplied} error={giftCard?.error ?? null} />
          {physical && <GiftWrapToggle on={cart?.giftWrap ?? false} note={cart?.giftNote ?? ""} fee={settings.giftWrapFee} />}
          <dl className="space-y-3 border-t border-line pt-6 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Subtotal</dt>
              <dd><Price amount={pricing.subtotal} /></dd>
            </div>
            {pricing.discount > 0 && (
              <div className="flex justify-between text-gold">
                <dt>Discount ({cart?.coupon?.code})</dt>
                <dd>−<Price amount={pricing.discount} /></dd>
              </div>
            )}
            {pricing.giftWrap > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted">Gift wrapping</dt>
                <dd><Price amount={pricing.giftWrap} /></dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-muted">Shipping</dt>
              <dd className="text-muted">{!physical ? "Sent by email" : pricing.subtotal - pricing.discount >= brand.freeShippingOver ? "Complimentary" : "At checkout"}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-4">
              <dt className="eyebrow !text-muted">Estimated total</dt>
              <dd className="font-display text-3xl"><Price amount={pricing.total - pricing.shipping} /></dd>
            </div>
            {pricing.giftCardApplied > 0 && (
              <>
                <div className="flex justify-between text-gold">
                  <dt>Gift card</dt>
                  <dd>−<Price amount={pricing.giftCardApplied} /></dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="eyebrow !text-muted">To pay</dt>
                  <dd className="font-display text-2xl"><Price amount={Math.max(0, pricing.total - pricing.shipping - pricing.giftCardApplied)} /></dd>
                </div>
              </>
            )}
            <p className="text-xs text-subtle">{settings.taxInclusive ? `Includes ${settings.taxRatePercent}% tax.` : "Tax added at checkout."}</p>
          </dl>
          <Button asChild size="lg" className="w-full">
            <Link href="/checkout">Checkout</Link>
          </Button>
        </aside>
      </div>
    </div>
  );
}
