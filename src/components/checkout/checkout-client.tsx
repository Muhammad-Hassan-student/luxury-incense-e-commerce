"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { placeOrderAction, quoteAction, rememberCheckoutEmail, verifyRazorpayAction } from "@/actions/checkout";
import { checkoutSchema, type CheckoutInput } from "@/lib/checkout-schema";
import type { Pricing } from "@/lib/pricing";
import { brand } from "@/config/brand";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useMoney, useCurrency } from "@/components/money";
import { ProductArt } from "@/components/product/product-art";
import type { CartLineView } from "@/components/cart/cart-line";
import { GiftCardForm } from "@/components/cart/cart-extras";

type Rate = { id: string; name: string; price: number; freeOver: number | null; etaDays: string };
type Provider = { id: "STRIPE" | "RAZORPAY" | "COD"; label: string; note: string };
type Address = { id: string; fullName: string; phone: string; line1: string; line2: string; city: string; state: string; postalCode: string; country: string };

const countries: [string, string][] = [
  ["IN", "India"], ["AE", "United Arab Emirates"], ["SA", "Saudi Arabia"], ["QA", "Qatar"], ["OM", "Oman"], ["KW", "Kuwait"], ["BH", "Bahrain"],
  ["PK", "Pakistan"], ["GB", "United Kingdom"], ["US", "United States"], ["CA", "Canada"], ["AU", "Australia"], ["SG", "Singapore"], ["FR", "France"], ["DE", "Germany"],
];

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void };
  }
}

