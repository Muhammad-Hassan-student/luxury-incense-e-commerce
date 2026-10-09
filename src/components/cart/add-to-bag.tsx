"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { addToCart } from "@/actions/cart";
import { bumpBag, flyToBag } from "@/lib/fly-to-bag";
import { useUI } from "@/store/ui";
import type { Model3D } from "@/generated/prisma/enums";
import { ProductArt } from "@/components/product/product-art";
import { MediaImage } from "@/components/media";

export type AddedItem = { name: string; label?: string; model: Model3D; palette: string[]; image?: { src: string; cutout: boolean } | null };

/** The "added" toast: what went in, and a way straight to the bag. */
function AddedToast({ id, item, qty }: { id: string | number; item: AddedItem; qty: number }) {
  const t = useTranslations("cart");
  return (
    <div className="flex w-full items-center gap-4">
      <span className="relative block h-14 w-11 shrink-0 overflow-hidden bg-bg-soft">
        {item.image ? (
          <MediaImage src={item.image.src} alt="" sizes="44px" className={item.image.cutout ? "!object-contain p-1" : "photo-grade"} />
        ) : (
          <ProductArt model={item.model} palette={item.palette} animated={false} />
        )}
        <span className="absolute -end-0 -top-0 grid size-4 place-items-center bg-gold text-bg">
          <Check className="size-2.5" strokeWidth={2.5} />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="eyebrow block !text-[0.5625rem]">{t("added")}</span>
        <span className="mt-1 block truncate font-display text-lg leading-tight">{item.name}</span>
        {(item.label || qty > 1) && (
          <span className="block truncate text-xs text-muted">
            {[item.label, qty > 1 ? `× ${qty}` : null].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => {
          toast.dismiss(id);
          useUI.getState().open("cart");
        }}
        className="press shrink-0 border border-line-strong px-3 py-2 text-[0.625rem] uppercase tracking-[0.24em] transition-colors hover:border-gold hover:text-gold"
      >
        {t("viewBag")}
      </button>
    </div>
  );
}

/**
 * Add a variant to the bag with the full choreography: the image tosses into the header bag while the
 * request runs, the bag bumps as it lands, then a refined toast confirms. Errors fall back to an error toast.
 */
export function useAddToBag() {
  const [pending, start] = useTransition();
  const add = ({ variantId, qty = 1, source, art, item, onAdded }: { variantId: string; qty?: number; source?: Element | null; art?: Element | null; item: AddedItem; onAdded?: () => void }) =>
    start(async () => {
      const flight = flyToBag(source, art);
      const res = await addToCart(variantId, qty);
      await flight;
      if (res.ok) {
        bumpBag();
        toast.custom((id) => <AddedToast id={id} item={item} qty={qty} />, { duration: 4500 });
        onAdded?.();
      } else toast.error(res.error);
    });
  return { add, pending };
}
