import "server-only";
import { randomInt } from "node:crypto";
import type { Prisma, ReturnCondition, ReturnResolution, ReturnStatus } from "@/generated/prisma/client";
import { brand } from "@/config/brand";
import { formatMoney } from "@/lib/money";
import { canDo } from "@/lib/permissions";
import {
  COUNTING_STATUSES,
  RESOLUTION_LABEL,
  RETURN_STATUS_LABEL,
  loyaltyClawback,
  parseReturnSettings,
  refundMethodText,
  refundQuote,
  returnDeadline,
  returnSettingsSchema,
  type RefundQuote,
  type ReturnSettings,
  type ReturnSettingsInput,
} from "@/lib/returns";
import { ReturnEmail, ReturnStaffEmail, type ReturnEmailKind } from "@/emails/return-update";
import { db } from "./db";
import { audit } from "./audit";
import { sendEmail } from "./email";
import { adjustStock, commitSale, OutOfStockError, reserve, stockMoves } from "./inventory";
import { refundAtProvider } from "./payments";
import { generateCode, restoreGiftCard, sendGiftCardEmails, VALIDITY_DAYS } from "./gift-cards";
import { staffWithPermission } from "./stock-report";

/*
 * Returns & exchanges (RMA):
 *   REQUESTED → APPROVED → RECEIVED → REFUNDED (refund or store credit) | EXCHANGED
 *   REQUESTED → CANCELLED (customer) · REQUESTED/APPROVED → REJECTED (staff)
 * Every step re-checks the status under a row lock, writes an OrderEvent on the order and (staff) an audit entry.
 */

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof db;
/** The signed-in staff member (see getAccess / requirePermission). */
export type ReturnActor = { id: string; permissions: readonly string[] };

/** Business-rule failure with a message safe to show to the customer or staff. */
export class ReturnError extends Error {}

export const RETURN_SETTINGS_KEY = "returns";
const TX = { maxWait: 15_000, timeout: 30_000 } as const;
/** Resolving may call the payment provider inside the transaction (so a failed refund changes nothing). */
const TX_REFUND = { maxWait: 15_000, timeout: 60_000 } as const;

const isUnique = (e: unknown) => typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === "P2002";

// ─────────────────────────────── Settings ───────────────────────────────

export async function getReturnSettings(client: Client = db): Promise<ReturnSettings> {
  const row = await client.setting.findUnique({ where: { key: RETURN_SETTINGS_KEY } });
  return parseReturnSettings(row?.value);
}

export async function saveReturnSettings(input: ReturnSettingsInput) {
  const parsed = returnSettingsSchema.parse(input);
  const value = { ...parsed, nonReturnableCategories: [...new Set(parsed.nonReturnableCategories.map((s) => s.toLowerCase()))] };
  await db.setting.upsert({ where: { key: RETURN_SETTINGS_KEY }, update: { value }, create: { key: RETURN_SETTINGS_KEY, value } });
  return value;
}

// ─────────────────────────────── Eligibility ───────────────────────────────

const eligibilityInclude = {
  items: {
    orderBy: { id: "asc" },
    include: { variant: { select: { product: { select: { category: { select: { slug: true, name: true } } } } } } },
  },
  // The first DELIVERED event: later notes (e.g. "Return … requested") are logged with the order's current status and must not extend the window.
  events: { where: { status: "DELIVERED" }, orderBy: { createdAt: "asc" }, take: 1 },
} satisfies Prisma.OrderInclude;

type OrderForEligibility = Prisma.OrderGetPayload<{ include: typeof eligibilityInclude }>;

export type ReturnableLine = {
  orderItemId: string;
  name: string;
  label: string;
  image: string | null;
  unitPrice: number;
  purchased: number;
  /** Units already in a live (not rejected / cancelled) return */
  returned: number;
  returnable: number;
  blocked: string | null;
};

export type ReturnEligibility = {
  /** Why nothing can be returned right now; null when a return can be requested. */
  problem: string | null;
  deliveredAt: Date | null;
  deadline: Date | null;
  lines: ReturnableLine[];
};

const isDigital = (meta: Prisma.JsonValue | null) => Boolean(meta && typeof meta === "object" && !Array.isArray(meta) && "giftCard" in meta && meta.giftCard);

