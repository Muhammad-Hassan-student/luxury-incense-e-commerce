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
            select: { id: true, slug: true, name: true, model: true, palette: true, isActive: true, isGiftCard: true },
          },
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

export type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartInclude }>;

export type GiftCardMeta = { recipientName: string; recipientEmail: string; message?: string; senderName?: string };

/** CartItem.bundle holds coffret pieces or gift card delivery details. */
export type Bundle = { variantIds?: string[]; giftCard?: GiftCardMeta };

export type CartLine = {
  id: string;
  variantId: string;
  productSlug: string;
  name: string;
  label: string;
  sku: string;
  model: CartWithItems["items"][number]["variant"]["product"]["model"];
  palette: string[];
  unitPrice: number;
  compareAtPrice: number | null;
  quantity: number;
  available: number;
  /** Gift cards: no shipping, tax or discounts. */
  digital: boolean;
  giftCard: GiftCardMeta | null;
  bundle: { variantId: string; name: string; label: string; price: number }[] | null;
};

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
      return {
        id: i.id,
        variantId: i.variantId,
        productSlug: i.variant.product.slug,
        name: i.variant.product.name,
        label: i.variant.label,
        sku: i.variant.sku,
        model: i.variant.product.model,
        palette: i.variant.product.palette,
        unitPrice: bundle ? coffretPrice(bundle.map((c) => c.price)) : i.variant.price,
        compareAtPrice: bundle ? null : i.variant.compareAtPrice,
        quantity: i.quantity,
        available: Math.max(0, Math.min(i.variant.stock - i.variant.reserved, componentAvail)),
        digital: i.variant.product.isGiftCard,
        giftCard: b?.giftCard ?? null,
        bundle,
      };
    });
}
