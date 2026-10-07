import "server-only";
import { randomInt } from "node:crypto";
import type { Model3D, Prisma, TradeStatus } from "@/generated/prisma/client";
import { brand } from "@/config/brand";
import { price } from "@/lib/pricing";
import { formatMoney } from "@/lib/money";
import type { ProductMedia } from "@/components/product/product-photo";
import {
  TERMS_DAYS,
  TERMS_LABEL,
  isCreditTerms,
  minimumOrderFor,
  quantityProblem,
  tradeUnitPrice,
} from "@/components/trade/trade-rules";
import { TradeNoticeEmail } from "@/emails/trade-notice";
import { db } from "./db";
import { sendEmail } from "./email";
import { OutOfStockError, reserve, stockMoves } from "./inventory";
import { csvRow, invoiceNumberFor, rupees } from "./invoices";
import { cancelOrder, confirmOrder, quote as orderQuote, type ShippingAddress } from "./orders";
import { staffWithPermission } from "./stock-report";

/*
 * Trade (wholesale) core: accounts, catalogue pricing, trade order placement, invoices and statements.
 * Quotes live in ./trade-quotes, staff decisions in ./trade-admin.
 */

/** Message is safe to show the buyer. */
export class TradeError extends Error {}

export const COFFRET_SLUG = "build-your-coffret";
const DAY_MS = 86_400_000;
const fmtDay = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof db;

// ─────────────────────────────── Accounts ───────────────────────────────

export const accountInclude = {
  tier: true,
  user: { select: { id: true, email: true, name: true } },
} satisfies Prisma.TradeAccountInclude;

export type TradeAccountFull = Prisma.TradeAccountGetPayload<{ include: typeof accountInclude }>;

export const getTradeAccountByUser = (userId: string) => db.tradeAccount.findUnique({ where: { userId }, include: accountInclude });

export type TradeAddress = ShippingAddress;

export function asTradeAddress(v: Prisma.JsonValue | null | undefined): TradeAddress | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const a = v as Partial<TradeAddress>;
  if (!a.line1 || !a.city || !a.country) return null;
  return {
    fullName: a.fullName ?? "",
    phone: a.phone ?? "",
    line1: a.line1,
    line2: a.line2 || undefined,
    city: a.city,
    state: a.state ?? "",
    postalCode: a.postalCode ?? "",
    country: a.country,
  };
}

/** Why a non-approved account can't trade, in the buyer's words. */
export function blockedMessage(status: TradeStatus) {
  if (status === "PENDING") return "Your trade application is still under review.";
  if (status === "REJECTED") return "Your trade application wasn’t approved.";
  if (status === "SUSPENDED") return `Your trade account is suspended. Please contact ${brand.email}.`;
  return null;
}

/** Fire-and-forget email helper: trade emails must never fail the action that triggered them. */
export async function tradeEmail(to: string | string[], subject: string, props: Parameters<typeof TradeNoticeEmail>[0]) {
  for (const addr of Array.isArray(to) ? to : [to]) {
    await sendEmail({ to: addr, subject, react: TradeNoticeEmail(props), devLog: props.paragraphs[0] }).catch((e) => console.error("[trade] email failed", e));
  }
}

/** Emails everyone who can act on trade (trade.manage), resolved the same way as the low-stock digest. */
export async function notifyTradeStaff(subject: string, props: Parameters<typeof TradeNoticeEmail>[0]) {
  const to = await staffWithPermission("trade.manage");
  if (to.length) await tradeEmail(to, subject, { eyebrow: "Trade desk", ...props });
  return to.length;
}

export type ApplicationData = {
  businessName: string;
  businessType: string;
  contactName: string;
  phone: string;
  taxId: string | null;
  website: string | null;
  address: TradeAddress;
  expectedMonthly: string;
  message: string | null;
};

