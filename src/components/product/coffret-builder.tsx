"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { addCoffret } from "@/actions/cart";
import { coffretPrice } from "@/lib/pricing";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useUI } from "@/store/ui";
import { Button } from "@/components/ui/button";
import { useMoney } from "@/components/money";
import { MaskedHeading } from "@/components/motion/reveal";
import { ProductArt } from "./product-art";
import type { Model3D } from "@/generated/prisma/enums";

type Option = { variantId: string; productSlug: string; name: string; label: string; price: number; model: Model3D; palette: string[]; category: string };

const SLOTS = 4;

export function CoffretBuilder({ options }: { options: Option[] }) {
  const money = useMoney();
  const open = useUI((s) => s.open);
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const chosen = picked.map((id) => options.find((o) => o.variantId === id)!).filter(Boolean);
  const full = chosen.reduce((s, o) => s + o.price, 0);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= SLOTS ? p : [...p, id]));

  const add = () =>
    start(async () => {
      const res = await addCoffret(picked);
      if (res.ok) {
        toast(res.message);
        setPicked([]);
        open("cart");
      } else toast.error(res.error);
    });

  return (
    <div className="container-luxe pt-16">
      <p className="eyebrow mb-6">Bespoke gifting</p>
      <MaskedHeading as="h1" text={"Build your\ncoffret"} italicLine={1} className="text-6xl md:text-9xl" />
      <p className="mt-6 max-w-lg text-muted">Choose any four pieces. We nest them in a hand-lined coffret, wrap it in handmade paper and write your note by hand. The set is 10% off.</p>

      <div className="mt-16 grid gap-12 lg:grid-cols-[1fr_24rem]">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {options.map((o) => {
            const selected = picked.includes(o.variantId);
            const disabled = !selected && picked.length >= SLOTS;
            return (
              <button
                key={o.variantId}
                onClick={() => toggle(o.variantId)}
                disabled={disabled}
                aria-pressed={selected}
                className={cn("group relative border text-start transition-all duration-500", selected ? "border-gold" : "border-line hover:border-line-strong", disabled && "opacity-40")}
              >
                <div className="aspect-square bg-bg-elev">
                  <ProductArt model={o.model} palette={o.palette} animated={false} />
                </div>
                <div className="p-4">
                  <p className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">{o.category}</p>
                  <p className="mt-1 font-display text-xl leading-tight">{o.name}</p>
                  <p className="mt-1 text-xs text-muted">
                    {o.label} · {money(o.price)}
                  </p>
                </div>
                <AnimatePresence>
                  {selected && (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute end-3 top-3 grid size-7 place-items-center rounded-full bg-gold text-bg">
                      <Check className="size-3.5" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            );
          })}
        </div>

        <aside className="h-fit border border-line bg-bg-elev p-8 lg:sticky lg:top-28">
          <p className="eyebrow mb-6">Your coffret</p>
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: SLOTS }, (_, i) => {
              const o = chosen[i];
              return (
                <div key={i} className="relative aspect-square border border-dashed border-line-strong">
                  <AnimatePresence mode="popLayout">
                    {o ? (
                      <motion.div key={o.variantId} initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.5, ease }} className="absolute inset-0 bg-bg-soft">
                        <ProductArt model={o.model} palette={o.palette} animated={false} />
                        <button onClick={() => toggle(o.variantId)} aria-label={`Remove ${o.name}`} className="absolute end-1 top-1 grid size-6 place-items-center bg-bg/70 hover:text-gold">
                          <X className="size-3" />
                        </button>
                      </motion.div>
                    ) : (
                      <span className="absolute inset-0 grid place-items-center font-display text-3xl italic text-subtle">{i + 1}</span>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
          <dl className="mt-8 space-y-2 border-t border-line pt-6 text-sm">
            <div className="flex justify-between text-muted">
              <dt>Pieces</dt>
              <dd className="tabular-nums">{money(full)}</dd>
            </div>
            <div className="flex justify-between text-gold">
              <dt>Coffret saving</dt>
              <dd className="tabular-nums">−{money(full - coffretPrice(chosen.map((o) => o.price)))}</dd>
            </div>
            <div className="flex items-baseline justify-between pt-2">
              <dt className="eyebrow !text-muted">Total</dt>
              <dd className="font-display text-3xl tabular-nums">{money(coffretPrice(chosen.map((o) => o.price)))}</dd>
            </div>
          </dl>
          <Button size="lg" className="mt-8 w-full" disabled={picked.length !== SLOTS || pending} onClick={add}>
            {picked.length === SLOTS ? (pending ? "Wrapping…" : "Add coffret to bag") : `Choose ${SLOTS - picked.length} more`}
          </Button>
        </aside>
      </div>
    </div>
  );
}
