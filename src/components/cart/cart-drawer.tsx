import { brand } from "@/config/brand";
import { cartLines, getCart, type CartLine } from "@/server/cart";
import { CartDrawerClient } from "./cart-drawer-client";
import type { CartLineView } from "./cart-line";

export const toLineView = (l: CartLine): CartLineView => ({
  id: l.id,
  productSlug: l.productSlug,
  name: l.name,
  label: l.label,
  model: l.model,
  palette: l.palette,
  unitPrice: l.unitPrice,
  compareAtPrice: l.compareAtPrice,
  quantity: l.quantity,
  available: l.available,
  bundle: l.bundle?.map(({ name, label }) => ({ name, label })) ?? null,
  giftCard: l.giftCard ? { recipientName: l.giftCard.recipientName, recipientEmail: l.giftCard.recipientEmail } : null,
});

export async function CartDrawer() {
  const lines = await cartLines(await getCart());
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  // Gift cards don't ship, so they don't count towards free shipping.
  const goods = lines.filter((l) => !l.digital).reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  return <CartDrawerClient lines={lines.map(toLineView)} subtotal={subtotal} goodsSubtotal={goods} freeShippingOver={brand.freeShippingOver} />;
}