/** One application per user. Emails the applicant and the trade desk. */
export async function submitApplication(user: { id: string; email: string }, data: ApplicationData) {
  const existing = await db.tradeAccount.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (existing) throw new TradeError("You’ve already applied — we’ll be in touch.");
  let account;
  try {
    account = await db.tradeAccount.create({
      data: {
        userId: user.id,
        businessName: data.businessName,
        businessType: data.businessType,
        contactName: data.contactName,
        phone: data.phone,
        taxId: data.taxId,
        website: data.website,
        address: data.address,
        expectedMonthly: data.expectedMonthly,
        message: data.message,
      },
    });
  } catch (e) {
    if (typeof e === "object" && e && "code" in e && (e as { code: unknown }).code === "P2002") throw new TradeError("You’ve already applied — we’ll be in touch.");
    throw e;
  }
  await tradeEmail(user.email, "We’ve received your trade application", {
    preview: "Your application is with our trade desk",
    title: "Application received",
    paragraphs: [
      `Thank you, ${data.contactName.split(" ")[0]}. Our trade desk reviews every application by hand and usually replies within two working days.`,
      "Once approved you’ll see trade prices, case packs and your payment terms in the trade portal.",
    ],
    details: [
      ["Business", data.businessName],
      ["Expected volume", data.expectedMonthly],
    ],
    cta: { label: "View your application", path: "/trade/apply" },
  });
  await notifyTradeStaff(`New trade application: ${data.businessName}`, {
    preview: `${data.businessName} applied for a trade account`,
    title: "New trade application",
    paragraphs: [`${data.businessName} (${data.contactName}) has applied for a trade account.`],
    details: [
      ["Type", data.businessType],
      ["Tax ID", data.taxId ?? "—"],
      ["City", `${data.address.city}, ${data.address.country}`],
      ["Expected volume", data.expectedMonthly],
    ],
    cta: { label: "Review application", path: `/admin/trade/${account.id}` },
  });
  return account;
}

// ─────────────────────────────── Catalogue ───────────────────────────────

/** What a trade buyer can see and order: tradeable variants of active, physical, non-configurable products. */
export const tradeVariantWhere: Prisma.ProductVariantWhereInput = {
  tradeEnabled: true,
  product: { isActive: true, isGiftCard: false, slug: { not: COFFRET_SLUG } },
};

export type CatalogueRow = {
  variantId: string;
  sku: string;
  label: string;
  productId: string;
  productName: string;
  productSlug: string;
  subtitle: string;
  category: string;
  model: Model3D;
  palette: string[];
  media: ProductMedia | null;
  retail: number;
  trade: number;
  /** True when the tier sets this variant's price explicitly. */
  override: boolean;
  caseSize: number;
  minQty: number;
  available: number;
};

export async function tradeCatalogue(tier: { id: string; discountPercent: number } | null, opts: { variantIds?: string[] } = {}): Promise<CatalogueRow[]> {
  const variants = await db.productVariant.findMany({
    where: { ...tradeVariantWhere, ...(opts.variantIds ? { id: { in: opts.variantIds } } : {}) },
    orderBy: [{ product: { category: { position: "asc" } } }, { product: { name: "asc" } }, { position: "asc" }],
    include: {
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          subtitle: true,
          model: true,
          palette: true,
          category: { select: { name: true } },
          images: { orderBy: { position: "asc" }, take: 1, select: { type: true, url: true, poster: true, alt: true, cutoutUrl: true, display: true } },
        },
      },
      tradePrices: tier ? { where: { tierId: tier.id } } : false,
    },
  });
  return variants.map((v) => {
    const override = (v.tradePrices ?? [])[0]?.price ?? null;
    const img = v.product.images[0];
    return {
      variantId: v.id,
      sku: v.sku,
      label: v.label,
      productId: v.product.id,
      productName: v.product.name,
      productSlug: v.product.slug,
      subtitle: v.product.subtitle,
      category: v.product.category.name,
      model: v.product.model,
      palette: v.product.palette,
      media: img ? { type: img.type, url: img.url, poster: img.poster, alt: img.alt || v.product.name, cutoutUrl: img.cutoutUrl, display: img.display } : null,
      retail: v.price,
      trade: tradeUnitPrice(v.price, tier?.discountPercent ?? 0, override),
      override: override != null,
      caseSize: Math.max(1, v.caseSize),
      minQty: Math.max(1, v.tradeMinQty),
      available: Math.max(0, v.stock - v.reserved),
    };
  });
}

// ─────────────────────────────── Statement ───────────────────────────────