/** Units per order line already claimed by live returns. */
async function returnedQuantities(client: Client, orderId: string) {
  const rows = await client.returnItem.groupBy({
    by: ["orderItemId"],
    where: { orderItem: { orderId }, returnReq: { status: { in: COUNTING_STATUSES } } },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.orderItemId, r._sum.quantity ?? 0]));
}

/** Pure: what may be returned from this order now, and why not. */
export function assessReturn(order: OrderForEligibility, returned: Map<string, number>, settings: ReturnSettings, now = new Date()): ReturnEligibility {
  const deliveredAt = order.status === "DELIVERED" ? (order.events[0]?.createdAt ?? order.updatedAt) : null;
  const deadline = returnDeadline(deliveredAt, settings.windowDays);
  const blockedCats = new Set(settings.nonReturnableCategories.map((s) => s.toLowerCase()));
  const lines: ReturnableLine[] = order.items.map((i) => {
    const category = i.variant?.product.category;
    const blocked = isDigital(i.meta) ? "Gift cards can’t be returned." : category && blockedCats.has(category.slug.toLowerCase()) ? `${category.name} can’t be returned.` : null;
    const done = returned.get(i.id) ?? 0;
    return {
      orderItemId: i.id,
      name: i.name,
      label: i.label,
      image: i.image,
      unitPrice: i.unitPrice,
      purchased: i.quantity,
      returned: done,
      returnable: blocked ? 0 : Math.max(0, i.quantity - done),
      blocked,
    };
  });

  let problem: string | null = null;
  if (!settings.enabled) problem = `Online returns are paused at the moment. Write to ${brand.email} and we’ll help.`;
  else if (order.reservedUntil || order.status !== "DELIVERED") problem = "Returns open once your order has been delivered.";
  else if (deadline && deadline < now)
    problem = `The ${settings.windowDays}-day return window closed on ${deadline.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.`;
  else if (!lines.some((l) => l.returnable > 0))
    problem = lines.every((l) => l.blocked) ? "The pieces on this order can’t be returned." : "Everything returnable on this order is already in a return.";
  return { problem, deliveredAt, deadline, lines };
}

export async function getReturnEligibility(orderId: string, now = new Date()) {
  const [order, settings] = await Promise.all([db.order.findUnique({ where: { id: orderId }, include: eligibilityInclude }), getReturnSettings()]);
  if (!order) return null;
  return { ...assessReturn(order, await returnedQuantities(db, orderId), settings, now), settings };
}

// ─────────────────────────────── Numbering ───────────────────────────────

