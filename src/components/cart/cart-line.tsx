"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { Minus, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { removeItem, updateQuantity } from "@/actions/cart";
import { ProductArt } from "@/components/product/product-art";
import { Price } from "@/components/money";
import { cn } from "@/lib/utils";
import type { Model3D } from "@/generated/prisma/enums";
import { productHref } from "@/lib/product-href";
import { MediaImage } from "@/components/media";

export type CartLineView = {
  id: string;
  productSlug: string;
  name: string;
  label: string;
  model: Model3D;
  palette: string[];
  image: { src: string; cutout: boolean } | null;
  unitPrice: number;
  compareAtPrice: number | null;
  quantity: number;
  available: number;
  bundle: { name: string; label: string }[] | null;
  giftCard: { recipientName: string; recipientEmail: string } | null;
};

export function CartLine({ line, compact = false }: { line: CartLineView; compact?: boolean }) {
  const [pending, start] = useTransition();
  const [qty, setQty] = useOptimistic(line.quantity);

  const change = (next: number) =>
    start(async () => {
      setQty(next);
      const res = next <= 0 ? await removeItem(line.id) : await updateQuantity(line.id, next);
      if (!res.ok) toast.error(res.error);
      else if (res.message) toast(res.message);
    });

  const href = productHref(line.productSlug);
  return (
    <motion.li layout exit={{ opacity: 0, x: 40 }} className={cn("flex gap-5 py-6", pending && "opacity-60")}>
      <Link href={href} className={cn("relative shrink-0 overflow-hidden bg-bg-soft", compact ? "h-28 w-22" : "h-36 w-28")}>
        {line.image ? (
          <MediaImage src={line.image.src} alt="" sizes="112px" className={line.image.cutout ? "!object-contain p-2" : "photo-grade"} />
        ) : (
          <ProductArt model={line.model} palette={line.palette} animated={false} />
        )}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Link href={href} className="font-display text-xl leading-tight hover:text-gold">
              {line.name}
            </Link>
            <p className="mt-1 text-xs text-muted">
              {line.bundle
                ? line.bundle.map((b) => b.name).join(" · ")
                : line.giftCard
                  ? `${line.label} · for ${line.giftCard.recipientName} (${line.giftCard.recipientEmail})`
                  : line.label}
            </p>
            {line.available < line.quantity && <p className="mt-1 text-xs text-ember">Only {line.available} available</p>}
          </div>
          <button onClick={() => change(0)} aria-label={`Remove ${line.name}`} className="text-subtle transition-colors hover:text-fg">
            <X className="size-4" strokeWidth={1.2} />
          </button>
        </div>
        <div className="mt-auto flex items-end justify-between pt-4">
          {line.bundle || line.giftCard ? (
            <span className="text-xs text-muted">{line.bundle ? "Coffret × 1" : "Sent by email"}</span>
          ) : (
            <div className="flex items-center border border-line-strong">
              <button className="grid size-8 place-items-center hover:text-gold disabled:opacity-30" onClick={() => change(qty - 1)} aria-label="Decrease quantity">
                <Minus className="size-3" />
              </button>
              <span className="w-8 text-center text-sm tabular-nums" aria-live="polite">
                {qty}
              </span>
              <button
                className="grid size-8 place-items-center hover:text-gold disabled:opacity-30"
                onClick={() => change(qty + 1)}
                disabled={qty >= Math.min(10, line.available)}
                aria-label="Increase quantity"
              >
                <Plus className="size-3" />
              </button>
            </div>
          )}
          <Price amount={line.unitPrice * qty} compareAt={line.compareAtPrice ? line.compareAtPrice * qty : null} className="text-sm" />
        </div>
      </div>
    </motion.li>
  );
}

/** Progress towards complimentary shipping: a gold thread (scaleX, so it never reflows) with a glint at its tip. */
export function FreeShippingBar({ subtotal, threshold }: { subtotal: number; threshold: number }) {
  const pct = Math.min(1, subtotal / threshold);
  const done = pct >= 1;
  return (
    <div className="relative h-0.5 w-full overflow-hidden bg-line-strong" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
      <motion.div
        className="absolute inset-0 origin-left bg-gradient-to-r from-gold-soft to-gold rtl:origin-right rtl:bg-gradient-to-l"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: pct }}
        transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: 0.25 }}
      />
      {done && (
        <motion.span
          aria-hidden
          className="absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-transparent via-fg/70 to-transparent"
          initial={{ x: "-100%" }}
          animate={{ x: "700%" }}
          transition={{ duration: 1.4, ease: [0.65, 0, 0.35, 1], delay: 1.2 }}
        />
      )}
    </div>
  );
}
