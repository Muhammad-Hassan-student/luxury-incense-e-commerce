import "server-only";
import type { Prisma, WhatsAppStatus } from "@/generated/prisma/client";
import { db } from "../db";
import { sendRaw, type Outgoing } from "./client";
import { maskPhone, normalizePhone } from "./phone";

/*
 * Consent + message log. Every send is recorded in WhatsAppMessage (test-mode sends too, flagged `test`).
 *  - transactional (order updates, COD confirmation): needs a checkout opt-in and no STOP since.
 *  - marketing (abandoned bag): same, plus the caller checks the email marketing opt-out and frequency caps.
 *  - reply: answering a message the customer just sent (inside WhatsApp's 24h service window) — no opt-in needed,
 *    but STOP is still honoured except for the one STOP acknowledgement.
 */

export type Consent = "transactional" | "marketing" | "reply" | "stop-ack";

export async function contactFor(phone: string) {
  return db.whatsAppContact.findUnique({ where: { phone } });
}

/** Checkout tick-box: records consent with a timestamp (an explicit new tick also undoes an old STOP). */
export async function recordOptIn(phone: string, who: { email?: string | null; userId?: string | null; source?: string } = {}) {
  const now = new Date();
  return db.whatsAppContact.upsert({
    where: { phone },
    create: { phone, optedIn: true, consentAt: now, source: who.source ?? "checkout", email: who.email?.toLowerCase() ?? null, userId: who.userId ?? null },
    update: { optedIn: true, consentAt: now, optedOutAt: null, source: who.source ?? "checkout", ...(who.email ? { email: who.email.toLowerCase() } : {}), ...(who.userId ? { userId: who.userId } : {}) },
  });
}

/** Customer replied STOP (or staff opted them out). */
export async function recordOptOut(phone: string, source = "reply") {
  const now = new Date();
  return db.whatsAppContact.upsert({
    where: { phone },
    create: { phone, optedIn: false, optedOutAt: now, source },
    update: { optedIn: false, optedOutAt: now, source },
  });
}

export async function canMessage(phone: string, consent: Consent) {
  if (consent === "stop-ack") return true;
  const c = await contactFor(phone);
  if (c?.optedOutAt && !c.optedIn) return false;
  if (consent === "reply") return true;
  return Boolean(c?.optedIn && c.consentAt);
}

export type SendInput = {
  phone: string;
  kind: string;
  consent: Consent;
  message: Outgoing;
  orderId?: string | null;
  userId?: string | null;
  cartId?: string | null;
};

export type SendOutcome = { sent: true; id: string; test: boolean } | { sent: false; reason: string; id?: string };

/** Records and sends one message. Never throws for delivery problems: they're logged on the row as FAILED. */
export async function sendWhatsApp(input: SendInput): Promise<SendOutcome> {
  const phone = normalizePhone(input.phone);
  if (!phone) return { sent: false, reason: "invalid phone" };
  if (!(await canMessage(phone, input.consent))) return { sent: false, reason: "no consent" };

  const m = input.message;
  const row = await db.whatsAppMessage.create({
    data: {
      phone,
      direction: "out",
      kind: input.kind,
      template: m.type === "template" ? m.name : null,
      vars: m.type === "template" ? ({ body: m.bodyVars, buttons: m.buttonPayloads ?? [] } as Prisma.InputJsonObject) : undefined,
      body: m.type === "text" ? m.body : null,
      orderId: input.orderId ?? null,
      userId: input.userId ?? null,
      cartId: input.cartId ?? null,
    },
  });
  const r = await sendRaw(phone, m).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e), mock: false }));
  if (r.ok) {
    await db.whatsAppMessage.update({ where: { id: row.id }, data: { status: "SENT", waMessageId: r.id, test: r.mock } });
    if (r.mock) console.info(`[whatsapp:test-mode] ${input.kind} → ${maskPhone(phone)}${m.type === "template" ? ` template=${m.name}` : ""} (recorded, not sent)`);
    return { sent: true, id: row.id, test: r.mock };
  }
  await db.whatsAppMessage.update({ where: { id: row.id }, data: { status: "FAILED", error: r.error } });
  console.error(`[whatsapp] ${input.kind} → ${maskPhone(phone)} failed: ${r.error}`);
  return { sent: false, reason: r.error, id: row.id };
}

const RANK: Record<WhatsAppStatus, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4, RECEIVED: 0 };

/** Delivery receipt from the webhook. Statuses only move forward (a late "delivered" never undoes "read"). */
export async function applyStatus(waMessageId: string, status: string, error?: string | null) {
  const next = ({ sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" } as Record<string, WhatsAppStatus>)[status];
  if (!next) return false;
  const row = await db.whatsAppMessage.findUnique({ where: { waMessageId }, select: { id: true, status: true } });
  if (!row || RANK[next] <= RANK[row.status]) return false;
  await db.whatsAppMessage.update({ where: { id: row.id }, data: { status: next, ...(error ? { error: error.slice(0, 500) } : {}) } });
  return true;
}