/** Next "RMA-" + 2-digit year + sequence (3+ digits), e.g. RMA-26001. Call only while holding the number lock. */
export async function nextReturnNumber(client: Client = db, now = new Date()) {
  const prefix = `RMA-${String(now.getFullYear() % 100).padStart(2, "0")}`;
  const start = prefix.length + 1;
  // Cast the bound offset: an untyped text parameter would select the regex form of SUBSTRING.
  const rows = await client.$queryRaw<{ seq: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING(number FROM ${start}::int) AS INTEGER))::int AS seq
    FROM "ReturnRequest" WHERE number LIKE ${prefix + "%"} AND SUBSTRING(number FROM ${start}::int) ~ '^[0-9]+$'`;
  return `${prefix}${String((rows[0]?.seq ?? 0) + 1).padStart(3, "0")}`;
}

// ─────────────────────────────── Customer: request & cancel ───────────────────────────────

export type ReturnRequestInput = {
  userId: string;
  orderNumber: string;
  items: { orderItemId: string; quantity: number }[];
  reason: string;
  note?: string | null;
  preferred: ReturnResolution;
  now?: Date;
};

const units = (items: { quantity: number }[]) => {
  const n = items.reduce((s, i) => s + i.quantity, 0);
  return `${n} piece${n === 1 ? "" : "s"}`;
};

/**
 * Opens a return on the customer's own delivered order. The order row is locked while quantities are
 * checked, so two requests racing for the same pieces can never exceed what was bought.
 */
export async function createReturnRequest(input: ReturnRequestInput) {
  const now = input.now ?? new Date();
  const merged = new Map<string, number>();
  for (const i of input.items) if (i.quantity > 0) merged.set(i.orderItemId, (merged.get(i.orderItemId) ?? 0) + i.quantity);
  const lines = [...merged.entries()].map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
  if (!lines.length) throw new ReturnError("Choose at least one piece to return.");
  if (lines.some((l) => !Number.isInteger(l.quantity))) throw new ReturnError("Quantities must be whole numbers.");

  const found = await db.order.findFirst({ where: { number: input.orderNumber, userId: input.userId }, select: { id: true } });
  if (!found) throw new ReturnError("We couldn’t find that order.");
  const settings = await getReturnSettings();

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const ret = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${found.id} FOR UPDATE`;
        const order = await tx.order.findUniqueOrThrow({ where: { id: found.id }, include: eligibilityInclude });
        const elig = assessReturn(order, await returnedQuantities(tx, order.id), settings, now);
        if (elig.problem) throw new ReturnError(elig.problem);
        for (const l of lines) {
          const line = elig.lines.find((x) => x.orderItemId === l.orderItemId);
          if (!line) throw new ReturnError("That piece isn’t on this order.");
          if (line.blocked) throw new ReturnError(line.blocked);
          if (l.quantity > line.returnable) {
            throw new ReturnError(line.returnable > 0 ? `You can return up to ${line.returnable} × ${line.name}.` : `${line.name} is already in a return.`);
          }
        }
        // Always taken after the order lock, never before, so the two can't deadlock.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ReturnRequest.number'))`;
        const number = await nextReturnNumber(tx, now);
        const created = await tx.returnRequest.create({
          data: {
            number,
            orderId: order.id,
            userId: input.userId,
            reason: input.reason.trim(),
            customerNote: input.note?.trim() || null,
            preferred: input.preferred,
            requestedAt: now,
            items: { create: lines },
          },
          include: { items: { include: { orderItem: true } }, order: { select: { number: true, email: true } } },
        });
        await tx.orderEvent.create({ data: { orderId: order.id, status: order.status, message: `Return ${number} requested — ${units(lines)} (${input.reason.trim()})` } });
        return created;
      }, TX);

      await emailCustomer(ret.id, "requested");
      await notifyStaffOfReturn(ret.id);
      return ret;
    } catch (e) {
      if (isUnique(e) && attempt < 5) {
        await new Promise((r) => setTimeout(r, 20 + Math.random() * 80));
        continue;
      }
      throw e;
    }
  }
  throw new ReturnError("We couldn’t save your return. Please try again.");
}

