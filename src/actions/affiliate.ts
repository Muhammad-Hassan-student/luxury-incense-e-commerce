"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { rateLimit } from "@/server/rate-limit";
import { getAffiliateSettings, joinProgram } from "@/server/affiliates";

type Result = { ok: true; message?: string } | { ok: false; error: string };

/** Customer applies to the affiliate programme (an emailed invite for this address is accepted straight away). */
export async function joinAffiliateProgram(): Promise<Result> {
  const session = await auth();
  const t = await getTranslations("affiliate");
  if (!session?.user?.email) return { ok: false, error: t("signInFirst") };
  if (!(await rateLimit("aff-join", 5, 300)).ok) return { ok: false, error: t("tryLater") };
  if (!(await getAffiliateSettings()).enabled) return { ok: false, error: t("notOpen") };
  const a = await joinProgram({ id: session.user.id, email: session.user.email, name: session.user.name ?? null });
  revalidatePath("/account/affiliate");
  return { ok: true, message: a.status === "APPROVED" ? t("joined") : t("applied") };
}

const payoutSchema = z.object({ details: z.string().trim().max(200) });

export async function saveAffiliatePayoutDetails(input: z.input<typeof payoutSchema>): Promise<Result> {
  const session = await auth();
  const t = await getTranslations("affiliate");
  if (!session?.user) return { ok: false, error: t("signInFirst") };
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("tooLong") };
  const updated = await db.affiliate.updateMany({ where: { userId: session.user.id }, data: { payoutDetails: parsed.data.details || null } });
  if (!updated.count) return { ok: false, error: t("notMember") };
  revalidatePath("/account/affiliate");
  return { ok: true, message: t("saved") };
}
