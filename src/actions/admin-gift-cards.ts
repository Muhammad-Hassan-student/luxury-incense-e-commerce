"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requireRole } from "@/server/roles";
import { audit } from "@/server/audit";
import { generateCode, sendGiftCardEmails, VALIDITY_DAYS } from "@/server/gift-cards";
import { cuid, done, fail, zodMessage } from "@/lib/admin-server";
import { toMinor, type ActionResult } from "@/lib/admin-shared";

const issueSchema = z.object({
  /** Major units */
  amount: z.number().min(1, "Enter an amount").max(1_000_000),
  recipient: z.string().trim().max(80),
  recipientEmail: z.string().trim().email("Enter a valid email").or(z.literal("")),
  message: z.string().trim().max(400),
  sendEmail: z.boolean(),
});

/** Goodwill / replacement cards issued by staff. Optionally emails the recipient. */
export async function issueGiftCard(input: z.infer<typeof issueSchema>): Promise<ActionResult> {
  const user = await requireRole("MANAGER");
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const d = parsed.data;
  if (d.sendEmail && !d.recipientEmail) return fail("Add the recipient’s email to send it.");

  const value = toMinor(d.amount);
  const card = await db.giftCard.create({
    data: {
      code: generateCode(),
      initial: value,
      balance: value,
      recipient: d.recipient || null,
      recipientEmail: d.recipientEmail || null,
      message: d.message || null,
      senderName: "Maison Oud",
      expiresAt: new Date(Date.now() + VALIDITY_DAYS * 864e5),
    },
  });
  await audit(user.id, "gift_card.issue", "GiftCard", card.id, { amount: value, emailed: d.sendEmail });
  if (d.sendEmail && card.recipientEmail) await sendGiftCardEmails([card], card.recipientEmail);
  revalidatePath("/admin/gift-cards");
  return done(`Issued ${card.code}`, card.id);
}

export async function setGiftCardActive(id: string, isActive: boolean): Promise<ActionResult> {
  const user = await requireRole("MANAGER");
  if (!cuid.safeParse(id).success) return fail("Invalid gift card.");
  const card = await db.giftCard.update({ where: { id }, data: { isActive } });
  await audit(user.id, isActive ? "gift_card.activate" : "gift_card.deactivate", "GiftCard", id, { code: card.code });
  revalidatePath("/admin/gift-cards");
  return done(isActive ? "Gift card reactivated" : "Gift card deactivated");
}
