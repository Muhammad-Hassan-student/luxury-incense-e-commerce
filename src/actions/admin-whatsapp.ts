"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/roles";
import { staffCodOutcome } from "@/server/cod";
import { PermissionError, riskSettingsSchema, saveRiskSettings } from "@/server/risk";
import { resendOrderNotice } from "@/server/whatsapp/admin";
import { cuid, done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";

const message = (e: unknown) => (e instanceof PermissionError || e instanceof Error ? e.message : "Something went wrong.");

const resendSchema = z.object({ orderId: cuid, notice: z.enum(["confirmed", "cod_reminder", "shipped", "out_for_delivery", "delivered", "cancelled"]) });

export async function resendWhatsAppAction(input: z.input<typeof resendSchema>): Promise<ActionResult> {
  const user = await requirePermission("orders.fulfil");
  const parsed = resendSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const r = await resendOrderNotice(user, parsed.data.orderId, parsed.data.notice);
    revalidatePath(`/admin/orders/${parsed.data.orderId}`);
    return done(r.sent && r.test ? "Recorded (WhatsApp test mode — not sent)" : "WhatsApp message sent");
  } catch (e) {
    revalidatePath(`/admin/orders/${parsed.data.orderId}`);
    return fail(message(e));
  }
}

const outcomeSchema = z.object({ orderId: cuid, outcome: z.enum(["confirmed", "cancelled", "no_answer"]), note: z.string().trim().max(300).optional() });

export async function codOutcomeAction(input: z.input<typeof outcomeSchema>): Promise<ActionResult> {
  const parsed = outcomeSchema.safeParse(input);
  const user = await requirePermission(...(parsed.success && parsed.data.outcome === "cancelled" ? (["orders.fulfil", "orders.cancel"] as const) : (["orders.fulfil"] as const)));
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const r = await staffCodOutcome(user, parsed.data.orderId, parsed.data.outcome, parsed.data.note);
    revalidatePath(`/admin/orders/${parsed.data.orderId}`);
    revalidatePath("/admin/orders");
    revalidatePath("/admin/risk");
    const text: Record<string, string> = {
      confirmed: "COD confirmed — ready to pack",
      cancelled: "Order cancelled and stock released",
      noted: "Call logged",
      already_confirmed: "Already confirmed",
      already_cancelled: "Already cancelled",
      closed: "This order is no longer awaiting confirmation",
    };
    return r === "closed" ? fail(text.closed) : done(text[r]);
  } catch (e) {
    return fail(message(e));
  }
}

export async function saveRiskSettingsAction(input: z.input<typeof riskSettingsSchema>): Promise<ActionResult> {
  const user = await requirePermission("settings.manage");
  const parsed = riskSettingsSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    await saveRiskSettings(user, parsed.data);
  } catch (e) {
    return fail(message(e));
  }
  revalidatePath("/admin/risk");
  return done("COD & risk settings saved");
}
