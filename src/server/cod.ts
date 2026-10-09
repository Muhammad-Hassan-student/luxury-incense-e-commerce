import "server-only";
import type { CodStatus, OrderStatus } from "@/generated/prisma/client";
import { canDo } from "@/lib/permissions";
import { db } from "./db";
import { audit } from "./audit";
import { cancelOrder } from "./orders";
import { notifyOrderStatus } from "./notify";
import { codTokenHash, verifyCodToken } from "./cod-token";
import { getRiskSettings, PermissionError, type Actor } from "./risk";

/*
 * Cash-on-delivery verification.
 *
 *   placed (COD, storefront) → codStatus AWAITING, codConfirmBy = now + N h
 *     ├─ customer taps Confirm on WhatsApp / opens the email or web link / staff logs a call → CONFIRMED
 *     ├─ customer taps Cancel (WhatsApp or link) / staff logs a refusal              → CANCELLED (order cancelled, stock back)
 *     └─ cron: reminder `reminderBeforeHours` before the deadline; at the deadline   → CANCELLED (auto)
 *
 * FULFILMENT CONTRACT: an order with `codStatus === "AWAITING"` must not be packed or handed to a courier.
 * Use `codHold(order)` / `COD_READY_WHERE` to filter. `advanceOrder` refuses PACKED for such orders.
 */

export type CodVia = "whatsapp" | "link" | "email" | "staff" | "auto";

/** True when the order is waiting for the customer to confirm cash on delivery — do not pack or ship. */
export const codHold = (o: { codStatus: CodStatus | null; status?: OrderStatus }) => o.codStatus === "AWAITING" && (o.status === undefined || o.status === "PENDING");

/** Prisma filter for orders that are ready to fulfil as far as COD verification is concerned. */
export const COD_READY_WHERE = { OR: [{ codStatus: null }, { codStatus: { not: "AWAITING" as const } }] };

const VIA_LABEL: Record<CodVia, string> = { whatsapp: "on WhatsApp", link: "via the confirmation link", email: "via email", staff: "by phone with staff", auto: "automatically" };

export type CodResult = "confirmed" | "cancelled" | "already_confirmed" | "already_cancelled" | "closed";

async function currentState(orderId: string): Promise<CodResult> {
  const o = await db.order.findUnique({ where: { id: orderId }, select: { codStatus: true, status: true } });
  if (o?.codStatus === "CONFIRMED") return "already_confirmed";
  if (o?.codStatus === "CANCELLED" || o?.status === "CANCELLED") return "already_cancelled";
  return "closed";
}

/** Idempotent: only the first confirmation counts; repeats (webhook replays, double taps) report `already_confirmed`. */
export async function confirmCod(orderId: string, via: CodVia, meta: { actorId?: string; note?: string } = {}): Promise<CodResult> {
  const now = new Date();
  const claimed = await db.order.updateMany({
    where: { id: orderId, codStatus: "AWAITING", status: "PENDING" },
    data: { codStatus: "CONFIRMED", codConfirmedAt: now, codConfirmedVia: via, codTokenHash: null },
  });
  if (!claimed.count) return currentState(orderId);
  await db.orderEvent.create({ data: { orderId, status: "PENDING", message: `Cash on delivery confirmed ${VIA_LABEL[via]}${meta.note ? ` — ${meta.note}` : ""}` } });
  await notifyOrderStatus(orderId, "cod_confirmed");
  return "confirmed";
}

/** Customer (or staff/auto) declines: the order is cancelled through the normal path, so stock is released. */
export async function cancelCod(orderId: string, via: CodVia, reason: string): Promise<CodResult> {
  const claimed = await db.order.updateMany({
    where: { id: orderId, codStatus: "AWAITING", status: "PENDING" },
    data: { codStatus: "CANCELLED", codTokenHash: null },
  });
  if (!claimed.count) return currentState(orderId);
  const cancelled = await cancelOrder(orderId, reason, ["PENDING"]);
  if (!cancelled) {
    // Lost a race with fulfilment: put the hold back unless the order is gone anyway.
    await db.order.updateMany({ where: { id: orderId, codStatus: "CANCELLED", status: { not: "CANCELLED" } }, data: { codStatus: "AWAITING" } });
    return currentState(orderId);
  }
  await notifyOrderStatus(orderId, "cancelled", { reason: via === "auto" ? "it wasn’t confirmed in time" : "cancelled at your request" });
  return "cancelled";
}

// ─────────────────────────────── Web link ───────────────────────────────

export type CodLinkState =
  | { state: "invalid" }
  | { state: "expired"; number: string }
  | { state: "confirmed" | "cancelled"; number: string }
  | {
      state: "awaiting";
      orderId: string;
      number: string;
      total: number;
      payable: number;
      confirmBy: Date | null;
      city: string | null;
      name: string | null;
      items: { name: string; label: string; quantity: number }[];
    };