function loadRazorpay() {
  return new Promise<boolean>((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export function CheckoutClient(props: {
  lines: CartLineView[];
  initialPricing: Pricing;
  initialRates: Rate[];
  initialRateId: string | null;
  couponCode: string | null;
  giftCard: { code: string; error: string | null } | null;
  allDigital: boolean;
  giftWrap: boolean;
  giftNote: string;
  providers: Provider[];
  signedIn: boolean;
  pointsBalance: number;
  savedAddresses: Address[];
  defaults: { email: string; phone: string };
  stripeKey: string;
  razorpayKey: string;
}) {
  const router = useRouter();
  const money = useMoney();
  const currency = useCurrency();
  const [pricing, setPricing] = useState(props.initialPricing);
  const [rates, setRates] = useState(props.initialRates);
  const [quoting, startQuote] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const [stripeSession, setStripeSession] = useState<{ clientSecret: string; number: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const stripePromise = useMemo<Promise<Stripe | null> | null>(() => (props.stripeKey ? loadStripe(props.stripeKey) : null), [props.stripeKey]);

  const first = props.savedAddresses[0];
  const form = useForm<CheckoutInput>({
    resolver: zodResolver(checkoutSchema) as Resolver<CheckoutInput>,
    defaultValues: {
      email: props.defaults.email,
      fullName: first?.fullName ?? "",
      phone: first?.phone ?? props.defaults.phone,
      line1: first?.line1 ?? "",
      line2: first?.line2 ?? "",
      city: first?.city ?? "",
      state: first?.state ?? "",
      postalCode: first?.postalCode ?? "",
      country: first?.country ?? "IN",
      shippingRateId: props.initialRateId ?? "",
      provider: props.providers[0]?.id ?? "COD",
      pointsRequested: 0,
      giftWrap: props.giftWrap,
      giftNote: props.giftNote,
      deliveryDate: "",
      saveAddress: props.signedIn && !first,
    },
  });
  const { register, watch, setValue, handleSubmit, formState } = form;
  const errors = formState.errors;
  const [country, shippingRateId, pointsRequested, giftWrap, provider] = watch(["country", "shippingRateId", "pointsRequested", "giftWrap", "provider"]);

  // Re-quote on the server whenever something that changes the total changes.
  useEffect(() => {
    startQuote(async () => {
      const q = await quoteAction({ country, shippingRateId, pointsRequested: Number(pointsRequested) || 0, giftWrap });
      setPricing(q.pricing);
      setRates(q.rates);
      if (q.rateId && q.rateId !== shippingRateId) setValue("shippingRateId", q.rateId);
    });
  }, [country, shippingRateId, pointsRequested, giftWrap, setValue, props.giftCard?.code]);

  const fillAddress = (id: string) => {
    const a = props.savedAddresses.find((x) => x.id === id);
    if (!a) return;
    for (const k of ["fullName", "phone", "line1", "line2", "city", "state", "postalCode", "country"] as const) setValue(k, a[k], { shouldValidate: true });
  };

  const onSubmit = (data: CheckoutInput) =>
    startSubmit(async () => {
      setFormError(null);
      const res = await placeOrderAction({ ...data, pointsRequested: Number(data.pointsRequested) || 0 });
      if (!res.ok) {
        setFormError(res.error);
        for (const [k, v] of Object.entries(res.fieldErrors ?? {})) if (v?.[0]) form.setError(k as keyof CheckoutInput, { message: v[0] });
        toast.error(res.error);
        return;
      }
      if (!res.client) {
        router.push(`/checkout/success?order=${res.number}`);
        return;
      }
      if (res.client.provider === "STRIPE") {
        setStripeSession({ clientSecret: res.client.clientSecret, number: res.number });
        return;
      }
      const ok = await loadRazorpay();
      if (!ok || !window.Razorpay) {
        toast.error("Couldn’t load the payment window. Check your connection and try again.");
        return;
      }
      const c = res.client;
      const rzp = new window.Razorpay({
        key: props.razorpayKey,
        amount: c.amount,
        currency: brand.baseCurrency,
        order_id: c.razorpayOrderId,
        name: brand.name,
        description: `Order ${res.number}`,
        prefill: { name: c.name, email: c.email, contact: c.phone },
        theme: { color: "#C8A46A" },
        handler: async (r: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          const v = await verifyRazorpayAction({ orderId: res.orderId, razorpayOrderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature });
          if (v.ok) router.push(`/checkout/success?order=${res.number}`);
          else toast.error(v.error);
        },
        modal: { ondismiss: () => toast(`Payment window closed. Your pieces are held for ${brand.reservationMinutes} minutes — order ${res.number}.`) },
      });
      rzp.open();
    });

  const maxPoints = Math.floor(((pricing.subtotal - pricing.discount) * 0.2) / brand.loyalty.pointValue);
  return (
    <div className="container-luxe pt-12">
      <div className="mb-12 flex items-center justify-between">
        <h1 className="display text-5xl md:text-7xl">Checkout</h1>
        <span className="flex items-center gap-2 text-xs text-muted">
          <Lock className="size-3.5" /> Secure checkout
        </span>
      </div>

      <div className="grid gap-16 lg:grid-cols-[1fr_28rem]">
        <AnimatePresence mode="wait">
          {stripeSession && stripePromise ? (
            <motion.section key="pay" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.7, ease }}>
              <p className="eyebrow mb-6">Payment · Order {stripeSession.number}</p>
              <Elements
                stripe={stripePromise}
                options={{
                  clientSecret: stripeSession.clientSecret,
                  appearance: {
                    theme: "night",
                    variables: { colorPrimary: "#c8a46a", colorBackground: "#14110f", colorText: "#f3ede4", fontFamily: "Inter, system-ui, sans-serif", borderRadius: "0px" },
                  },
                }}
              >
                <StripePay number={stripeSession.number} total={money(pricing.payable)} />
              </Elements>
              <p className="mt-6 text-xs text-subtle">Your pieces are held for {brand.reservationMinutes} minutes while you pay.</p>
            </motion.section>
          ) : (
            <motion.form key="details" onSubmit={handleSubmit(onSubmit)} className="space-y-14" noValidate exit={{ opacity: 0, x: -30 }}>
              <Section n={1} title="Contact">
                <Field label="Email" error={errors.email?.message}>
                  <Input type="email" autoComplete="email" {...register("email", { onBlur: (e) => rememberCheckoutEmail(e.target.value) })} aria-invalid={Boolean(errors.email)} />
                </Field>
                {!props.signedIn && (
                  <p className="text-xs text-muted">
                    Have an account?{" "}
                    <Link href="/signin?callbackUrl=/checkout" className="link-draw text-gold">
                      Sign in
                    </Link>{" "}
                    to use saved addresses and earn {brand.loyalty.name}.
                  </p>
                )}
              </Section>

              <Section n={2} title={props.allDigital ? "Billing details" : "Delivery"}>
                {props.savedAddresses.length > 0 && (
                  <Field label="Saved addresses">
                    <Select onChange={(e) => fillAddress(e.target.value)} defaultValue={first?.id}>
                      {props.savedAddresses.map((a) => (
                        <option key={a.id} value={a.id} className="bg-bg">
                          {a.fullName} — {a.line1}, {a.city}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <div className="grid gap-8 sm:grid-cols-2">
                  <Field label="Full name" error={errors.fullName?.message}>
                    <Input autoComplete="name" {...register("fullName")} aria-invalid={Boolean(errors.fullName)} />
                  </Field>
                  <Field label="Phone" error={errors.phone?.message}>
                    <Input type="tel" autoComplete="tel" {...register("phone")} aria-invalid={Boolean(errors.phone)} />
                  </Field>
                </div>
                <Field label="Address" error={errors.line1?.message}>
                  <Input autoComplete="address-line1" {...register("line1")} aria-invalid={Boolean(errors.line1)} />
                </Field>
                <Field label="Apartment, suite (optional)">
                  <Input autoComplete="address-line2" {...register("line2")} />
                </Field>
                <div className="grid gap-8 sm:grid-cols-3">
                  <Field label="City" error={errors.city?.message}>
                    <Input autoComplete="address-level2" {...register("city")} aria-invalid={Boolean(errors.city)} />
                  </Field>
                  <Field label="State / region" error={errors.state?.message}>
                    <Input autoComplete="address-level1" {...register("state")} aria-invalid={Boolean(errors.state)} />
                  </Field>
                  <Field label="Postal code" error={errors.postalCode?.message}>
                    <Input autoComplete="postal-code" {...register("postalCode")} aria-invalid={Boolean(errors.postalCode)} />
                  </Field>
                </div>
                <Field label="Country">
                  <Select autoComplete="country" {...register("country")}>
                    {countries.map(([code, name]) => (
                      <option key={code} value={code} className="bg-bg">
                        {name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {props.signedIn && (
                  <label className="flex items-center gap-3 text-sm text-muted">
                    <input type="checkbox" {...register("saveAddress")} className="size-4 accent-[var(--gold)]" /> Save this address
                  </label>
                )}
              </Section>

              {!props.allDigital && <Section n={3} title="Shipping">
                <div className="grid gap-3">
                  {rates.map((r) => (
                    <label key={r.id} className={cn("flex cursor-pointer items-center justify-between border p-5 transition-colors", shippingRateId === r.id ? "border-gold" : "border-line hover:border-line-strong")}>
                      <span className="flex items-center gap-4">
                        <input type="radio" value={r.id} {...register("shippingRateId")} className="accent-[var(--gold)]" />
                        <span>
                          <span className="block text-sm">{r.name}</span>
                          <span className="block text-xs text-muted">{r.etaDays}{r.freeOver ? ` · free over ${money(r.freeOver)}` : ""}</span>
                        </span>
                      </span>
                      <span className="text-sm tabular-nums">{r.price ? money(r.price) : "Free"}</span>
                    </label>
                  ))}
                  {rates.length === 0 && <p className="text-sm text-ember">We don’t ship to this country yet.</p>}
                </div>
                <div className="grid gap-8 sm:grid-cols-2">
                  <Field label="Preferred delivery date (optional)" hint="We’ll do our best to time it for a gift.">
                    <Input type="date" min={new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10)} {...register("deliveryDate")} />
                  </Field>
                  <label className="flex items-center gap-3 self-end pb-3 text-sm">
                    <input type="checkbox" {...register("giftWrap")} className="size-4 accent-[var(--gold)]" /> Gift wrap with a hand-written note
                  </label>
                </div>
                {giftWrap && (
                  <Field label="Gift note">
                    <Textarea maxLength={300} {...register("giftNote")} placeholder="We’ll write it by hand." />
                  </Field>
                )}
              </Section>}

              {props.signedIn && props.pointsBalance > 0 && (
                <Section n={4} title={brand.loyalty.name}>
                  <p className="text-sm text-muted">
                    You have <span className="text-gold">{props.pointsBalance}</span> {brand.loyalty.name} ({money(props.pointsBalance * brand.loyalty.pointValue)}). Use up to {Math.min(maxPoints, props.pointsBalance)} on this order.
                  </p>
                  <Field label="Embers to use">
                    <Input type="number" min={0} max={Math.min(maxPoints, props.pointsBalance)} {...register("pointsRequested")} />
                  </Field>
                </Section>
              )}

              <Section n={props.signedIn && props.pointsBalance > 0 ? 5 : 4} title="Payment">
                <div className="grid gap-3">
                  {props.providers.map((p) => (
                    <label key={p.id} className={cn("flex cursor-pointer items-center justify-between border p-5 transition-colors", provider === p.id ? "border-gold" : "border-line hover:border-line-strong")}>
                      <span className="flex items-center gap-4">
                        <input type="radio" value={p.id} {...register("provider")} className="accent-[var(--gold)]" />
                        <span className="text-sm">{p.label}</span>
                      </span>
                      <span className="text-xs text-muted">{p.note}</span>
                    </label>
                  ))}
                  {props.providers.length === 0 && pricing.payable > 0 && <p className="text-sm text-ember">No payment method is configured. Add Stripe or Razorpay keys, or enable cash on delivery in admin.</p>}
                </div>
                {currency !== brand.baseCurrency && <p className="text-xs text-subtle">Prices are shown in {currency} for reference; you’ll be charged in {brand.baseCurrency}.</p>}
              </Section>

              {formError && <p className="text-sm text-ember" role="alert">{formError}</p>}
              <Button type="submit" size="lg" className="w-full" disabled={submitting || quoting || (!props.providers.length && pricing.payable > 0) || (!props.allDigital && !rates.length)}>
                {submitting ? "Placing order…" : provider === "COD" || pricing.payable === 0 ? `Place order · ${money(pricing.payable)}` : `Continue to payment · ${money(pricing.payable)}`}
              </Button>
            </motion.form>
          )}
        </AnimatePresence>

        <aside className={cn("h-fit border border-line bg-bg-elev p-8 transition-opacity lg:sticky lg:top-28", quoting && "opacity-60")}>
          <p className="eyebrow mb-6">Order summary</p>
          <ul className="space-y-5">
            {props.lines.map((l) => (
              <li key={l.id} className="flex gap-4">
                <div className="relative h-20 w-16 shrink-0 bg-bg-soft">
                  <ProductArt model={l.model} palette={l.palette} animated={false} />
                  <span className="absolute -end-2 -top-2 grid size-5 place-items-center rounded-full bg-gold text-[0.625rem] text-bg">{l.quantity}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg leading-tight">{l.name}</p>
                  <p className="truncate text-xs text-muted">{l.bundle ? l.bundle.map((b) => b.name).join(" · ") : l.label}</p>
                </div>
                <span className="text-sm tabular-nums">{money(l.unitPrice * l.quantity)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-8 space-y-3 border-t border-line pt-6 text-sm">
            <Row label="Subtotal" value={money(pricing.subtotal)} />
            {pricing.discount > 0 && <Row label={`Discount${props.couponCode ? ` (${props.couponCode})` : ""}`} value={`−${money(pricing.discount)}`} gold />}
            {pricing.pointsValue > 0 && <Row label={`${brand.loyalty.name} (${pricing.pointsRedeemed})`} value={`−${money(pricing.pointsValue)}`} gold />}
            {pricing.giftWrap > 0 && <Row label="Gift wrapping" value={money(pricing.giftWrap)} />}
            <Row label="Shipping" value={props.allDigital ? "Sent by email" : pricing.shipping ? money(pricing.shipping) : "Complimentary"} />
            <div className="flex items-baseline justify-between border-t border-line pt-4">
              <dt className="eyebrow !text-muted">Total</dt>
              <dd className="font-display text-3xl tabular-nums">{money(pricing.total)}</dd>
            </div>
            {pricing.giftCardApplied > 0 && (
              <>
                <Row label="Gift card" value={`−${money(pricing.giftCardApplied)}`} gold />
                <div className="flex items-baseline justify-between">
                  <dt className="eyebrow !text-muted">To pay</dt>
                  <dd className="font-display text-2xl tabular-nums">{money(pricing.payable)}</dd>
                </div>
              </>
            )}
            {pricing.tax > 0 && <p className="text-xs text-subtle">Includes {money(pricing.tax)} tax</p>}
          </dl>
          {!stripeSession && (!props.allDigital || props.giftCard) && (
            <div className="mt-6 border-t border-line pt-5">
              <GiftCardForm applied={props.giftCard?.code ?? null} appliedAmount={pricing.giftCardApplied} error={props.giftCard?.error ?? null} />
            </div>
          )}
          {props.signedIn && (
            <p className="mt-6 border-t border-line pt-4 text-xs text-muted">
              You’ll earn <span className="text-gold">{Math.floor(pricing.payable / 10000) * brand.loyalty.earnPer100}</span> {brand.loyalty.name} on this order.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-8">
      <h2 className="flex items-baseline gap-4 border-b border-line pb-4">
        <span className="font-display text-sm italic text-gold">0{n}</span>
        <span className="font-display text-3xl">{title}</span>
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div className={cn("flex justify-between", gold && "text-gold")}>
      <dt className={gold ? undefined : "text-muted"}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function StripePay({ number, total }: { number: string; total: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!stripe || !elements) return;
        start(async () => {
          const { error } = await stripe.confirmPayment({
            elements,
            confirmParams: { return_url: `${window.location.origin}/checkout/success?order=${number}` },
          });
          // Only reached on immediate failure; success redirects.
          if (error) setError(error.message ?? "Payment failed.");
        });
      }}
      className="space-y-8"
    >
      <PaymentElement options={{ layout: "tabs" }} />
      {error && <p className="text-sm text-ember" role="alert">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={!stripe || pending}>
        {pending ? "Processing…" : `Pay ${total}`}
      </Button>
    </form>
  );
}
