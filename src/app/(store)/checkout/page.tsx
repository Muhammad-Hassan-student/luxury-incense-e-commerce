import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { cartLines, getCart } from "@/server/cart";
import { quote } from "@/server/orders";
import { flag } from "@/server/settings";
import { paymentProviders } from "@/server/payments";
import { toLineView } from "@/components/cart/cart-drawer";
import { CheckoutClient } from "@/components/checkout/checkout-client";
import { getRegion } from "@/server/region";
import { razorpayAvailable } from "@/server/charge";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("checkout");
  return { title: t("metaTitle"), robots: { index: false } };
}

export default async function CheckoutPage() {
  const [cart, session, t] = await Promise.all([getCart(), auth(), getTranslations("checkout")]);
  const lines = await cartLines(cart);
  if (!lines.length) redirect("/cart");

  const user = session?.user ? await db.user.findUnique({ where: { id: session.user.id }, include: { addresses: { orderBy: { isDefault: "desc" } } } }) : null;
  const defaultAddress = user?.addresses[0];
  const region = await getRegion();
  const country = defaultAddress?.country ?? region.country;
  const { pricing, rates, rate, pointsBalance, giftCard } = await quote({ lines, cart, userId: user?.id, country });
  const hasDigital = lines.some((l) => l.digital);
  // Keys come from Admin → Integrations (env as fallback); only public values reach the browser.
  const online = await paymentProviders();
  const subscribing = lines.some((l) => l.subscription);

  const providers = [
    // Razorpay charges INR only (src/server/charge.ts): offered while the base currency is INR.
    online.razorpay && razorpayAvailable(region) && { id: "RAZORPAY" as const, label: t("providerRazorpay"), note: "Razorpay" },
    online.stripe && { id: "STRIPE" as const, label: t("providerStripe"), note: "Stripe" },
    // Gift cards are issued only against captured payments, so no COD for bags that contain them.
    // Subscribe & Save renews online, so a bag with a subscription is prepaid too.
    !hasDigital && !subscribing && (await flag("cod")) && { id: "COD" as const, label: t("providerCod"), note: t("providerCodNote") },
  ].filter((p) => p !== false);

  return (
    <CheckoutClient
      lines={lines.map(toLineView)}
      initialPricing={pricing}
      initialRates={rates.map((r) => ({ id: r.id, name: r.name, price: r.price, freeOver: r.freeOver, etaDays: r.etaDays }))}
      initialRateId={rate?.id ?? null}
      couponCode={cart?.coupon?.code ?? null}
      giftCard={giftCard ? { code: giftCard.code, error: giftCard.error } : null}
      allDigital={lines.every((l) => l.digital)}
      giftWrap={cart?.giftWrap ?? false}
      giftNote={cart?.giftNote ?? ""}
      providers={providers}
      signedIn={Boolean(user)}
      pointsBalance={pointsBalance}
      savedAddresses={(user?.addresses ?? []).map((a) => ({ id: a.id, fullName: a.fullName, phone: a.phone, line1: a.line1, line2: a.line2 ?? "", city: a.city, state: a.state, postalCode: a.postalCode, country: a.country }))}
      defaults={{ email: user?.email ?? cart?.email ?? "", phone: user?.phone ?? "" }}
      stripeKey={online.stripePublishableKey}
      razorpayKey={online.razorpayKeyId}
      analyticsItems={lines.map((l) => ({ id: l.variantId, name: l.name, variant: l.label, price: l.unitPrice, quantity: l.quantity }))}
      subscriptionNote={subscribing ? (user ? t("subscriptionNoteSignedIn") : t("subscriptionNoteGuest")) : null}
    />
  );
}
