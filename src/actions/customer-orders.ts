"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requireUser } from "@/server/roles";
import { rateLimit } from "@/server/rate-limit";
import { getOrCreateCart } from "@/server/cart";
import { SELF_CANCEL_REASONS, SelfCancelError, selfCancelOrder } from "@/server/invoices";
import { addCoffret, addToCart } from "@/actions/cart";

const orderNumber = z.string().trim().min(3).max(40).regex(/^[A-Z0-9-]+$/);

const cancelSchema = z.object({
  number: orderNumber,
  reason: z.enum(SELF_CANCEL_REASONS).nullish(),
  confirm: z.literal(true),
});

export type CancelResult = { ok: true; refunded: boolean } | { ok: false; error: string };

/** Customer cancels their own order before it is packed (refunded in full if paid online). */
export async function cancelMyOrder(input: z.input<typeof cancelSchema>): Promise<CancelResult> {
  const user = await requireUser();
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please confirm the cancellation." };
  if (!(await rateLimit("self-cancel", 5, 600)).ok) return { ok: false, error: "Too many attempts. Please try again in a few minutes." };
  try {
    const { mode } = await selfCancelOrder({ userId: user.id, orderNumber: parsed.data.number, reason: parsed.data.reason ?? null });
    revalidatePath(`/account/orders/${parsed.data.number}`);
    revalidatePath("/account/orders");
    revalidatePath("/account");
    return { ok: true, refunded: mode === "refund" };
  } catch (e) {
    if (e instanceof SelfCancelError) return { ok: false, error: e.message };
    console.error("[self-cancel] failed", e);
    return { ok: false, error: "Something went wrong and your order was not changed. Please try again or contact us." };
  }
}

export type BuyAgainResult =
  | {
      ok: true;
      added: string[];
      partial: { name: string; added: number; wanted: number }[];
      unavailable: string[];
      skipped: string[];
      notes: string[];
    }
  | { ok: false; error: string };

const MAX_QTY = 10;

/**
 * Adds every still-available physical item from a past order back to the bag.
 * Writes go through addToCart/addCoffret, so stock rules match the rest of the store.
 */
export async function buyAgain(input: { number: string }): Promise<BuyAgainResult> {
  const user = await requireUser();
  const parsed = z.object({ number: orderNumber }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Order not found." };
  if (!(await rateLimit("buy-again", 10, 60)).ok) return { ok: false, error: "Slow down a little and try again." };

  const order = await db.order.findFirst({
    where: { number: parsed.data.number, userId: user.id, reservedUntil: null },
    include: { items: { orderBy: { id: "asc" } } },
  });
  if (!order) return { ok: false, error: "Order not found." };

  const result = { added: [] as string[], partial: [] as { name: string; added: number; wanted: number }[], unavailable: [] as string[], skipped: [] as string[], notes: [] as string[] };

  for (const item of order.items) {
    const meta = item.meta as { giftCard?: unknown } | null;
    if (meta?.giftCard) {
      result.skipped.push(item.name);
      continue;
    }

    // Coffret: same four pieces, if they are all still on sale.
    if (item.components.length) {
      const res = item.components.length === 4 ? await addCoffret(item.components) : { ok: false as const, error: "" };
      if (res.ok) {
        result.added.push(item.name);
        if (item.quantity > 1) result.notes.push("One coffret per bag — add another after checkout.");
      } else {
        result.unavailable.push(item.name);
      }
      continue;
    }

    if (!item.variantId) {
      result.unavailable.push(item.name);
      continue;
    }
    const variant = await db.productVariant.findUnique({
      where: { id: item.variantId },
      select: { stock: true, reserved: true, product: { select: { isActive: true, isGiftCard: true } } },
    });
    if (!variant || !variant.product.isActive || variant.product.isGiftCard) {
      result.unavailable.push(item.name);
      continue;
    }
    // Ask addToCart only for what it would accept; it re-checks stock itself.
    const cart = await getOrCreateCart();
    const inBag = cart.items.find((i) => i.variantId === item.variantId)?.quantity ?? 0;
    const want = Math.min(item.quantity, MAX_QTY - inBag, variant.stock - variant.reserved - inBag);
    if (want <= 0) {
      if (inBag > 0 && variant.stock - variant.reserved > 0) result.notes.push(`${item.name} is already in your bag.`);
      else result.unavailable.push(item.name);
      continue;
    }
    const res = await addToCart(item.variantId, want);
    if (!res.ok) result.unavailable.push(item.name);
    else if (want < item.quantity) result.partial.push({ name: item.name, added: want, wanted: item.quantity });
    else result.added.push(item.name);
  }

  revalidatePath("/", "layout");
  return { ok: true, ...result };
}