/** Customer withdraws their own request while it is still awaiting review. */
export async function cancelReturnRequest(input: { userId: string; returnId: string }) {
  return db.$transaction(async (tx) => {
    const ret = await tx.returnRequest.findFirst({ where: { id: input.returnId, userId: input.userId }, include: { order: { select: { id: true, status: true } } } });
    if (!ret) throw new ReturnError("We couldn’t find that return.");
    const n = await tx.returnRequest.updateMany({ where: { id: ret.id, status: "REQUESTED" }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    if (!n.count) throw new ReturnError("This return is already being processed and can’t be cancelled here. Write to us and we’ll help.");
    await tx.orderEvent.create({ data: { orderId: ret.order.id, status: ret.order.status, message: `Return ${ret.number} cancelled by customer` } });
    return { number: ret.number };
  }, TX);
}

// ─────────────────────────────── Staff ───────────────────────────────

export function assertCanManageReturns(actor: ReturnActor | null | undefined): asserts actor is ReturnActor {
  if (!actor || !canDo(actor.permissions, "returns.manage")) throw new ReturnError("You don’t have permission to handle returns.");
}

const staffInclude = {
  items: { orderBy: { id: "asc" }, include: { orderItem: true } },
  order: { include: { payments: { orderBy: { createdAt: "asc" } } } },
} satisfies Prisma.ReturnRequestInclude;
type ReturnForStaff = Prisma.ReturnRequestGetPayload<{ include: typeof staffInclude }>;

/** Locks the return row and loads it, checking its status is one of `from`. */
async function lockReturn(tx: Tx, id: string, from: ReturnStatus[], verb: string): Promise<ReturnForStaff> {
  await tx.$queryRaw`SELECT id FROM "ReturnRequest" WHERE id = ${id} FOR UPDATE`;
  const ret = await tx.returnRequest.findUnique({ where: { id }, include: staffInclude });
  if (!ret) throw new ReturnError("Return not found.");
  if (!from.includes(ret.status)) throw new ReturnError(`${ret.number} is ${RETURN_STATUS_LABEL[ret.status].toLowerCase()} — it can’t be ${verb} now.`);
  return ret;
}

const event = (tx: Tx, ret: ReturnForStaff, message: string) => tx.orderEvent.create({ data: { orderId: ret.orderId, status: ret.order.status, message } });

export async function approveReturn(actor: ReturnActor, id: string, opts: { note?: string | null } = {}) {
  assertCanManageReturns(actor);
  const ret = await db.$transaction(async (tx) => {
    const r = await lockReturn(tx, id, ["REQUESTED"], "approved");
    await tx.returnRequest.update({ where: { id }, data: { status: "APPROVED", approvedAt: new Date(), ...(opts.note?.trim() ? { staffNote: opts.note.trim() } : {}) } });
    await event(tx, r, `Return ${r.number} approved`);
    return r;
  }, TX);
  await audit(actor.id, "return.approve", "ReturnRequest", id, { number: ret.number, order: ret.order.number });
  await emailCustomer(id, "approved");
  return ret;
}

export async function rejectReturn(actor: ReturnActor, id: string, reason: string) {
  assertCanManageReturns(actor);
  const why = reason.trim();
  if (why.length < 3) throw new ReturnError("Give the customer a reason.");
  const ret = await db.$transaction(async (tx) => {
    const r = await lockReturn(tx, id, ["REQUESTED", "APPROVED"], "declined");
    await tx.returnRequest.update({ where: { id }, data: { status: "REJECTED", rejectedAt: new Date(), rejectionReason: why } });
    await event(tx, r, `Return ${r.number} declined: ${why}`);
    return r;
  }, TX);
  await audit(actor.id, "return.reject", "ReturnRequest", id, { number: ret.number, order: ret.order.number, reason: why });
  await emailCustomer(id, "rejected");
  return ret;
}

export type Inspection = { itemId: string; condition: ReturnCondition; restock: boolean };

/** Parcel arrived: record each line's condition and put resellable units back into stock (InventoryLog reason RETURN). */
export async function receiveReturn(actor: ReturnActor, id: string, inspections: Inspection[]) {
  assertCanManageReturns(actor);
  const result = await db.$transaction(async (tx) => {
    const r = await lockReturn(tx, id, ["APPROVED"], "received");
    const byId = new Map(inspections.map((i) => [i.itemId, i]));
    if (byId.size !== r.items.length || r.items.some((i) => !byId.has(i.id))) throw new ReturnError("Inspect every line before marking the return received.");
    let restocked = 0;
    for (const item of r.items) {
      const ins = byId.get(item.id)!;
      if (ins.restock) {
        const moves = stockMoves([{ variantId: item.orderItem.variantId, quantity: item.quantity, bundle: item.orderItem.components }]);
        if (!moves.length) throw new ReturnError(`${item.orderItem.name} is no longer in the catalogue, so it can’t be restocked.`);
        for (const m of moves) await adjustStock(tx, m.variantId, m.qty, "RETURN", actor.id, r.orderId);
        restocked += item.quantity;
      }
      await tx.returnItem.update({ where: { id: item.id }, data: { condition: ins.condition, restock: ins.restock } });
    }
    await tx.returnRequest.update({ where: { id }, data: { status: "RECEIVED", receivedAt: new Date() } });
    const total = r.items.reduce((s, i) => s + i.quantity, 0);
    await event(tx, r, `Return ${r.number} received — ${restocked} of ${total} restocked`);
    return { ret: r, restocked, total };
  }, TX);
  await audit(actor.id, "return.receive", "ReturnRequest", id, {
    number: result.ret.number,
    order: result.ret.order.number,
    restocked: result.restocked,
    inspections: inspections.map((i) => ({ ...i })),
  });
  await emailCustomer(id, "received");
  return result;
}

/** Money already handed back for the order by other returns (before their fees) and how much went to the payment. */
async function previousRefunds(client: Client, orderId: string, excludeId: string) {
  const agg = await client.returnRequest.aggregate({
    where: { orderId, id: { not: excludeId }, status: "REFUNDED" },
    _sum: { refundAmount: true, restockingFee: true, providerAmount: true },
  });
  return { gross: (agg._sum.refundAmount ?? 0) + (agg._sum.restockingFee ?? 0), provider: agg._sum.providerAmount ?? 0 };
}

function quoteFor(ret: ReturnForStaff, prevGross: number, settings: ReturnSettings, waiveFee: boolean) {
  return refundQuote({
    order: ret.order,
    lines: ret.items.map((i) => ({ unitPrice: i.orderItem.unitPrice, quantity: i.quantity })),
    alreadyRefunded: prevGross,
    feePercent: settings.restockingFeePercent,
    waiveFee,
  });
}

/** What resolving this return would pay out (admin preview). */
export async function previewReturnRefund(id: string, waiveFee = false): Promise<(RefundQuote & { feePercent: number }) | null> {
  const ret = await db.returnRequest.findUnique({ where: { id }, include: staffInclude });
  if (!ret) return null;
  const settings = await getReturnSettings();
  const prev = await previousRefunds(db, ret.orderId, ret.id);
  return { ...quoteFor(ret, prev.gross, settings, waiveFee), feePercent: settings.restockingFeePercent };
}

const replacementNumber = () => `MO-${new Date().getFullYear() % 100}${String(randomInt(0, 1e6)).padStart(6, "0")}`;

/** Exchange: a zero-value order for the same pieces, ready to pack. Stock is taken now, like any sale. */
async function createReplacementOrder(tx: Tx, ret: ReturnForStaff) {
  const o = ret.order;
  for (const i of ret.items) {
    if (!i.orderItem.variantId && !i.orderItem.components.length) throw new ReturnError(`${i.orderItem.name} is no longer in the catalogue — resolve with a refund or store credit instead.`);
  }
  const created = await tx.order.create({
    data: {
      number: replacementNumber(),
      userId: o.userId,
      email: o.email,
      status: "PAID",
      currency: o.currency,
      subtotal: 0,
      shipping: 0,
      tax: 0,
      total: 0,
      shippingAddress: (o.shippingAddress ?? {}) as Prisma.InputJsonValue,
      carrier: o.carrier,
      notes: `Exchange replacement for return ${ret.number} (order ${o.number}). No charge.`,
      items: {
        create: ret.items.map((i) => ({
          variantId: i.orderItem.variantId,
          name: i.orderItem.name,
          label: i.orderItem.label,
          sku: i.orderItem.sku,
          unitPrice: 0,
          quantity: i.quantity,
          image: i.orderItem.image,
          components: i.orderItem.components,
        })),
      },
      events: { create: { status: "PAID", message: `Replacement for return ${ret.number} (order ${o.number}) — no charge` } },
    },
    include: { items: true },
  });
  try {
    for (const m of stockMoves(created.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity, bundle: i.components })))) {
      await reserve(tx, m.variantId, m.qty, created.id);
      await commitSale(tx, m.variantId, m.qty, created.id);
    }
  } catch (e) {
    if (e instanceof OutOfStockError) throw new ReturnError("Not enough stock to send a replacement. Restock first, or resolve with a refund or store credit.");
    throw e;
  }
  return created;
}

