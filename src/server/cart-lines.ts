import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { coffretPrice } from "@/lib/pricing";
import { db } from "./db";

export const cartInclude = {
  coupon: true,
  items: {
    orderBy: { id: "asc" },
    include: {
      variant: {
        include: {
          product: {
            select: {
              id: true,
              slug: true,
              name: true,
              model: true,
              palette: true,
              isActive: true,
              isGiftCard: true,
              images: { orderBy: { position: "asc" }, take: 3, select: { type: true, url: true, poster: true, cutoutUrl: true, display: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

export type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartInclude }>;

export type GiftCardMeta = { recipientName: string; recipientEmail: string; message?: string; senderName?: string };

/** Subscribe & Save choice on a regular line (discount resolved from settings when priced). */
export type SubscribeChoice = { intervalMonths: 1 | 2 | 3 };

/** CartItem.bundle holds coffret pieces, gift card delivery details, or a Subscribe & Save choice. */
export type Bundle = { variantIds?: string[]; giftCard?: GiftCardMeta; subscribe?: SubscribeChoice };

export type CartLine = {
  id: string;
  variantId: string;
  productSlug: string;
  name: string;
  label: string;
  sku: string;
  model: CartWithItems["items"][number]["variant"]["product"]["model"];
  palette: string[];
  /** Cover photo, if the product has media. `cutout` = background removed (show contained, not cropped). */
  image: { src: string; cutout: boolean } | null;
  unitPrice: number;
  compareAtPrice: number | null;
  quantity: number;
  available: number;
  /** Gift cards: no shipping, tax or discounts. */
  digital: boolean;
  giftCard: GiftCardMeta | null;
  bundle: { variantId: string; name: string; label: string; price: number }[] | null;
  /** Subscribe & Save line: unitPrice is already discounted. */
  subscription: { intervalMonths: 1 | 2 | 3; discountPercent: number } | null;
};

/** Subscribe & Save discount, read only when a bag has a subscribe line. */
async function subscribeDiscount(): Promise<number | null> {
  const row = await db.setting.findUnique({ where: { key: "subscriptions" } });
  const v = (row?.value ?? {}) as { enabled?: boolean; discountPercent?: number };
  if (v.enabled === false) return null;
  return typeof v.discountPercent === "number" && v.discountPercent >= 0 && v.discountPercent <= 50 ? Math.round(v.discountPercent) : 10;
}

function coverOf(media: { type: string; url: string; poster: string | null; cutoutUrl: string | null; display: string }[]) {
  const photo = media.find((m) => m.type === "IMAGE");
  if (photo?.cutoutUrl && photo.display !== "PHOTO") return { src: photo.cutoutUrl, cutout: true };
  const src = photo?.url ?? media.find((m) => m.poster)?.poster;
  return src ? { src, cutout: false } : null;
}

/** Resolves display/pricing lines, including coffret component prices. */
export async function cartLines(cart: CartWithItems | null): Promise<CartLine[]> {
  if (!cart) return [];
  const bundleIds = cart.items.flatMap((i) => ((i.bundle as Bundle | null)?.variantIds ?? []));
  const components = bundleIds.length
    ? await db.productVariant.findMany({
        where: { id: { in: bundleIds } },
        include: { product: { select: { name: true } } },
      })
    : [];
  const byId = new Map(components.map((c) => [c.id, c]));
  const subscribePct = cart.items.some((i) => (i.bundle as Bundle | null)?.subscribe) ? await subscribeDiscount() : null;

  return cart.items
    .filter((i) => i.variant.product.isActive)
    .map((i) => {
      const b = i.bundle as Bundle | null;
      const bundle = b?.variantIds
        ? b.variantIds
            .map((id) => byId.get(id))
            .filter((c) => c != null)
            .map((c) => ({ variantId: c.id, name: c.product.name, label: c.label, price: c.price }))
        : null;
      const componentAvail = bundle
        ? Math.min(...bundle.map((c) => {
            const v = byId.get(c.variantId)!;
            return v.stock - v.reserved;
          }))
        : Infinity;
      const sub = b?.subscribe && subscribePct !== null && !bundle && !i.variant.product.isGiftCard && [1, 2, 3].includes(b.subscribe.intervalMonths) ? { intervalMonths: b.subscribe.intervalMonths, discountPercent: subscribePct } : null;
      return {
        id: i.id,
        variantId: i.variantId,
        productSlug: i.variant.product.slug,
        name: i.variant.product.name,
        label: sub ? `${i.variant.label} · ${sub.intervalMonths === 1 ? "Every month" : `Every ${sub.intervalMonths} months`}${sub.discountPercent ? `, save ${sub.discountPercent}%` : ""}` : i.variant.label,
        sku: i.variant.sku,
        model: i.variant.product.model,
        palette: i.variant.product.palette,
        image: coverOf(i.variant.product.images),
        unitPrice: bundle ? coffretPrice(bundle.map((c) => c.price)) : sub ? Math.round((i.variant.price * (100 - sub.discountPercent)) / 100) : i.variant.price,
        compareAtPrice: bundle ? null : sub && sub.discountPercent ? i.variant.price : i.variant.compareAtPrice,
        quantity: i.quantity,
        available: Math.max(0, Math.min(i.variant.stock - i.variant.reserved, componentAvail)),
        digital: i.variant.product.isGiftCard,
        giftCard: b?.giftCard ?? null,
        bundle,
        subscription: sub,
      };
    });
}
