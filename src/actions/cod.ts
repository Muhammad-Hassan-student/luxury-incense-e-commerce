"use server";

import { z } from "zod";
import { answerCodLink } from "@/server/cod";
import { rateLimit } from "@/server/rate-limit";

const schema = z.object({ token: z.string().min(10).max(200), decision: z.enum(["confirm", "cancel"]) });

const MESSAGES: Record<string, { ok: boolean; text: string }> = {
  confirmed: { ok: true, text: "Thank you — your order is confirmed. We’ll write when it ships." },
  already_confirmed: { ok: true, text: "This order is already confirmed." },
  cancelled: { ok: true, text: "Your order has been cancelled. Nothing is due." },
  already_cancelled: { ok: true, text: "This order was already cancelled." },
  closed: { ok: false, text: "This order can’t be changed here any more. Please contact us." },
  expired: { ok: false, text: "This link has expired. Please contact us if you still want the order." },
  invalid: { ok: false, text: "This link isn’t valid any more." },
};

/** Customer answers the COD confirmation from the web link (no sign-in; the signed single-use token is the proof). */
export async function answerCodLinkAction(input: z.input<typeof schema>) {
  if (!(await rateLimit("cod-link", 20, 600)).ok) return { ok: false, text: "Too many attempts. Please wait a few minutes." };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return MESSAGES.invalid;
  const r = await answerCodLink(parsed.data.token, parsed.data.decision);
  return { ...MESSAGES[r], result: r };
}
