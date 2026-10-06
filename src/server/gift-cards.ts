import "server-only";
import { randomInt } from "node:crypto";
import type { GiftCard, Prisma } from "@/generated/prisma/client";
import { formatMoney } from "@/lib/money";
import { GiftCardEmail } from "@/emails/gift-card";
import { db } from "./db";
import { sendEmail } from "./email";
import type { GiftCardMeta } from "./cart-lines";

type Tx = Prisma.TransactionClient;

export class GiftCardError extends Error {}

// No 0/O/1/I so codes survive being read aloud or handwritten.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const VALIDITY_DAYS = 365;

export function generateCode() {
  const block = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `MO-${block()}-${block()}-${block()}`;
}

export const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");

export function giftCardProblem(card: Pick<GiftCard, "isActive" | "expiresAt" | "balance"> | null, now = new Date()) {
  if (!card || !card.isActive) return "That gift card code isn’t valid.";
  if (card.expiresAt && card.expiresAt < now) return "This gift card has expired.";
  if (card.balance <= 0) return "This gift card has no balance left.";
  return null;
}

export async function findGiftCard(code: string) {
  const card = await db.giftCard.findUnique({ where: { code: normalizeCode(code) } });
  return { card, error: giftCardProblem(card) };
}

/** Atomically takes `amount` from the card for a pending order. Throws if it's no longer available. */
export async function holdGiftCard(tx: Tx, code: string, amount: number) {
  const n = await tx.$executeRaw`
    UPDATE "GiftCard" SET balance = balance - ${amount}, "updatedAt" = now()
    WHERE code = ${code} AND "isActive" = true AND balance >= ${amount}
      AND ("expiresAt" IS NULL OR "expiresAt" > now())`;
  if (n !== 1) throw new GiftCardError("Your gift card balance changed — please review your order.");
}

export async function restoreGiftCard(tx: Tx, code: string, amount: number) {
  if (amount > 0) await tx.$executeRaw`UPDATE "GiftCard" SET balance = balance + ${amount}, "updatedAt" = now() WHERE code = ${code}`;
}

/** Creates one card per purchased unit. Runs inside the order-confirmation transaction. */
export async function issueGiftCards(
  tx: Tx,
  order: { id: string; email: string; items: { unitPrice: number; quantity: number; meta: unknown }[] },
) {
  const expiresAt = new Date(Date.now() + VALIDITY_DAYS * 864e5);
  const issued: GiftCard[] = [];
  for (const item of order.items) {
    const meta = item.meta as { giftCard?: GiftCardMeta } | null;
    if (!meta?.giftCard) continue;
    for (let i = 0; i < item.quantity; i++) {
      issued.push(
        await tx.giftCard.create({
          data: {
            code: generateCode(),
            initial: item.unitPrice,
            balance: item.unitPrice,
            recipient: meta.giftCard.recipientName,
            recipientEmail: meta.giftCard.recipientEmail || order.email,
            senderName: meta.giftCard.senderName,
            message: meta.giftCard.message,
            sourceOrderId: order.id,
            expiresAt,
          },
        }),
      );
    }
  }
  return issued;
}

/** Cards bought by a cancelled/refunded order stop working; anything already spent stays spent. */
export async function voidIssuedGiftCards(tx: Tx, orderId: string) {
  await tx.giftCard.updateMany({ where: { sourceOrderId: orderId }, data: { isActive: false, balance: 0 } });
}

export async function sendGiftCardEmails(cards: GiftCard[], buyerEmail: string) {
  for (const card of cards) {
    const to = card.recipientEmail ?? buyerEmail;
    await sendEmail({
      to,
      subject: card.senderName ? `${card.senderName} sent you a Maison Oud gift card` : "A Maison Oud gift card for you",
      react: GiftCardEmail({ card }),
      devLog: `Gift card ${card.code} (${formatMoney(card.initial)}) for ${to}`,
    }).catch((e) => console.error("[gift-cards] email failed", e));
  }
}
