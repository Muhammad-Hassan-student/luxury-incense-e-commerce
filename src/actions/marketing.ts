"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requireUser } from "@/server/roles";
import { rateLimit } from "@/server/rate-limit";
import { setJourneyEmails, verifyUnsubscribeToken } from "@/server/marketing";

type Result = { ok: true; message: string } | { ok: false; error: string };

/** Account page toggle for journey emails (welcome, reminders, offers). */
export async function setMyJourneyEmails(allowed: boolean): Promise<Result> {
  const session = await requireUser();
  if (typeof allowed !== "boolean") return { ok: false, error: "Invalid choice." };
  if (!(await rateLimit("journey-pref", 20, 60)).ok) return { ok: false, error: "Too many changes. Try again in a minute." };
  const user = await db.user.findUnique({ where: { id: session.id }, select: { email: true } });
  if (!user) return { ok: false, error: "Account not found." };
  await setJourneyEmails(user.email, allowed, "account");
  revalidatePath("/account");
  return { ok: true, message: allowed ? "You’ll hear from us now and then." : "No more journey emails." };
}

const tokenSchema = z.object({ token: z.string().min(10).max(600), allowed: z.boolean() });

/** From the signed link in an email — no sign-in needed. */
export async function setJourneyEmailsByToken(input: z.input<typeof tokenSchema>): Promise<Result> {
  if (!(await rateLimit("unsubscribe", 20, 60)).ok) return { ok: false, error: "Too many attempts. Try again in a minute." };
  const parsed = tokenSchema.safeParse(input);
  const email = parsed.success ? verifyUnsubscribeToken(parsed.data.token) : null;
  if (!parsed.success || !email) return { ok: false, error: "This link isn’t valid. Use the link from the email, or sign in to change your preferences." };
  await setJourneyEmails(email, parsed.data.allowed, "link");
  return { ok: true, message: parsed.data.allowed ? "You’re subscribed again." : "You’ve been unsubscribed." };
}