export type ResolveInput = { resolution: ReturnResolution; waiveFee?: boolean; note?: string | null };

/**
 * Final step once the parcel is received.
 *  - REFUND: the lines' paid share minus the restocking fee, back to the original payment (partial provider refund;
 *    COD/invoice → recorded for a manual transfer), any part paid by gift card back to that card.
 *  - STORE_CREDIT: the same amount as a new gift card code.
 *  - EXCHANGE: a zero-value replacement order for the same pieces.
 * Loyalty earned on the returned share is taken back for refunds and credit. The provider is called last, inside the
 * transaction, so a failed refund leaves nothing changed.
 */
export async function resolveReturn(actor: ReturnActor, id: string, input: ResolveInput) {
  assertCanManageReturns(actor);
  const settings = await getReturnSettings();
  const now = new Date();

  const out = await db.$transaction(async (tx) => {
    const r = await lockReturn(tx, id, ["RECEIVED"], "resolved");
    const o = r.order;
    if (o.status === "REFUNDED" || o.status === "CANCELLED") throw new ReturnError(`Order ${o.number} is already ${o.status.toLowerCase()} in full.`);
    const note = input.note?.trim() ? { staffNote: input.note.trim() } : {};

    if (input.resolution === "EXCHANGE") {
      const replacement = await createReplacementOrder(tx, r);
      await tx.returnRequest.update({ where: { id }, data: { status: "EXCHANGED", resolution: "EXCHANGE", resolvedAt: now, exchangeOrderId: replacement.id, restockingFee: 0, ...note } });
      await event(tx, r, `Return ${r.number} exchanged — replacement order ${replacement.number}`);
      return { ret: r, kind: "exchanged" as const, replacement, quote: null, method: null, card: null, points: 0, providerPart: 0 };
    }

    const prev = await previousRefunds(tx, o.id, r.id);
    const quote = quoteFor(r, prev.gross, settings, Boolean(input.waiveFee));
    if (quote.gross <= 0) throw new ReturnError("Nothing is left to refund on this order.");

    let providerPart = 0;
    let method: string;
    let card = null;
    const payment = o.payments.find((p) => p.status === "CAPTURED");
    const online = payment && (payment.provider === "STRIPE" || payment.provider === "RAZORPAY");

    if (input.resolution === "STORE_CREDIT") {
      const addr = (o.shippingAddress ?? {}) as { fullName?: string };
      card = await tx.giftCard.create({
        data: {
          code: generateCode(),
          initial: quote.amount,
          balance: quote.amount,
          recipient: addr.fullName ?? null,
          recipientEmail: o.email,
          senderName: brand.name,
          message: `Store credit for return ${r.number}`,
          expiresAt: new Date(now.getTime() + VALIDITY_DAYS * 864e5),
        },
      });
      method = "STORE_CREDIT";
    } else {
      // Paid by the payment method first, then any gift card share back to the card.
      const payable = payment ? Math.max(0, payment.amount - prev.provider) : 0;
      providerPart = Math.min(quote.amount, payable);
      let giftPart = quote.amount - providerPart;
      if (giftPart > 0 && !o.giftCardCode) {
        providerPart += giftPart; // nothing else to send it to: settle by hand
        giftPart = 0;
      }
      const parts: string[] = [];
      if (providerPart > 0) parts.push(online ? "PROVIDER" : "MANUAL");
      if (giftPart > 0) {
        await restoreGiftCard(tx, o.giftCardCode!, giftPart);
        parts.push("GIFT_CARD");
      }
      method = parts.join("+") || "MANUAL";
    }

    // Loyalty earned on the returned share.
    let points = 0;
    if (o.userId && !o.tradeAccountId) {
      const entries = await tx.loyaltyEntry.findMany({ where: { orderId: o.id, userId: o.userId }, select: { points: true, reason: true } });
      const earned = entries.filter((e) => e.points > 0 && e.reason.startsWith("Earned on")).reduce((s, e) => s + e.points, 0);
      const alreadyReversed = -entries.filter((e) => e.reason.startsWith("Returned:")).reduce((s, e) => s + e.points, 0);
      points = loyaltyClawback({ earned, alreadyReversed, gross: quote.gross, goodsCharged: o.total - o.shipping });
      if (points > 0) {
        await tx.loyaltyEntry.create({ data: { userId: o.userId, points: -points, reason: `Returned: ${r.number} on ${o.number}`, orderId: o.id } });
        await tx.user.update({ where: { id: o.userId }, data: { loyaltyPoints: { decrement: points } } });
      }
    }

    await tx.returnRequest.update({
      where: { id },
      data: {
        status: "REFUNDED",
        resolution: input.resolution,
        resolvedAt: now,
        refundAmount: quote.amount,
        restockingFee: quote.fee,
        providerAmount: providerPart,
        refundMethod: method,
        giftCardId: card?.id ?? null,
        ...note,
      },
    });
    const fee = quote.fee ? ` after a ${formatMoney(quote.fee)} restocking fee` : "";
    await event(
      tx,
      r,
      input.resolution === "STORE_CREDIT"
        ? `Return ${r.number}: ${formatMoney(quote.amount)} issued as store credit${fee}`
        : `Return ${r.number}: ${formatMoney(quote.amount)} refunded to ${refundMethodText(method)}${fee}`,
    );

    // Last, so a provider failure rolls everything above back. The key makes a retried refund a no-op at Stripe.
    if (online && providerPart > 0) await refundAtProvider(payment, { amount: providerPart, idempotencyKey: `rma-${r.id}` });
    return { ret: r, kind: input.resolution === "STORE_CREDIT" ? ("credited" as const) : ("refunded" as const), replacement: null, quote, method, card, points, providerPart };
  }, TX_REFUND);

  await audit(actor.id, `return.${out.kind === "exchanged" ? "exchange" : out.kind === "credited" ? "store_credit" : "refund"}`, "ReturnRequest", id, {
    number: out.ret.number,
    order: out.ret.order.number,
    resolution: input.resolution,
    amount: out.quote?.amount ?? 0,
    fee: out.quote?.fee ?? 0,
    providerAmount: out.providerPart,
    method: out.method,
    pointsReversed: out.points,
    giftCard: out.card?.code ?? null,
    replacementOrder: out.replacement?.number ?? null,
  });
  await emailCustomer(id, out.kind);
  if (out.card) await sendGiftCardEmails([out.card], out.ret.order.email);
  return out;
}

