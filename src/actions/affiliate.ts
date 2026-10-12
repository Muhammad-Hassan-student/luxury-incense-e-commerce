"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { rateLimit } from "@/server/rate-limit";
import { getAffiliateSettings, joinProgram } from "@/server/affiliates";

type Result = { ok: true; message?: string } | { ok: false; error: string };

/** Customer applies to the affiliate programme (an emailed invite for this address is accepted straight away). */
export async function joinAffiliateProgram(): Promise<Result> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: "Sign in first." };
  if (!(await rateLimit("aff-join", 5, 300)).ok) return { ok: false, error: "Please try again in a few minutes." };
  if (!(await getAffiliateSettings()).enabled) return { ok: false, error: "The programme isn’t open right now." };
  const a = await joinProgram({ id: session.user.id, email: session.user.email, name: session.user.name ?? null });
  revalidatePath("/account/affiliate");
  return { ok: true, message: a.status === "APPROVED" ? "You’re in — your link is ready." : "Application sent." };
}

const payoutSchema = z.object({ details: z.string().trim().max(200) });

export async function saveAffiliatePayoutDetails(input: z.input<typeof payoutSchema>): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign in first." };
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Keep it under 200 characters." };
  const updated = await db.affiliate.updateMany({ where: { userId: session.user.id }, data: { payoutDetails: parsed.data.details || null } });
  if (!updated.count) return { ok: false, error: "You’re not in the programme yet." };
  revalidatePath("/account/affiliate");
  return { ok: true, message: "Saved" };
}
