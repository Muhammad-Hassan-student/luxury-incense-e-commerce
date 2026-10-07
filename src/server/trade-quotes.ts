import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { formatMoney } from "@/lib/money";
import { TradeQuoteEmail } from "@/emails/trade-quote";
import { db } from "./db";
import { sendEmail } from "./email";
import { COFFRET_SLUG, TradeError, blockedMessage, notifyTradeStaff, placeTradeOrder, tradeEmail, type TradeAddress } from "./trade";

/*
 * Requests for quotation: the buyer asks (catalogue lines and/or free text), staff price every line,
 * the buyer accepts (→ a trade order at the quoted prices via placeTradeOrder) or declines.
 * Quotes past validUntil are expired whenever they are viewed.
 */

const fmtDay = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

export const quoteInclude = {
  items: {
    orderBy: { id: "asc" },
    include: { variant: { select: { id: true, sku: true, label: true, price: true, product: { select: { name: true } } } } },
  },
  order: { select: { id: true, number: true, status: true, total: true } },
  tradeAccount: { select: { id: true, businessName: true, userId: true, status: true, address: true, user: { select: { email: true } } } },
} satisfies Prisma.QuoteInclude;
export type QuoteFull = Prisma.QuoteGetPayload<{ include: typeof quoteInclude }>;

/** Marks quoted-but-lapsed quotes EXPIRED. Call before showing quotes. */
export async function expireQuotes(where: Prisma.QuoteWhereInput = {}, now = new Date()) {
  const r = await db.quote.updateMany({ where: { ...where, status: "QUOTED", validUntil: { lt: now } }, data: { status: "EXPIRED" } });
  return r.count;
}