/** Unpaid trade invoices that still count against credit (anything not cancelled/refunded and not yet paid). */
const unpaidWhere = (accountId: string): Prisma.OrderWhereInput => ({ tradeAccountId: accountId, paidAt: null, status: { notIn: ["CANCELLED", "REFUNDED"] } });

export async function outstandingFor(client: Client, accountId: string) {
  const agg = await client.order.aggregate({ where: unpaidWhere(accountId), _sum: { total: true } });
  return agg._sum.total ?? 0;
}

export type TradeStatement = {
  outstanding: number;
  openInvoices: number;
  overdue: number;
  overdueInvoices: number;
  creditLimit: number;
  /** Null when the account has no credit (prepaid). */
  creditAvailable: number | null;
  /** 0–100, for a usage bar. */
  creditUsedPercent: number;
};

export async function tradeStatement(account: { id: string; creditLimit: number; terms: string }, now = new Date()): Promise<TradeStatement> {
  const [open, late] = await Promise.all([
    db.order.aggregate({ where: unpaidWhere(account.id), _sum: { total: true }, _count: true }),
    db.order.aggregate({ where: { ...unpaidWhere(account.id), dueDate: { lt: now } }, _sum: { total: true }, _count: true }),
  ]);
  const outstanding = open._sum.total ?? 0;
  const credit = account.terms !== "PREPAID" && account.creditLimit > 0;
  return {
    outstanding,
    openInvoices: open._count,
    overdue: late._sum.total ?? 0,
    overdueInvoices: late._count,
    creditLimit: account.creditLimit,
    creditAvailable: credit ? Math.max(0, account.creditLimit - outstanding) : null,
    creditUsedPercent: credit ? Math.min(100, Math.round((outstanding / account.creditLimit) * 100)) : 0,
  };
}

// ─────────────────────────────── Pricing & placement ───────────────────────────────

export type TradeLineRequest = { variantId: string; quantity: number; /** Quote acceptance only: agreed unit price. */ unitPrice?: number };

export type PricedTradeLine = {
  variantId: string;
  sku: string;
  name: string;
  label: string;
  quantity: number;
  unitPrice: number;
  retail: number;
};

/**
 * Validates and prices order lines for an account. Catalogue orders follow case packs and minimums
 * and are merged per variant; quoted lines keep their agreed prices and quantities.
 */
export async function priceTradeLines(
  account: { tierId: string | null; tier: { discountPercent: number } | null },
  requests: TradeLineRequest[],
  opts: { quoted?: boolean } = {},
): Promise<PricedTradeLine[]> {
  let wanted = requests.filter((r) => r.quantity > 0);
  if (!opts.quoted) {
    const merged = new Map<string, number>();
    for (const r of wanted) merged.set(r.variantId, (merged.get(r.variantId) ?? 0) + r.quantity);
    wanted = [...merged].map(([variantId, quantity]) => ({ variantId, quantity }));
  }
  if (!wanted.length) throw new TradeError("Add at least one item to your order.");

  const variants = await db.productVariant.findMany({
    where: { id: { in: [...new Set(wanted.map((w) => w.variantId))] } },
    include: {
      product: { select: { name: true, slug: true, isActive: true, isGiftCard: true } },
      tradePrices: account.tierId ? { where: { tierId: account.tierId } } : false,
    },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  const needed = new Map<string, number>();
  const lines = wanted.map((w) => {
    const v = byId.get(w.variantId);
    if (!v || !v.product.isActive || v.product.isGiftCard || v.product.slug === COFFRET_SLUG || (!opts.quoted && !v.tradeEnabled)) {
      throw new TradeError(`${v ? `${v.product.name} (${v.label})` : "An item"} is no longer available to trade buyers.`);
    }
    if (!opts.quoted) {
      const problem = quantityProblem(w.quantity, v.caseSize, v.tradeMinQty);
      if (problem) throw new TradeError(`${v.product.name} (${v.label}): ${problem}.`);
    }
    if (opts.quoted && (w.unitPrice == null || !Number.isInteger(w.unitPrice) || w.unitPrice < 0)) throw new TradeError("This quote has a line without a price.");
    needed.set(v.id, (needed.get(v.id) ?? 0) + w.quantity);
    const override = (v.tradePrices ?? [])[0]?.price ?? null;
    return {
      variantId: v.id,
      sku: v.sku,
      name: v.product.name,
      label: v.label,
      quantity: w.quantity,
      unitPrice: opts.quoted ? w.unitPrice! : tradeUnitPrice(v.price, account.tier?.discountPercent ?? 0, override),
      retail: v.price,
    };
  });
  for (const [variantId, qty] of needed) {
    const v = byId.get(variantId)!;
    const free = Math.max(0, v.stock - v.reserved);
    if (qty > free) throw new TradeError(free ? `Only ${free} of ${v.product.name} (${v.label}) available right now.` : `${v.product.name} (${v.label}) is out of stock.`);
  }
  return lines;
}

/** Totals for a trade order: same tax maths as consumer checkout (no coupons, points, gift cards or wrap). */
export async function tradeTotals(lines: { unitPrice: number; quantity: number }[], opts: { shippingRateId?: string | null; country: string }) {
  const { rate, rates, settings } = await orderQuote({ lines: [], cart: null, shippingRateId: opts.shippingRateId, country: opts.country });
  const pricing = price({
    lines: lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })),
    shipping: rate,
    pointValue: brand.loyalty.pointValue,
    taxRatePercent: settings.taxRatePercent,
    taxInclusive: settings.taxInclusive,
  });
  return { pricing, rate, rates, settings };
}

