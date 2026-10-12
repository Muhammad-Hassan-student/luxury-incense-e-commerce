"use server";

import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { answerCodLink } from "@/server/cod";
import { rateLimit } from "@/server/rate-limit";

const schema = z.object({ token: z.string().min(10).max(200), decision: z.enum(["confirm", "cancel"]) });

// Result code → message key in `codConfirm`.
const MESSAGES = {
  confirmed: { ok: true, key: "msgConfirmed" },
  already_confirmed: { ok: true, key: "msgAlreadyConfirmed" },
  cancelled: { ok: true, key: "msgCancelled" },
  already_cancelled: { ok: true, key: "msgAlreadyCancelled" },
  closed: { ok: false, key: "msgClosed" },
  expired: { ok: false, key: "msgExpired" },
  invalid: { ok: false, key: "msgInvalid" },
} as const;

/** Customer answers the COD confirmation from the web link (no sign-in; the signed single-use token is the proof). */
export async function answerCodLinkAction(input: z.input<typeof schema>) {
  const t = await getTranslations("codConfirm");
  if (!(await rateLimit("cod-link", 20, 600)).ok) return { ok: false, text: t("msgTooMany") };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: MESSAGES.invalid.ok, text: t(MESSAGES.invalid.key) };
  const r = await answerCodLink(parsed.data.token, parsed.data.decision);
  const m = MESSAGES[r as keyof typeof MESSAGES] ?? MESSAGES.invalid;
  return { ok: m.ok, text: t(m.key), result: r };
}
