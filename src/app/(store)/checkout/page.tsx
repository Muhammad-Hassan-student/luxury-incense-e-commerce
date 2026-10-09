import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { cartLines, getCart } from "@/server/cart";
import { quote } from "@/server/orders";
import { flag } from "@/server/settings";
import { paymentProviders } from "@/server/payments";
import { toLineView } from "@/components/cart/cart-drawer";
import { CheckoutClient } from "@/components/checkout/checkout-client";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage() {
  const [cart, session] = await Promise.all([getCart(), auth()]);
  const lines = await cartLines(cart);
  if (!lines.length) redirect("/cart");

  const user = session?.user ? await db.user.findUnique({ where: { id: session.user.id }, include: { addresses: { orderBy: { isDefault: "desc" } } } }) : null;
  const defaultAddress = user?.addresses[0];
  const country = defaultAddress?.country ?? "IN";
  const { pricing, rates, rate, pointsBalance, giftCard } = await quote({ lines, cart, userId: user?.id, country });
  const hasDigital = lines.some((l) => l.digital);
  // Keys come from Admin → Integrations (env as fallback); only public values reach the browser.
  const online = await paymentProviders();
  const subscribing = lines.some((l) => l.subscription);

  const providers = [
    online.razorpay && { id: "RAZORPAY" as const, label: "UPI, cards & netbanking", note: "Razorpay" },
    online.stripe && { id: "STRIPE" as const, label: "Card, Apple Pay & Google Pay", note: "Stripe" },
    // Gift cards are issued only against captured payments, so no COD for bags that contain them.
    // Subscribe & Save renews online, so a bag with a subscription is prepaid too.
    !hasDigital && !subscribing && (await flag("cod")) && { id: "COD" as const, label: "Cash on delivery", note: "Pay when it arrives" },
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
      subscriptionNote={subscribing ? (user ? "Your subscription starts with this order and renews automatically — skip, pause or cancel any time from your account." : "Sign in to start your subscription (or make it a one-time purchase in your bag).") : null}
    />
  );
}