export type PlaceTradeOrderInput = {
  accountId: string;
  lines: TradeLineRequest[];
  address: TradeAddress;
  shippingRateId: string;
  poNumber?: string | null;
  notes?: string | null;
  /** Accepting a quote: prices come from the quote, case-pack and minimum-order rules are waived. */
  quoteId?: string;
  now?: Date;
};

/**
 * Places a trade order on the account's terms.
 * One transaction: lock the account, check credit, create the order + INVOICE payment, reserve stock (and claim the quote).
 * Then confirmOrder(captured: false) commits the stock and sends the confirmation, exactly as for consumer COD orders.
 */
export async function placeTradeOrder(input: PlaceTradeOrderInput) {
  const now = input.now ?? new Date();
  const account = await db.tradeAccount.findUnique({ where: { id: input.accountId }, include: accountInclude });
  if (!account) throw new TradeError("Trade account not found.");
  const blocked = blockedMessage(account.status);
  if (blocked) throw new TradeError(blocked);

  const quoted = Boolean(input.quoteId);
  const lines = await priceTradeLines(account, input.lines, { quoted });
  const { pricing, rate } = await tradeTotals(lines, { shippingRateId: input.shippingRateId, country: input.address.country });
  if (!rate) throw new TradeError("We don’t ship to that country yet. Contact the trade desk for a freight quote.");
  if (input.shippingRateId !== rate.id) throw new TradeError("That shipping option isn’t available for this address.");

  if (!quoted) {
    const minimum = minimumOrderFor(account, account.tier);
    if (pricing.subtotal < minimum) {
      throw new TradeError(`Your minimum order is ${formatMoney(minimum)} — add ${formatMoney(minimum - pricing.subtotal)} more.`);
    }
  }

  const credit = isCreditTerms(account.terms);
  const dueDate = new Date(now.getTime() + TERMS_DAYS[account.terms] * DAY_MS);
  const proforma = !credit;
  const reservedUntil = new Date(now.getTime() + brand.reservationMinutes * 60_000);

  let order;
  try {
    order = await db.$transaction(async (tx) => {
      // Serialise orders per account so two at once can't both squeeze under the credit limit.
      await tx.$queryRaw`SELECT id FROM "TradeAccount" WHERE id = ${account.id} FOR UPDATE`;
      const fresh = await tx.tradeAccount.findUniqueOrThrow({ where: { id: account.id }, select: { status: true, creditLimit: true, terms: true } });
      const stillBlocked = blockedMessage(fresh.status);
      if (stillBlocked) throw new TradeError(stillBlocked);
      if (fresh.terms !== account.terms) throw new TradeError("Your payment terms just changed. Please review your order again.");
      if (credit) {
        const outstanding = await outstandingFor(tx, account.id);
        if (fresh.creditLimit <= 0) throw new TradeError(`Your account has no credit limit set yet. Please contact ${brand.email}.`);
        if (outstanding + pricing.total > fresh.creditLimit) {
          const available = Math.max(0, fresh.creditLimit - outstanding);
          throw new TradeError(
            `This order (${formatMoney(pricing.total)}) is over your available credit of ${formatMoney(available)}. ` +
              `You have ${formatMoney(outstanding)} outstanding against a ${formatMoney(fresh.creditLimit)} limit — settle an invoice or contact us to raise it.`,
          );
        }
      }

      const created = await tx.order.create({
        data: {
          number: await uniqueOrderNumber(tx),
          userId: account.userId,
          email: account.user.email,
          currency: brand.baseCurrency,
          subtotal: pricing.subtotal,
          discount: 0,
          pointsRedeemed: 0,
          shipping: pricing.shipping,
          tax: pricing.tax,
          total: pricing.total,
          shippingAddress: input.address,
          carrier: rate.name,
          notes: [proforma ? "PROFORMA — ship only after payment is received." : null, input.notes ? `Buyer note: ${input.notes}` : null].filter(Boolean).join("\n") || null,
          reservedUntil,
          tradeAccountId: account.id,
          poNumber: input.poNumber || null,
          dueDate,
          items: {
            create: lines.map((l) => ({ variantId: l.variantId, name: l.name, label: l.label, sku: l.sku, unitPrice: l.unitPrice, quantity: l.quantity })),
          },
          payments: {
            create: {
              provider: "INVOICE",
              amount: pricing.total,
              currency: brand.baseCurrency,
              raw: { tradeAccountId: account.id, terms: account.terms, shipAfterPayment: proforma, ...(input.quoteId ? { quoteId: input.quoteId } : {}) },
            },
          },
          events: {
            create: {
              status: "PENDING",
              message: `Trade order placed${input.poNumber ? ` — PO ${input.poNumber}` : ""}${input.quoteId ? " from quote" : ""}`,
            },
          },
        },
        include: { items: true },
      });
      for (const m of stockMoves(created.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })))) {
        await reserve(tx, m.variantId, m.qty, created.id);
      }
      if (input.quoteId) {
        const claimed = await tx.quote.updateMany({
          where: { id: input.quoteId, tradeAccountId: account.id, status: "QUOTED", orderId: null, OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
          data: { status: "ACCEPTED", orderId: created.id },
        });
        if (claimed.count !== 1) throw new TradeError("This quote is no longer open for acceptance.");
      }
      return created;
    });
  } catch (e) {
    if (e instanceof OutOfStockError) throw new TradeError("Something in your order just sold out. Please review quantities.");
    throw e;
  }

  try {
    await confirmOrder(order.id, { captured: false });
  } catch (e) {
    await cancelOrder(order.id, "Trade order could not be confirmed");
    if (input.quoteId) await db.quote.updateMany({ where: { id: input.quoteId, orderId: order.id }, data: { status: "QUOTED", orderId: null } });
    throw e;
  }

  const invoiceNo = invoiceNumberFor(order.number);
  const termsLine = proforma
    ? `Proforma ${invoiceNo} issued — prepaid; ships after payment (due ${fmtDay(dueDate)})`
    : `Invoice ${invoiceNo} issued — ${TERMS_LABEL[account.terms]}, due ${fmtDay(dueDate)}`;
  await db.orderEvent.create({ data: { orderId: order.id, status: "PENDING", message: termsLine } });

  await tradeEmail(account.user.email, proforma ? `Proforma ${invoiceNo} — payment due ${fmtDay(dueDate)}` : `Invoice ${invoiceNo} — due ${fmtDay(dueDate)}`, {
    preview: proforma ? "Your proforma invoice is ready" : "Your trade invoice is ready",
    title: proforma ? "Proforma invoice" : "Trade invoice",
    paragraphs: [
      proforma
        ? "Thank you for your order. Your account is on prepaid terms, so we’ll dispatch as soon as payment reaches us. Your stock is held in the meantime."
        : `Thank you for your order. It’s on your ${TERMS_LABEL[account.terms]} terms and will be dispatched shortly.`,
      `Please pay by bank transfer quoting ${order.number}${input.poNumber ? ` / PO ${input.poNumber}` : ""}.`,
    ],
    details: [
      ["Order", order.number],
      ...(input.poNumber ? ([["Your PO", input.poNumber]] as [string, string][]) : []),
      ["Total", formatMoney(order.total)],
      ["Terms", TERMS_LABEL[account.terms]],
      ["Due", fmtDay(dueDate)],
    ],
    cta: { label: "View invoice", path: `/trade/portal/orders/${order.number}` },
  });

  return { id: order.id, number: order.number, total: order.total, dueDate, proforma };
}