/** Internal note on a return (never shown to the customer). */
export async function updateReturnNote(actor: ReturnActor, id: string, note: string) {
  assertCanManageReturns(actor);
  const n = await db.returnRequest.updateMany({ where: { id }, data: { staffNote: note.trim() || null } });
  if (!n.count) throw new ReturnError("Return not found.");
  await audit(actor.id, "return.note", "ReturnRequest", id);
}

// ─────────────────────────────── Emails (never throw) ───────────────────────────────

async function emailCustomer(id: string, kind: ReturnEmailKind) {
  try {
    const r = await db.returnRequest.findUnique({
      where: { id },
      include: { items: { include: { orderItem: { select: { name: true, label: true } } } }, order: { select: { number: true, email: true } } },
    });
    if (!r) return;
    const [card, replacement] = await Promise.all([
      r.giftCardId ? db.giftCard.findUnique({ where: { id: r.giftCardId }, select: { code: true } }) : null,
      r.exchangeOrderId ? db.order.findUnique({ where: { id: r.exchangeOrderId }, select: { number: true } }) : null,
    ]);
    const subjects: Record<ReturnEmailKind, string> = {
      requested: `Return ${r.number} requested`,
      approved: `Return ${r.number} approved — how to send it back`,
      rejected: `About your return ${r.number}`,
      received: `Return ${r.number} received`,
      refunded: `Return ${r.number}: refund issued`,
      credited: `Return ${r.number}: store credit issued`,
      exchanged: `Return ${r.number}: replacement on its way`,
    };
    await sendEmail({
      to: r.order.email,
      subject: subjects[kind],
      react: ReturnEmail({
        kind,
        number: r.number,
        orderNumber: r.order.number,
        items: r.items.map((i) => ({ name: i.orderItem.name, label: i.orderItem.label, quantity: i.quantity })),
        amount: r.refundAmount ?? undefined,
        fee: r.restockingFee,
        refundMethod: r.refundMethod,
        rejectionReason: r.rejectionReason,
        giftCardCode: card?.code ?? null,
        exchangeOrderNumber: replacement?.number ?? null,
      }),
      devLog: `${r.number} ${kind}${r.refundAmount != null ? ` ${formatMoney(r.refundAmount)}` : ""}${r.rejectionReason && kind === "rejected" ? ` — ${r.rejectionReason}` : ""}`,
    });
  } catch (e) {
    console.error("[returns] customer email failed", e);
  }
}

/** Heads-up to everyone who holds returns.manage. Returns how many were emailed. */
export async function notifyStaffOfReturn(id: string) {
  try {
    const r = await db.returnRequest.findUnique({
      where: { id },
      include: { items: { include: { orderItem: { select: { name: true, label: true } } } }, order: { select: { number: true, email: true } } },
    });
    if (!r) return 0;
    const recipients = await staffWithPermission("returns.manage");
    for (const to of recipients) {
      await sendEmail({
        to,
        subject: `Return request ${r.number} · ${r.order.number}`,
        react: ReturnStaffEmail({
          id: r.id,
          number: r.number,
          orderNumber: r.order.number,
          email: r.order.email,
          reason: r.reason,
          preferred: RESOLUTION_LABEL[r.preferred],
          note: r.customerNote,
          items: r.items.map((i) => ({ name: i.orderItem.name, label: i.orderItem.label, quantity: i.quantity })),
        }),
      });
    }
    return recipients.length;
  } catch (e) {
    console.error("[returns] staff email failed", e);
    return 0;
  }
}
