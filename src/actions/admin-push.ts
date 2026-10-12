"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { rateLimit } from "@/server/rate-limit";
import { broadcastAudience, sendBroadcast, sendTestPush } from "@/server/push";
import { BROADCAST_SEGMENTS, isBroadcastSegment } from "@/lib/push-shared";
import { done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";

/* Admin → Push: broadcast to a segment, with an audience preview and a test to your own devices first. */

const segment = z.string().refine(isBroadcastSegment, "Choose an audience");
const messageSchema = z.object({
  title: z.string().trim().min(2, "Add a title").max(80),
  body: z.string().trim().min(2, "Add a message").max(200),
  url: z
    .string()
    .trim()
    .max(300)
    .regex(/^\/(?!\/)[^\s]*$/, "Link must be a page on this site, starting with /")
    .or(z.literal(""))
    .default(""),
});

export async function previewAudienceAction(input: { segment: string }): Promise<ActionResult & { subscribers?: number; eligible?: number }> {
  await requirePermission("push.broadcast");
  const s = segment.safeParse(input.segment);
  if (!s.success || !isBroadcastSegment(s.data)) return fail("Choose an audience.");
  const a = await broadcastAudience(s.data);
  return { ok: true, ...a };
}

export async function sendTestBroadcastAction(input: z.input<typeof messageSchema>): Promise<ActionResult> {
  const user = await requirePermission("push.broadcast");
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  if (!(await rateLimit(`push-test-admin:${user.id}`, 10, 600)).ok) return fail("Too many tests — wait a few minutes.");
  const r = await sendTestPush(user.id, { title: parsed.data.title, body: parsed.data.body, url: parsed.data.url || "/", tag: "broadcast-test" });
  await audit(user.id, "push.test", "PushBroadcast", null, { title: parsed.data.title });
  if (r.skipped === "no_devices") return fail("Turn on notifications for your own account first (Account → Notifications).");
  if (r.skipped === "disabled") return fail("Web push is switched off in Integrations.");
  return r.sent ? done(`Test sent to ${r.sent} of your device${r.sent === 1 ? "" : "s"}`) : fail("Your devices didn’t accept the test.");
}

const sendSchema = messageSchema.extend({ segment, confirm: z.literal(true) });

export async function sendBroadcastAction(input: z.input<typeof sendSchema>): Promise<ActionResult> {
  const user = await requirePermission("push.broadcast");
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  if (!isBroadcastSegment(parsed.data.segment)) return fail("Choose an audience.");
  if (!(await rateLimit(`push-broadcast:${user.id}`, 3, 3600)).ok) return fail("Broadcast limit reached for this hour.");
  const r = await sendBroadcast({ title: parsed.data.title, body: parsed.data.body, url: parsed.data.url || null, segment: parsed.data.segment, createdById: user.id });
  await audit(user.id, "push.broadcast", "PushBroadcast", r.id, { segment: parsed.data.segment, label: BROADCAST_SEGMENTS.find((s) => s.value === parsed.data.segment)?.label, recipients: r.recipients, sent: r.sent, failed: r.failed });
  revalidatePath("/admin/push");
  return done(`Sent to ${r.sent} device${r.sent === 1 ? "" : "s"} (${r.recipients} customer${r.recipients === 1 ? "" : "s"} in the audience; preferences, opt-outs and caps applied)`);
}
