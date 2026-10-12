"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/roles";
import { rateLimit } from "@/server/rate-limit";
import { db } from "@/server/db";
import { savePreferences, sendTestPush } from "@/server/push";

type Result = { ok: true; message?: string } | { ok: false; error: string };

const prefsSchema = z.object({ orders: z.boolean(), backInStock: z.boolean(), priceDrop: z.boolean(), abandonedBag: z.boolean(), news: z.boolean() }).partial();

/** Customer: which push channels they want. */
export async function saveNotificationPrefs(input: z.input<typeof prefsSchema>): Promise<Result> {
  const user = await requireUser("/account/notifications");
  const parsed = prefsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid preferences." };
  await savePreferences(user.id, parsed.data);
  revalidatePath("/account/notifications");
  return { ok: true };
}

/** Customer: remove one of their devices. */
export async function removeMyDevice(id: string): Promise<Result> {
  const user = await requireUser("/account/notifications");
  if (!z.string().min(1).max(64).safeParse(id).success) return { ok: false, error: "Invalid device." };
  await db.pushSubscription.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/account/notifications");
  return { ok: true };
}

/** Customer: a test notification to their own devices. */
export async function sendMyTestPush(): Promise<Result> {
  const user = await requireUser("/account/notifications");
  if (!(await rateLimit(`push-test:${user.id}`, 3, 300)).ok) return { ok: false, error: "Please wait a few minutes before sending another test." };
  const r = await sendTestPush(user.id, { title: "Maison Oud", body: "Notifications are on. We’ll only write when it matters.", url: "/account/notifications", tag: "test" });
  if (r.skipped === "no_devices") return { ok: false, error: "Turn on notifications on this device first." };
  if (r.skipped === "disabled") return { ok: false, error: "Notifications are switched off for the store right now." };
  return r.sent ? { ok: true, message: "Sent — it should arrive in a moment." } : { ok: false, error: "Your browser’s push service didn’t accept it. Try turning notifications off and on." };
}
