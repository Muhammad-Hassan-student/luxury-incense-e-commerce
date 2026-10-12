"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/roles";
import { rateLimit } from "@/server/rate-limit";
import { createTicket, customerReply, SupportError } from "@/server/support";
import { SUPPORT_TOPICS } from "@/lib/support-shared";

/* Customer side of the support desk (signed in). Staff actions live in admin-support.ts. */

type Result = { ok: true; number: number; reference: string } | { ok: false; error: string };

const attachments = z.array(z.string().max(500)).max(4).default([]);

const newSchema = z.object({
  // Messages are `support` keys, translated when returned.
  subject: z.string().trim().min(3, "errSubject").max(160),
  body: z.string().trim().min(2, "errBody").max(5000),
  topic: z.enum(SUPPORT_TOPICS).default("other"),
  orderNumber: z.string().trim().max(40).regex(/^[A-Z0-9-]*$/i).nullish(),
  attachments,
});

export async function openSupportTicket(input: z.input<typeof newSchema>): Promise<Result> {
  const user = await requireUser("/account/support/new");
  const tr = await getTranslations("support");
  const parsed = newSchema.safeParse(input);
  if (!parsed.success) {
    const key = parsed.error.issues[0]?.message;
    return { ok: false, error: tr(key === "errSubject" || key === "errBody" ? key : "errForm") };
  }
  if (!(await rateLimit(`support-new:${user.id}`, 5, 3600)).ok) return { ok: false, error: tr("errTooManyRequests") };
  try {
    const t = await createTicket({
      source: "web",
      subject: parsed.data.subject,
      body: parsed.data.body,
      userId: user.id,
      orderNumber: parsed.data.orderNumber || null,
      tags: [parsed.data.topic],
      priority: parsed.data.topic === "payment" ? "HIGH" : "NORMAL",
      attachments: parsed.data.attachments,
    });
    revalidatePath("/account/support");
    return { ok: true, number: t.number, reference: t.reference };
  } catch (e) {
    if (e instanceof SupportError) return { ok: false, error: e.message };
    console.error("[support] create failed", e);
    return { ok: false, error: tr("errGeneric") };
  }
}

const replySchema = z.object({ number: z.number().int().positive(), body: z.string().trim().min(1).max(5000), attachments });

export async function replyToSupportTicket(input: z.input<typeof replySchema>): Promise<Result> {
  const user = await requireUser("/account/support");
  const tr = await getTranslations("support");
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: tr("errEmptyReply") };
  if (!(await rateLimit(`support-reply:${user.id}`, 30, 3600)).ok) return { ok: false, error: tr("errTooManyMessages") };
  try {
    const t = await customerReply(user.id, parsed.data.number, { body: parsed.data.body, attachments: parsed.data.attachments });
    revalidatePath(`/account/support/${t.number}`);
    revalidatePath("/account/support");
    return { ok: true, number: t.number, reference: `#${t.number}` };
  } catch (e) {
    if (e instanceof SupportError) return { ok: false, error: e.message };
    console.error("[support] reply failed", e);
    return { ok: false, error: tr("errGeneric") };
  }
}
