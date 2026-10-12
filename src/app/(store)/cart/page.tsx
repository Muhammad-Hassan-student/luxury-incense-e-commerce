import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { cartLines, getCart } from "@/server/cart";
import { quote } from "@/server/orders";
import { toLineView } from "@/components/cart/cart-drawer";
import { CartLine } from "@/components/cart/cart-line";
import { CouponForm, GiftCardForm, GiftWrapToggle } from "@/components/cart/cart-extras";
import { MaskedHeading } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import { ConvertedNote, Price } from "@/components/money";
import { RecentlyViewedStrip } from "@/components/product/recently-viewed";
import { BagPromos } from "@/components/promo/bag-promos";
import { bagPromotions } from "@/server/promotions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("cart");
  return { title: t("title"), robots: { index: false } };
}

export default async function CartPage() {
  const [cart, session, t, tp] = await Promise.all([getCart(), auth(), getTranslations("cart"), getTranslations("promo")]);
  const lines = await cartLines(cart);
  const { pricing, settings, giftCard, promotions } = await quote({ lines, cart, userId: session?.user.id });
  const promo = lines.length ? await bagPromotions(promotions) : null;
  const couponDiscount = pricing.discount - pricing.promoDiscount;
  const physical = lines.some((l) => !l.digital);

  if (!lines.length) {
    return (
      <div className="container-luxe flex min-h-[60svh] flex-col items-center justify-center text-center">
        <MaskedHeading as="h1" text={t("empty")} className="text-6xl md:text-8xl" />
        <p className="mt-6 text-muted">{t("emptyBody")}</p>
        <Button asChild size="lg" className="mt-10">
          <Link href="/shop">{t("exploreHouse")}</Link>
        </Button>
        <RecentlyViewedStrip className="mt-20 max-w-md border-t border-line pt-8" />
      </div>
    );
  }

  return (
    <div className="container-luxe pt-16">
      <MaskedHeading as="h1" text={t("title")} className="mb-16 text-6xl md:text-8xl" />
      <div className="grid gap-16 lg:grid-cols-[1fr_26rem]">
        <ul className="divide-y divide-line border-y border-line">
          {lines.map((l) => (
            <CartLine key={l.id} line={toLineView(l)} />
          ))}
        </ul>
        <aside className="h-fit space-y-8 border border-line bg-bg-elev p-6 sm:p-8 lg:sticky lg:top-28">
          <BagPromos view={promo} />
          <CouponForm applied={cart?.coupon?.code ?? null} error={pricing.couponError} />
          <GiftCardForm applied={giftCard?.code ?? null} appliedAmount={pricing.giftCardApplied} error={giftCard?.error ?? null} />
          {physical && <GiftWrapToggle on={cart?.giftWrap ?? false} note={cart?.giftNote ?? ""} fee={settings.giftWrapFee} />}
          <dl className="space-y-3 border-t border-line pt-6 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">{t("subtotal")}</dt>
              <dd><Price amount={pricing.subtotal} /></dd>
            </div>
            {pricing.promoDiscount > 0 && (
              <div className="flex justify-between text-gold">
                <dt>{tp("offers")}</dt>
                <dd>−<Price amount={pricing.promoDiscount} /></dd>
              </div>
            )}
            {couponDiscount > 0 && (
              <div className="flex justify-between text-gold">
                <dt>{t("discountCode", { code: cart?.coupon?.code ?? "" })}</dt>
                <dd>−<Price amount={couponDiscount} /></dd>
              </div>
            )}
            {pricing.giftWrap > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted">{t("giftWrapping")}</dt>
                <dd><Price amount={pricing.giftWrap} /></dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-muted">{t("shipping")}</dt>
              <dd className="text-muted">{!physical ? t("sentByEmail") : pricing.subtotal - pricing.discount >= settings.freeShippingOver ? t("complimentary") : t("atCheckout")}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-4">
              <dt className="eyebrow !text-muted">{t("estimatedTotal")}</dt>
              <dd className="font-display text-3xl"><Price amount={pricing.total - pricing.shipping} /></dd>
            </div>
            {pricing.giftCardApplied > 0 && (
              <>
                <div className="flex justify-between text-gold">
                  <dt>{t("giftCard")}</dt>
                  <dd>−<Price amount={pricing.giftCardApplied} /></dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="eyebrow !text-muted">{t("toPay")}</dt>
                  <dd className="font-display text-2xl"><Price amount={Math.max(0, pricing.total - pricing.shipping - pricing.giftCardApplied)} /></dd>
                </div>
              </>
            )}
            <p className="text-xs text-subtle">{settings.taxInclusive ? t("taxIncludes", { percent: settings.taxRatePercent }) : t("taxAdded")}</p>
            <ConvertedNote />
          </dl>
          <Button asChild size="lg" className="w-full">
            <Link href="/checkout">{t("checkout")}</Link>
          </Button>
        </aside>
      </div>
    </div>
  );
}
