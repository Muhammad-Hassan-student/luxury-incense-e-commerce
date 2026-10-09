import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "../db";
import { getIntegration } from "../integrations";
import { cancelCod, confirmCod, type CodResult } from "../cod";
import { applyStatus, recordOptIn, recordOptOut, sendWhatsApp } from "./messages";
import { normalizePhone } from "./phone";

/*
 * Webhook side: Meta's GET verification, X-Hub-Signature-256 check and the POST payload — delivery receipts and
 * inbound messages (quick-reply buttons and typed YES / CONFIRM / CANCEL / STOP / START). Inbound messages are
 * stored by their wamid (unique), so Meta's retries are processed once.
 */

/** GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=… → the challenge, or null. */
export async function verifySubscription(params: URLSearchParams) {
  const c = await getIntegration("whatsapp");
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge");
  if (mode !== "subscribe" || !challenge || !c.verifyToken) return null;
  const a = Buffer.from(token);
  const b = Buffer.from(c.verifyToken);
  return a.length === b.length && timingSafeEqual(a, b) ? challenge : null;
}

/** Constant-time check of `sha256=<hex HMAC of the raw body with the app secret>`. No secret saved → reject. */
export async function verifySignature(rawBody: string, header: string | null) {
  const { appSecret } = await getIntegration("whatsapp");
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice(7), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const message = z.object({
  id: z.string(),
  from: z.string(),
  timestamp: z.string().optional(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  button: z.object({ payload: z.string().optional(), text: z.string().optional() }).optional(),
  interactive: z
    .object({ button_reply: z.object({ id: z.string(), title: z.string() }).optional(), list_reply: z.object({ id: z.string(), title: z.string() }).optional() })
    .optional(),
});
const status = z.object({ id: z.string(), status: z.string(), errors: z.array(z.object({ title: z.string().optional(), message: z.string().optional(), code: z.number().optional() })).optional() });
const payloadSchema = z.object({
  object: z.string().optional(),
  entry: z
    .array(
      z.object({
        changes: z.array(z.object({ field: z.string().optional(), value: z.object({ messages: z.array(message).optional(), statuses: z.array(status).optional() }).loose() })).default([]),
      }),
    )
    .default([]),
});

export type Intent = { action: "confirm" | "cancel" | "stop" | "start" | "other"; orderId?: string };

/** Button payloads carry the order (`CONFIRM:<id>`); typed words fall back to the latest awaiting order. */
export function parseIntent(text: string, payload?: string): Intent {
  const p = payload?.match(/^(CONFIRM|CANCEL):([a-z0-9]{10,40})$/i);
  if (p) return { action: p[1].toUpperCase() === "CONFIRM" ? "confirm" : "cancel", orderId: p[2] };
  const t = text.trim().toUpperCase().replace(/[^A-Z ]/g, "").trim();
  if (["STOP", "UNSUBSCRIBE", "STOP ALL", "OPT OUT", "OPTOUT"].includes(t)) return { action: "stop" };
  if (["START", "UNSTOP", "SUBSCRIBE"].includes(t)) return { action: "start" };
  if (["YES", "Y", "CONFIRM", "CONFIRMED", "CONFIRM ORDER", "HAAN", "HAN"].includes(t)) return { action: "confirm" };
  if (["CANCEL", "NO", "CANCEL ORDER", "NAHI"].includes(t)) return { action: "cancel" };
  return { action: "other" };
}

/** The awaiting COD order this phone may act on: one we sent a COD request to. */
async function targetOrder(phone: string, orderId?: string) {
  const sent = await db.whatsAppMessage.findFirst({
    where: { phone, direction: "out", kind: { in: ["cod_confirm", "cod_reminder"] }, ...(orderId ? { orderId } : { order: { codStatus: "AWAITING", status: "PENDING" } }) },
    orderBy: { createdAt: "desc" },
    select: { orderId: true },
  });
  return sent?.orderId ?? null;
}

const REPLY: Record<CodResult, (n: string) => string> = {
  confirmed: (n) => `Thank you — order ${n} is confirmed. We’ll let you know when it ships.`,
  already_confirmed: (n) => `Order ${n} is already confirmed. We’ll let you know when it ships.`,
  cancelled: (n) => `Order ${n} has been cancelled. Nothing is due.`,
  already_cancelled: (n) => `Order ${n} was already cancelled.`,
  closed: (n) => `Order ${n} can’t be changed here any more. Reply to this chat if you need help.`,
};

export type InboundResult = { id: string; duplicate: boolean; intent: Intent["action"]; result?: CodResult | "opted_out" | "opted_in" | "no_order" };

export async function handleInbound(m: z.infer<typeof message>): Promise<InboundResult> {
  const phone = normalizePhone(`+${m.from.replace(/^\+/, "")}`) ?? `+${m.from.replace(/\D/g, "")}`;
  const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "";
  const payload = m.button?.payload ?? m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id;
  const intent = parseIntent(text, payload);

  // Idempotency: the wamid is unique, a replay fails here and is skipped.
  try {
    await db.whatsAppMessage.create({ data: { phone, direction: "in", kind: "inbound", body: (text || `[${m.type}]`).slice(0, 2000), status: "RECEIVED", waMessageId: m.id, vars: payload ? { payload } : undefined } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { id: m.id, duplicate: true, intent: intent.action };
    throw e;
  }
  try {
    return await act(m.id, phone, intent);
  } catch (e) {
    // Let Meta's retry process it again instead of being skipped as a duplicate.
    await db.whatsAppMessage.deleteMany({ where: { waMessageId: m.id } }).catch(() => {});
    throw e;
  }
}

async function act(id: string, phone: string, intent: Intent): Promise<InboundResult> {
  const m = { id };
  const reply = (body: string, consent: "reply" | "stop-ack" = "reply", orderId?: string | null) =>
    sendWhatsApp({ phone, kind: "text", consent, message: { type: "text", body }, orderId: orderId ?? null });

  if (intent.action === "stop") {
    await recordOptOut(phone, "reply");
    await reply("You’re unsubscribed from Maison Oud WhatsApp messages. Reply START to receive order updates again.", "stop-ack");
    return { id: m.id, duplicate: false, intent: "stop", result: "opted_out" };
  }
  if (intent.action === "start") {
    await recordOptIn(phone, { source: "reply" });
    await reply("Welcome back — you’ll receive order updates from Maison Oud here.");
    return { id: m.id, duplicate: false, intent: "start", result: "opted_in" };
  }
  if (intent.action === "confirm" || intent.action === "cancel") {
    const orderId = await targetOrder(phone, intent.orderId);
    if (!orderId) return { id: m.id, duplicate: false, intent: intent.action, result: "no_order" };
    await db.whatsAppMessage.updateMany({ where: { waMessageId: m.id }, data: { orderId } });
    const result = intent.action === "confirm" ? await confirmCod(orderId, "whatsapp") : await cancelCod(orderId, "whatsapp", "Cancelled by the customer on WhatsApp");
    const o = await db.order.findUnique({ where: { id: orderId }, select: { number: true } });
    // The confirmation itself sends the "order confirmed" template; only answer in words when nothing else went out.
    if (result !== "confirmed" && o) await reply(REPLY[result](o.number), "reply", orderId);
    return { id: m.id, duplicate: false, intent: intent.action, result };
  }
  return { id: m.id, duplicate: false, intent: "other" };
}

/** Processes a verified webhook body. Returns counts for the response/logs. */
export async function handleWebhook(rawBody: string) {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    json = null;
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return { statuses: 0, messages: 0, duplicates: 0, results: [] as InboundResult[] };
  let statuses = 0;
  const results: InboundResult[] = [];
  for (const e of parsed.data.entry) {
    for (const ch of e.changes) {
      for (const st of ch.value.statuses ?? []) {
        const err = st.errors?.[0];
        if (await applyStatus(st.id, st.status, err ? `${err.title ?? err.message ?? "Error"}${err.code ? ` (#${err.code})` : ""}` : null)) statuses++;
      }
      for (const m of ch.value.messages ?? []) results.push(await handleInbound(m));
    }
  }
  return { statuses, messages: results.filter((r) => !r.duplicate).length, duplicates: results.filter((r) => r.duplicate).length, results };
}
