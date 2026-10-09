"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { isProvider, PROVIDERS, saveIntegration } from "@/server/integrations";
import { sendEmail } from "@/server/email";
import { SimpleEmail } from "@/emails/simple";
import { rateLimit } from "@/server/rate-limit";
import { done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";

const saveSchema = z.object({
  provider: z.string(),
  values: z.record(z.string(), z.union([z.string().max(4000), z.number(), z.boolean()])),
  clear: z.array(z.string().max(64)).max(20).default([]),
});

export async function saveIntegrationAction(input: z.input<typeof saveSchema>): Promise<ActionResult> {
  const user = await requirePermission("settings.manage");
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { provider, values, clear } = parsed.data;
  if (!isProvider(provider)) return fail("Unknown integration.");
  try {
    await saveIntegration(provider, values, clear);
  } catch (e) {
    if (e instanceof z.ZodError) return fail(zodMessage(e));
    throw e;
  }
  // Never log secret values: only which fields were touched.
  const secrets = new Set(PROVIDERS[provider].fields.filter((f) => f.secret).map((f) => f.key));
  const changed = Object.entries(values)
    .filter(([k, v]) => !(secrets.has(k) && v === ""))
    .map(([k]) => k);
  await audit(user.id, "integration.update", "Setting", `integration:${provider}`, { changed, cleared: clear });
  revalidatePath("/admin/integrations");
  return done(`${PROVIDERS[provider].title} saved`);
}

/** Sends a real email through the current settings and reports the provider's own error if it fails. */
export async function sendTestEmailAction(input: { to: string }): Promise<ActionResult> {
  const user = await requirePermission("settings.manage");
  const to = z.string().trim().email().safeParse(input.to);
  if (!to.success) return fail("Enter a valid email address.");
  if (!(await rateLimit(`test-email:${user.id}`, 5, 300)).ok) return fail("Too many test emails. Try again in a few minutes.");
  const r = await sendEmail({
    to: to.data,
    subject: "Maison Oud — test email",
    react: SimpleEmail({ preview: "Email is working", title: "Email is working", body: "If you can read this, sign-in links and order emails will reach your customers too." }),
  });
  await audit(user.id, "integration.test_email", "Setting", "integration:email", { to: to.data, ok: r.ok, via: r.ok ? r.via : undefined });
  if (!r.ok) return fail(`Not sent: ${r.error}`);
  if (r.via === "dev") return fail("No email provider is set up yet — the message was only printed to the server log.");
  return done(`Sent to ${to.data} via ${r.via === "smtp" ? "SMTP" : "Resend"}`);
}