/** What the confirmation page shows. Reading never consumes the link (link previews must not confirm orders). */
export async function peekCodLink(token: string, now = new Date()): Promise<CodLinkState> {
  const orderId = verifyCodToken(token);
  if (!orderId) return { state: "invalid" };
  const o = await db.order.findUnique({ where: { id: orderId }, include: { items: { select: { name: true, label: true, quantity: true } } } });
  if (!o || !o.codStatus) return { state: "invalid" };
  if (o.codStatus === "CONFIRMED") return { state: "confirmed", number: o.number };
  if (o.codStatus === "CANCELLED" || o.status === "CANCELLED") return { state: "cancelled", number: o.number };
  if (o.codTokenHash !== codTokenHash(token)) return { state: "invalid" };
  if ((o.codConfirmBy && o.codConfirmBy <= now) || o.status !== "PENDING") return { state: "expired", number: o.number };
  const a = (o.shippingAddress ?? {}) as { city?: string; fullName?: string };
  return {
    state: "awaiting",
    orderId: o.id,
    number: o.number,
    total: o.total,
    payable: o.total - o.giftCardAmount,
    confirmBy: o.codConfirmBy,
    city: a.city ?? null,
    name: a.fullName?.split(" ")[0] ?? null,
    items: o.items,
  };
}

/** Customer answers on the web page. Single use: the stored hash is cleared by the first answer. */
export async function answerCodLink(token: string, decision: "confirm" | "cancel", now = new Date()): Promise<CodResult | "invalid" | "expired"> {
  const orderId = verifyCodToken(token);
  if (!orderId) return "invalid";
  const o = await db.order.findUnique({ where: { id: orderId }, select: { codTokenHash: true, codConfirmBy: true, codStatus: true } });
  if (!o) return "invalid";
  if (o.codTokenHash !== codTokenHash(token)) return o.codStatus === "CONFIRMED" ? "already_confirmed" : o.codStatus === "CANCELLED" ? "already_cancelled" : "invalid";
  if (o.codConfirmBy && o.codConfirmBy <= now) return "expired";
  return decision === "confirm" ? confirmCod(orderId, "link") : cancelCod(orderId, "link", "Cancelled by the customer (confirmation link)");
}

// ─────────────────────────────── Staff ───────────────────────────────

export type CallOutcome = "confirmed" | "cancelled" | "no_answer";

/** Staff record a call: confirm, cancel (needs orders.cancel), or note an unanswered call. Audited. */
export async function staffCodOutcome(actor: Actor, orderId: string, outcome: CallOutcome, note?: string) {
  if (!canDo(actor.permissions, "orders.fulfil")) throw new PermissionError();
  if (outcome === "cancelled" && !canDo(actor.permissions, "orders.cancel")) throw new PermissionError("You need cancel permission to cancel an order.");
  const o = await db.order.findUnique({ where: { id: orderId }, select: { number: true, codStatus: true } });
  if (!o) throw new Error("Order not found.");
  const clean = note?.trim().slice(0, 300) || undefined;
  let result: CodResult | "noted";
  if (outcome === "confirmed") result = await confirmCod(orderId, "staff", { actorId: actor.id, note: clean });
  else if (outcome === "cancelled") result = await cancelCod(orderId, "staff", `Cancelled after a confirmation call${clean ? ` — ${clean}` : ""}`);
  else {
    if (o.codStatus !== "AWAITING") throw new Error("This order isn’t awaiting confirmation.");
    await db.orderEvent.create({ data: { orderId, status: "PENDING", message: `COD confirmation call — no answer${clean ? ` (${clean})` : ""}` } });
    result = "noted";
  }
  await audit(actor.id, `order.cod_${outcome}`, "Order", orderId, { number: o.number, result, note: clean ?? null });
  return result;
}

// ─────────────────────────────── Cron ───────────────────────────────

/** Reminders, then auto-cancel of expired confirmations. Idempotent; run hourly. */
export async function runCodSweep(now = new Date(), only?: { orderIds: string[] }) {
  const s = await getRiskSettings();
  const scope = only ? { id: { in: only.orderIds } } : {};
  let reminded = 0;
  let cancelled = 0;
  const due = await db.order.findMany({
    where: { ...scope, codStatus: "AWAITING", status: "PENDING", codReminderSentAt: null, codConfirmBy: { gt: now, lte: new Date(now.getTime() + s.reminderBeforeHours * 3600_000) } },
    select: { id: true },
    take: 200,
  });
  if (s.reminderBeforeHours > 0) {
    for (const o of due) {
      // Claim first so overlapping runs send one reminder.
      const claim = await db.order.updateMany({ where: { id: o.id, codReminderSentAt: null }, data: { codReminderSentAt: now } });
      if (!claim.count) continue;
      await notifyOrderStatus(o.id, "cod_reminder");
      reminded++;
    }
  }
  const expired = await db.order.findMany({ where: { ...scope, codStatus: "AWAITING", status: "PENDING", codConfirmBy: { lte: now } }, select: { id: true }, take: 200 });
  for (const o of expired) {
    if ((await cancelCod(o.id, "auto", "Cash on delivery not confirmed in time — order released")) === "cancelled") cancelled++;
  }
  return { reminded, cancelled };
}
