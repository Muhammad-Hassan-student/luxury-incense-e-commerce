"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { startRenewalPayment } from "@/actions/subscriptions";
import { verifyRazorpayAction } from "@/actions/checkout";
import { brand } from "@/config/brand";
import { Button } from "@/components/ui/button";
import { useMoney } from "@/components/money";

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

/** Pays an existing renewal order (Razorpay Checkout or Stripe Payment Element). */
export function PayRenewal(props: { token: string; number: string; total: number; stripeKey: string; razorpayKey: string; canStripe: boolean; canRazorpay: boolean }) {
  const money = useMoney();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [stripeSecret, setStripeSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stripePromise = useMemo<Promise<Stripe | null> | null>(() => (props.stripeKey ? loadStripe(props.stripeKey) : null), [props.stripeKey]);
  const done = () => router.push(`/pay/${props.token}?paid=1`);

  const pay = (prefer: "STRIPE" | "RAZORPAY") =>
    start(async () => {
      setError(null);
      const res = await startRenewalPayment(props.token, prefer);
      if (!res.ok) {
        if (res.paid) router.refresh();
        setError(res.error);
        return;
      }
      if (res.client.provider === "STRIPE") {
        setStripeSecret(res.client.clientSecret);
        return;
      }
      if (!(await loadRazorpay()) || !window.Razorpay) {
        setError("Couldn’t load the payment window. Check your connection and try again.");
        return;
      }
      const c = res.client;
      new window.Razorpay({
        key: props.razorpayKey,
        amount: c.amount,
        currency: brand.baseCurrency,
        order_id: c.razorpayOrderId,
        name: brand.name,
        description: `Renewal ${res.number}`,
        prefill: { name: c.name, email: c.email, contact: c.phone },
        theme: { color: "#C8A46A" },
        handler: async (r: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          const v = await verifyRazorpayAction({ orderId: res.orderId, razorpayOrderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature });
          if (v.ok) done();
          else toast.error(v.error);
        },
      }).open();
    });

  if (stripeSecret && stripePromise) {
    return (
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret: stripeSecret,
          appearance: { theme: "night", variables: { colorPrimary: "#c8a46a", colorBackground: "#14110f", colorText: "#f3ede4", fontFamily: "Inter, system-ui, sans-serif", borderRadius: "0px" } },
        }}
      >
        <StripeForm returnPath={`/pay/${props.token}?paid=1`} total={money(props.total)} />
      </Elements>
    );
  }
  return (
    <div className="space-y-4">
      {props.canRazorpay && (
        <Button size="lg" className="w-full" disabled={pending} onClick={() => pay("RAZORPAY")}>
          {pending ? "Opening…" : `Pay ${money(props.total)} · UPI or card`}
        </Button>
      )}
      {props.canStripe && (
        <Button size="lg" variant={props.canRazorpay ? "outline" : "primary"} className="w-full" disabled={pending} onClick={() => pay("STRIPE")}>
          {pending ? "Opening…" : `Pay ${money(props.total)} · card, Apple Pay or Google Pay`}
        </Button>
      )}
      {!props.canRazorpay && !props.canStripe && <p className="text-center text-sm text-ember">Online payments are unavailable right now — please try again later.</p>}
      {error && (
        <p role="alert" className="text-center text-sm text-ember">
          {error}
        </p>
      )}
    </div>
  );
}

function StripeForm({ returnPath, total }: { returnPath: string; total: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (!stripe || !elements) return;
        start(async () => {
          const { error } = await stripe.confirmPayment({ elements, confirmParams: { return_url: `${window.location.origin}${returnPath}` } });
          if (error) setError(error.message ?? "Payment failed.");
        });
      }}
    >
      <PaymentElement options={{ layout: "tabs" }} />
      {error && (
        <p className="text-sm text-ember" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={!stripe || pending}>
        {pending ? "Processing…" : `Pay ${total}`}
      </Button>
    </form>
  );
}
