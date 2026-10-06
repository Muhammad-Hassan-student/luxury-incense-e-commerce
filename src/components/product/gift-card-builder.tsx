"use client";

import { useState, useTransition } from "react";
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from "framer-motion";
import { toast } from "sonner";
import { addGiftCardToCart } from "@/actions/cart";
import { brand } from "@/config/brand";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useUI } from "@/store/ui";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useMoney } from "@/components/money";
import { MaskedHeading } from "@/components/motion/reveal";

type Amount = { variantId: string; label: string; price: number };

export function GiftCardBuilder({ palette, amounts, senderName, validityDays }: { palette: string[]; amounts: Amount[]; senderName: string; validityDays: number }) {
  const money = useMoney();
  const open = useUI((s) => s.open);
  const [variantId, setVariantId] = useState(amounts[1]?.variantId ?? amounts[0]?.variantId);
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [from, setFrom] = useState(senderName);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const amount = amounts.find((a) => a.variantId === variantId) ?? amounts[0];

  // The preview card tilts towards the pointer.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-12, 12]), { stiffness: 120, damping: 16 });
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [10, -10]), { stiffness: 120, damping: 16 });
  const sheen = useTransform(px, [-0.5, 0.5], ["0%", "100%"]);

  const submit = () =>
    start(async () => {
      const res = await addGiftCardToCart({ variantId, recipientName, recipientEmail, senderName: from || undefined, message: message || undefined });
      if (res.ok) {
        toast(res.message);
        open("cart");
      } else toast.error(res.error);
    });

  const [primary = "#1A1714", accent = "#C8A46A"] = palette;
  return (
    <div className="container-luxe pt-16">
      <p className="eyebrow mb-6">Gifting</p>
      <MaskedHeading as="h1" text={"Let them\nchoose"} italicLine={1} className="text-6xl md:text-9xl" />
      <p className="mt-6 max-w-lg text-muted">
        A {brand.name} gift card, sent by email with your message within minutes of payment. Redeemable on anything in the house for {Math.round(validityDays / 30)} months — any unused balance stays on the card.
      </p>

      <div className="mt-16 grid items-start gap-16 lg:grid-cols-2">
        {/* Live preview */}
        <div
          className="lg:sticky lg:top-28"
          onPointerMove={(e) => {
            if (e.pointerType === "touch") return;
            const r = e.currentTarget.getBoundingClientRect();
            px.set((e.clientX - r.left) / r.width - 0.5);
            py.set((e.clientY - r.top) / r.height - 0.5);
          }}
          onPointerLeave={() => {
            px.set(0);
            py.set(0);
          }}
        >
          <motion.div
            style={{ rotateX, rotateY, transformPerspective: 1200, background: `linear-gradient(135deg, ${primary}, #2a2420 60%, ${primary})` }}
            className="relative mx-auto aspect-[1.6/1] w-full max-w-xl overflow-hidden rounded-xl border border-gold/40 p-8 shadow-luxe md:p-10"
          >
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent"
              style={{ left: sheen, translateX: "-50%" }}
            />
            <div className="absolute inset-3 rounded-lg border border-gold/25" />
            <div className="relative flex h-full flex-col justify-between">
              <div className="flex items-start justify-between">
                <span className="font-display text-lg tracking-[0.4em]" style={{ color: accent }}>
                  {brand.name.toUpperCase()}
                </span>
                <span className="text-[0.5625rem] uppercase tracking-[0.3em]" style={{ color: accent }}>
                  Gift card
                </span>
              </div>
              <div>
                <AnimatePresence mode="wait">
                  <motion.p key={amount?.price} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.5, ease }} className="display text-5xl text-[#f3ede4] md:text-6xl">
                    {amount ? money(amount.price) : ""}
                  </motion.p>
                </AnimatePresence>
                <p className="mt-3 truncate font-display text-xl italic text-[#a89d8e]">
                  {recipientName ? `For ${recipientName}` : "For someone special"}
                  {from && <span className="not-italic text-[#6f665b]"> · from {from}</span>}
                </p>
              </div>
            </div>
          </motion.div>
          {message && <p className="mx-auto mt-8 max-w-xl text-center font-display text-2xl italic leading-relaxed text-muted">“{message}”</p>}
        </div>

        {/* Form */}
        <form
          className="space-y-10"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <fieldset>
            <legend className="eyebrow mb-4 !text-muted">Amount</legend>
            <div className="grid grid-cols-3 gap-3">
              {amounts.map((a) => (
                <button
                  key={a.variantId}
                  type="button"
                  onClick={() => setVariantId(a.variantId)}
                  aria-pressed={a.variantId === variantId}
                  className={cn("border py-5 font-display text-2xl transition-colors duration-500", a.variantId === variantId ? "border-gold text-fg" : "border-line text-muted hover:border-line-strong")}
                >
                  {money(a.price)}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-8 sm:grid-cols-2">
            <Field label="Recipient’s name">
              <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} required maxLength={80} />
            </Field>
            <Field label="Recipient’s email" hint="We’ll send the card here.">
              <Input type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} required />
            </Field>
          </div>
          <Field label="From">
            <Input value={from} onChange={(e) => setFrom(e.target.value)} maxLength={80} placeholder="Your name" />
          </Field>
          <Field label="Your message (optional)" hint={`${message.length}/400`}>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={400} placeholder="A few words to go with it." />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Adding…" : `Add gift card · ${amount ? money(amount.price) : ""}`}
          </Button>
          <p className="text-xs text-subtle">Gift cards are paid online, and promo codes don’t apply to them. Prices shown in other currencies are for reference; cards are issued in {brand.baseCurrency}.</p>
        </form>
      </div>
    </div>
  );
}