async function uniqueOrderNumber(tx: Tx) {
  for (let i = 0; i < 5; i++) {
    const n = `MO-${new Date().getFullYear() % 100}${String(randomInt(0, 1e6)).padStart(6, "0")}`;
    if (!(await tx.order.findUnique({ where: { number: n }, select: { id: true } }))) return n;
  }
  throw new Error("Could not allocate an order number");
}

// ─────────────────────────────── Invoices paid ───────────────────────────────

/**
 * Staff record that a trade invoice has been paid: payment CAPTURED, paidAt set, PENDING → PAID, timeline event.
 * Callers must check `trade.manage` and audit.
 */
export async function markInvoicePaid(orderId: string, now = new Date()) {
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { payments: { orderBy: { createdAt: "asc" } } } });
    if (!order || !order.tradeAccountId) throw new TradeError("That isn’t a trade order.");
    if (order.paidAt) throw new TradeError("This invoice is already marked paid.");
    if (order.status === "CANCELLED" || order.status === "REFUNDED") throw new TradeError("This order was cancelled — there’s nothing to collect.");
    if (order.reservedUntil) throw new TradeError("This order hasn’t been confirmed yet.");
    const payment = order.payments.find((p) => p.provider === "INVOICE") ?? order.payments[0];
    if (payment) await tx.payment.update({ where: { id: payment.id }, data: { status: "CAPTURED" } });
    else await tx.payment.create({ data: { orderId, provider: "INVOICE", status: "CAPTURED", amount: order.total, currency: order.currency } });
    const status = order.status === "PENDING" ? "PAID" : order.status;
    await tx.order.update({ where: { id: orderId }, data: { paidAt: now, status } });
    await tx.orderEvent.create({ data: { orderId, status, message: `Trade invoice paid — ${formatMoney(order.total)} received` } });
    return { id: order.id, number: order.number, email: order.email, total: order.total, status, tradeAccountId: order.tradeAccountId };
  });

  await tradeEmail(result.email, `Payment received for ${result.number}`, {
    preview: "Thank you — your payment has been received",
    title: "Payment received",
    paragraphs: [`We’ve received ${formatMoney(result.total)} against ${invoiceNumberFor(result.number)}. Thank you.`],
    cta: { label: "View statement", path: "/trade/portal/orders" },
  });
  return result;
}