async function nextQuoteNumber() {
  const yy = String(new Date().getFullYear() % 100).padStart(2, "0");
  const prefix = `Q-${yy}`;
  const rows = await db.quote.findMany({ where: { number: { startsWith: prefix } }, select: { number: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.number.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

const isUnique = (e: unknown) => typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === "P2002";

export type QuoteRequest = {
  message: string | null;
  items: { variantId: string | null; description: string; quantity: number; targetPrice: number | null }[];
};

/** Buyer asks for a quote. Catalogue lines are described from the catalogue; free-text lines keep the buyer's words. */
export async function requestQuote(accountId: string, req: QuoteRequest) {
  const account = await db.tradeAccount.findUnique({ where: { id: accountId }, include: { user: { select: { email: true } } } });
  if (!account) throw new TradeError("Trade account not found.");
  const blocked = blockedMessage(account.status);
  if (blocked) throw new TradeError(blocked);

  const ids = req.items.map((i) => i.variantId).filter((v): v is string => Boolean(v));
  const variants = ids.length
    ? await db.productVariant.findMany({
        where: { id: { in: ids }, product: { isActive: true, isGiftCard: false, slug: { not: COFFRET_SLUG } } },
        include: { product: { select: { name: true } } },
      })
    : [];
  const byId = new Map(variants.map((v) => [v.id, v]));
  const items = req.items.map((i) => {
    if (!i.variantId) return { variantId: null, description: i.description, quantity: i.quantity, targetPrice: i.targetPrice };
    const v = byId.get(i.variantId);
    if (!v) throw new TradeError("One of the items is no longer available — please remove it.");
    const base = `${v.product.name} — ${v.label}`;
    return { variantId: v.id, description: i.description ? `${base} · ${i.description}`.slice(0, 300) : base, quantity: i.quantity, targetPrice: i.targetPrice };
  });

  let created;
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    try {
      created = await db.quote.create({
        data: { number: await nextQuoteNumber(), tradeAccountId: accountId, message: req.message, items: { create: items } },
      });
    } catch (e) {
      if (!isUnique(e)) throw e;
    }
  }
  if (!created) throw new Error("Could not allocate a quote number");

  await tradeEmail(account.user.email, `Quote request ${created.number} received`, {
    preview: "We’re pricing your request",
    title: "Request received",
    paragraphs: [`Thank you — our trade desk is pricing quote ${created.number} and will reply within two working days.`],
    details: [["Lines", String(items.length)]],
    cta: { label: "View request", path: `/trade/portal/quotes/${created.number}` },
  });
  await notifyTradeStaff(`Quote request ${created.number} from ${account.businessName}`, {
    preview: `${account.businessName} asked for a quote`,
    title: "New quote request",
    paragraphs: [`${account.businessName} asked for a quote on ${items.length} line${items.length === 1 ? "" : "s"}.`, ...(req.message ? [`“${req.message}”`] : [])],
    cta: { label: "Price it", path: `/admin/trade/quotes/${created.id}` },
  });
  return created;
}

/** Buyer's own quote by number (expiring it first if it lapsed). */
export async function getBuyerQuote(accountId: string, number: string) {
  await expireQuotes({ tradeAccountId: accountId, number });
  return db.quote.findFirst({ where: { tradeAccountId: accountId, number }, include: quoteInclude });
}

export type QuoteReply = {
  validUntil: Date;
  replyMessage: string | null;
  staffNotes: string | null;
  lines: { id: string; variantId: string | null; quantity: number; quotedPrice: number | null }[];
};

/** Staff price a quote (or re-price an open/expired one) and email the buyer. Quantity 0 drops a line. */
export async function replyToQuote(quoteId: string, reply: QuoteReply, now = new Date()) {
  if (reply.validUntil.getTime() < now.getTime() - 86_400_000) throw new TradeError("The valid-until date is in the past.");
  const updated = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${quoteId} FOR UPDATE`;
    const q = await tx.quote.findUnique({ where: { id: quoteId }, include: { items: true } });
    if (!q) throw new TradeError("Quote not found.");
    if (!["REQUESTED", "QUOTED", "EXPIRED"].includes(q.status)) throw new TradeError(`This quote is ${q.status.toLowerCase()} and can’t be re-priced.`);

    const known = new Map(q.items.map((i) => [i.id, i]));
    const keep = reply.lines.filter((l) => l.quantity > 0);
    if (!keep.length) throw new TradeError("Keep at least one line on the quote.");
    for (const l of reply.lines) if (!known.has(l.id)) throw new TradeError("A line doesn’t belong to this quote.");
    for (const l of keep) if (l.quotedPrice == null) throw new TradeError(`Price every line before sending (missing: ${known.get(l.id)!.description}).`);

    const mapped = keep.map((l) => l.variantId).filter((v): v is string => Boolean(v));
    if (mapped.length) {
      const ok = await tx.productVariant.count({ where: { id: { in: mapped }, product: { isGiftCard: false, slug: { not: COFFRET_SLUG } } } });
      if (ok !== new Set(mapped).size) throw new TradeError("One of the mapped catalogue items can’t be sold on a trade order.");
    }

    await tx.quoteItem.deleteMany({ where: { quoteId, id: { in: reply.lines.filter((l) => l.quantity === 0).map((l) => l.id) } } });
    for (const l of keep) {
      await tx.quoteItem.update({ where: { id: l.id }, data: { variantId: l.variantId, quantity: l.quantity, quotedPrice: l.quotedPrice } });
    }
    return tx.quote.update({
      where: { id: quoteId },
      data: { status: "QUOTED", validUntil: reply.validUntil, replyMessage: reply.replyMessage, staffNotes: reply.staffNotes },
      include: quoteInclude,
    });
  });

  await sendEmail({
    to: updated.tradeAccount.user.email,
    subject: `Your quote ${updated.number} is ready`,
    react: TradeQuoteEmail({
      number: updated.number,
      businessName: updated.tradeAccount.businessName,
      lines: updated.items.map((i) => ({ description: i.variant ? `${i.variant.product.name} — ${i.variant.label}` : i.description, quantity: i.quantity, quotedPrice: i.quotedPrice })),
      validUntil: updated.validUntil ? fmtDay(updated.validUntil) : null,
      message: updated.replyMessage,
    }),
  }).catch((e) => console.error("[trade] quote email failed", e));
  return updated;
}

/** Why a quoted quote can't be accepted (yet), or null. Free-text lines must be mapped to a catalogue item first. */
export function acceptProblem(q: { status: string; validUntil: Date | null; items: { variantId: string | null; quotedPrice: number | null; description: string }[] }, now = new Date()) {
  if (q.status !== "QUOTED") return "This quote isn’t open for acceptance.";
  if (q.validUntil && q.validUntil < now) return "This quote has expired. Ask us to re-quote.";
  const unmapped = q.items.filter((i) => !i.variantId);
  if (unmapped.length) return `${unmapped.length} line${unmapped.length === 1 ? " is" : "s are"} not linked to a catalogue item yet (${unmapped.map((i) => i.description).join(", ")}). Our trade desk has to map ${unmapped.length === 1 ? "it" : "them"} before the quote can become an order — reply to your quote email and we’ll update it.`;
  if (q.items.some((i) => i.quotedPrice == null)) return "Some lines haven’t been priced yet.";
  return null;
}

/** Buyer accepts: a trade order at the quoted prices, through the same placeTradeOrder path. */
export async function acceptQuote(input: { accountId: string; number: string; address: TradeAddress; shippingRateId: string; poNumber?: string | null; now?: Date }) {
  const q = await getBuyerQuote(input.accountId, input.number);
  if (!q) throw new TradeError("Quote not found.");
  const problem = acceptProblem(q, input.now);
  if (problem) throw new TradeError(problem);
  const order = await placeTradeOrder({
    accountId: input.accountId,
    quoteId: q.id,
    lines: q.items.map((i) => ({ variantId: i.variantId!, quantity: i.quantity, unitPrice: i.quotedPrice! })),
    address: input.address,
    shippingRateId: input.shippingRateId,
    poNumber: input.poNumber,
    now: input.now,
  });
  await notifyTradeStaff(`Quote ${q.number} accepted — ${order.number}`, {
    preview: `${q.tradeAccount.businessName} accepted ${q.number}`,
    title: "Quote accepted",
    paragraphs: [`${q.tradeAccount.businessName} accepted ${q.number}. Order ${order.number} (${formatMoney(order.total)}) has been raised.`],
    cta: { label: "Open order", path: `/admin/orders/${order.id}` },
  });
  return order;
}

/** Buyer declines a priced quote, or withdraws a request that hasn't been priced yet. */
export async function declineQuote(accountId: string, number: string) {
  const q = await getBuyerQuote(accountId, number);
  if (!q) throw new TradeError("Quote not found.");
  const to = q.status === "QUOTED" ? "DECLINED" : q.status === "REQUESTED" ? "CANCELLED" : null;
  if (!to) throw new TradeError("This quote is already closed.");
  const r = await db.quote.updateMany({ where: { id: q.id, status: q.status }, data: { status: to } });
  if (!r.count) throw new TradeError("This quote just changed — please refresh.");
  await notifyTradeStaff(`Quote ${q.number} ${to === "DECLINED" ? "declined" : "withdrawn"}`, {
    preview: `${q.tradeAccount.businessName} ${to === "DECLINED" ? "declined" : "withdrew"} ${q.number}`,
    title: to === "DECLINED" ? "Quote declined" : "Request withdrawn",
    paragraphs: [`${q.tradeAccount.businessName} ${to === "DECLINED" ? "declined" : "withdrew"} ${q.number}.`],
    cta: { label: "Open quote", path: `/admin/trade/quotes/${q.id}` },
  });
  return to;
}

/** Staff withdraw a quote that is still open. */
export async function withdrawQuote(quoteId: string) {
  const r = await db.quote.updateMany({ where: { id: quoteId, status: { in: ["REQUESTED", "QUOTED", "EXPIRED"] } }, data: { status: "CANCELLED" } });
  if (!r.count) throw new TradeError("Only open quotes can be withdrawn.");
  const q = await db.quote.findUniqueOrThrow({ where: { id: quoteId }, include: quoteInclude });
  await tradeEmail(q.tradeAccount.user.email, `Quote ${q.number} withdrawn`, {
    preview: `Quote ${q.number} has been withdrawn`,
    title: "Quote withdrawn",
    paragraphs: [`Quote ${q.number} has been withdrawn by our trade desk. If this is unexpected, reply and we’ll help.`],
    cta: { label: "Your quotes", path: "/trade/portal/quotes" },
  });
  return q;
}
