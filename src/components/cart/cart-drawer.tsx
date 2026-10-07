import { brand } from "@/config/brand";
import { cartLines, getCart, type CartLine } from "@/server/cart";
import { alsoLikeForCart } from "@/server/recommendations";
import type { ProductCardData } from "@/server/catalog";
import { CartDrawerClient } from "./cart-drawer-client";
import type { CartLineView } from "./cart-line";
import type { SuggestionView } from "./cart-suggestions";

export const toLineView = (l: CartLine): CartLineView => ({
  id: l.id,
  productSlug: l.productSlug,
  name: l.name,
  label: l.label,
  model: l.model,
  palette: l.palette,
  image: l.image,
  unitPrice: l.unitPrice,
  compareAtPrice: l.compareAtPrice,
  quantity: l.quantity,
  available: l.available,
  bundle: l.bundle?.map(({ name, label }) => ({ name, label })) ?? null,
  giftCard: l.giftCard ? { recipientName: l.giftCard.recipientName, recipientEmail: l.giftCard.recipientEmail } : null,
});

/** Compact view of a recommended product for the bag. */
export function toSuggestion(p: ProductCardData): SuggestionView {
  const photo = p.images.find((m) => m.type === "IMAGE");
  const firstInStock = p.variants.find((v) => v.stock - v.reserved > 0) ?? p.variants[0];
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    subtitle: p.subtitle,
    model: p.model,
    palette: p.palette,
    price: firstInStock?.price ?? 0,
    image: photo ? (photo.cutoutUrl && photo.display !== "PHOTO" ? { src: photo.cutoutUrl, cutout: true } : { src: photo.url, cutout: false }) : null,
  };
}

export async function CartDrawer() {
  const cart = await getCart();
  const lines = await cartLines(cart);
  // Small "you may also like" — only once the bag has something in it; never fails the drawer.
  const suggestions = lines.length ? await alsoLikeForCart(cart!.items.map((i) => i.variant.productId)).catch(() => []) : [];
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  // Gift cards don't ship, so they don't count towards free shipping.
  const goods = lines.filter((l) => !l.digital).reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  return <CartDrawerClient lines={lines.map(toLineView)} subtotal={subtotal} goodsSubtotal={goods} freeShippingOver={brand.freeShippingOver} suggestions={suggestions.map(toSuggestion)} />;
}