// ─────────────────────────────── Re-order & price list ───────────────────────────────

/** Quantities from a past order of this account, rounded up to current case packs and minimums. */
export async function reorderQuantities(accountId: string, orderNumber: string) {
  const order = await db.order.findFirst({ where: { number: orderNumber, tradeAccountId: accountId }, include: { items: true } });
  if (!order) return null;
  const out: Record<string, number> = {};
  for (const i of order.items) if (i.variantId) out[i.variantId] = (out[i.variantId] ?? 0) + i.quantity;
  return { number: order.number, quantities: out };
}

export const PRICE_LIST_HEADER = ["SKU", "Product", "Variant", "Case size", "Min qty", "Retail (INR)", "Trade price (INR)", "Available"] as const;

/** Formula-safe CSV of the account's trade prices (cells escaped by csvRow, like the order export). */
export async function priceListCsv(tier: { id: string; discountPercent: number } | null) {
  const rows = await tradeCatalogue(tier);
  const body = rows.map((r) => csvRow([r.sku, r.productName, r.label, r.caseSize, r.minQty, rupees(r.retail), rupees(r.trade), r.available]));
  // BOM so Excel opens UTF-8 correctly; CRLF per RFC 4180.
  return { csv: "﻿" + [csvRow([...PRICE_LIST_HEADER]), ...body].join("\r\n") + "\r\n", count: rows.length };
}
