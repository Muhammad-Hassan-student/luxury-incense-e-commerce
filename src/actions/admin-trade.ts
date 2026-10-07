"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { TradeError, markInvoicePaid } from "@/server/trade";
import { approveAccount, reactivateAccount, rejectAccount, suspendAccount } from "@/server/trade-admin";
import { replyToQuote, withdrawQuote } from "@/server/trade-quotes";
import {
  accountIdSchema,
  approveSchema,
  orderIdSchema,
  quoteIdSchema,
  quoteNotesSchema,
  rejectSchema,
  replyQuoteSchema,
  staffNotesSchema,
  suspendSchema,
  tierPriceSchema,
  tierSchema,
  variantTradeSchema,
} from "@/server/trade-schemas";
import { done, fail, isUniqueViolation, zodMessage } from "@/lib/admin-server";
import { toMinor, type ActionResult } from "@/lib/admin-shared";

function revalidateTrade(id?: string) {
  revalidatePath("/admin/trade");
  if (id) revalidatePath(`/admin/trade/${id}`);
  revalidatePath("/trade/portal", "layout");
  revalidatePath("/trade/apply");
}

function handle(e: unknown): ActionResult {
  if (e instanceof TradeError) return fail(e.message);
  throw e;
}

// ─────────────────────────────── Accounts ───────────────────────────────

/** Approve an application, or update an approved account's tier, terms, credit limit and minimum. */
export async function approveTradeAccount(input: z.input<typeof approveSchema>): Promise<ActionResult> {
  const user = await requirePermission("trade.manage");
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { id, ...d } = parsed.data;
  try {
    const { account, wasApproved } = await approveAccount(id, user.id, {
      tierId: d.tierId,
      terms: d.terms,
      creditLimit: toMinor(d.creditLimit),
      minOrderValue: toMinor(d.minOrderValue),
    });
    await audit(user.id, wasApproved ? "trade.terms" : "trade.approve", "TradeAccount", id, {
      business: account.businessName,
      tierId: account.tierId,
      terms: account.terms,
      creditLimit: account.creditLimit,
      minOrderValue: account.minOrderValue,
    });
    revalidateTrade(id);
    return done(wasApproved ? "Terms updated — buyer notified" : `${account.businessName} approved — buyer notified`);
  } catch (e) {
    return handle(e);
  }
}

export async function rejectTradeAccount(input: z.input<typeof rejectSchema>): Promise<ActionResult> {
  const user = await requirePermission("trade.manage");
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const account = await rejectAccount(parsed.data.id, user.id, parsed.data.reason);
    await audit(user.id, "trade.reject", "TradeAccount", account.id, { business: account.businessName, reason: parsed.data.reason });
    revalidateTrade(account.id);
    return done("Application declined — buyer notified");
  } catch (e) {
    return handle(e);
  }
}

export async function suspendTradeAccount(input: z.input<typeof suspendSchema>): Promise<ActionResult> {
  const user = await requirePermission("trade.manage");
  const parsed = suspendSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const account = await suspendAccount(parsed.data.id, parsed.data.reason);
    await audit(user.id, "trade.suspend", "TradeAccount", account.id, { business: account.businessName, reason: parsed.data.reason || null });
    revalidateTrade(account.id);
    return done("Account suspended — buyer notified");
  } catch (e) {
    return handle(e);
  }
}

export async function reactivateTradeAccount(input: z.input<typeof accountIdSchema>): Promise<ActionResult> {
  const user = await requirePermission("trade.manage");
  const parsed = accountIdSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const account = await reactivateAccount(parsed.data.id);
    await audit(user.id, "trade.reactivate", "TradeAccount", account.id, { business: account.businessName });
    revalidateTrade(account.id);
    return done("Account reactivated — buyer notified");
  } catch (e) {
    return handle(e);
  }
}

export async function saveTradeStaffNotes(input: z.input<typeof staffNotesSchema>): Promise<ActionResult> {
  const user = await requirePermission("trade.manage");
  const parsed = staffNotesSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const r = await db.tradeAccount.updateMany({ where: { id: parsed.data.id }, data: { staffNotes: parsed.data.notes || null } });
  if (!r.count) return fail("Trade account not found.");
  await audit(user.id, "trade.notes", "TradeAccount", parsed.data.id);
  revalidateTrade(parsed.data.id);
  return done("Notes saved");
}

// ─────────────────────────────── Tiers ───────────────────────────────

export async function saveTier(input: z.input<typeof tierSchema>): Promise<ActionResult> {
  const user = await requirePermission("trade.manage");
  const parsed = tierSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { id, ...t } = parsed.data;
  const data = { name: t.name, description: t.description || null, discountPercent: t.discountPercent, minOrderValue: toMinor(t.minOrderValue) };
  try {
    const saved = id ? await db.priceTier.update({ where: { id }, data, select: { id: true } }) : await db.priceTier.create({ data, select: { id: true } });
    await audit(user.id, id ? "trade.tier.update" : "trade.tier.create", "PriceTier", saved.id, data);
    revalidatePath("/admin/trade/tiers");
    revalidateTrade();
    return done(id ? `${data.name} saved` : `${data.name} created`, saved.id);
  } catch (e) {
    if (isUniqueViolation(e)) return fail("A tier with that name already exists.");
    throw e;
  }
}

export async function deleteTier(input: z.input<typeof accountIdSchema>): Promise<ActionResult> {
  const user = await requirePermission("trade.manage");
  const parsed = accountIdSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const tier = await db.priceTier.findUnique({ where: { id: parsed.data.id }, include: { _count: { select: { accounts: true } } } });
  if (!tier) return fail("Tier not found.");
  if (tier._count.accounts) return fail(`${tier._count.accounts} account${tier._count.accounts === 1 ? " uses" : "s use"} this tier. Move them first.`);
  await db.priceTier.delete({ where: { id: tier.id } });
  await audit(user.id, "trade.tier.delete", "PriceTier", tier.id, { name: tier.name });
  revalidatePath("/admin/trade/tiers");
  return done(`${tier.name} deleted`);
}

/** Set (price ₹) or clear (null) a tier's override for one variant. */
export async function setTierPrice(input: z.input<typeof tierPriceSchema>): Promise<ActionResult> {
  const user = await requirePermission("trade.manage");
  const parsed = tierPriceSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { tierId, variantId, price } = parsed.data;
  const [tier, variant] = await Promise.all([
    db.priceTier.findUnique({ where: { id: tierId }, select: { id: true } }),
    db.productVariant.findUnique({ where: { id: variantId }, select: { id: true, sku: true } }),
  ]);
  if (!tier || !variant) return fail("Tier or variant not found.");
  if (price == null) {
    await db.tradePrice.deleteMany({ where: { tierId, variantId } });
  } else {
    const minor = toMinor(price);
    await db.tradePrice.upsert({ where: { tierId_variantId: { tierId, variantId } }, create: { tierId, variantId, price: minor }, update: { price: minor } });
  }
  await audit(user.id, price == null ? "trade.price.clear" : "trade.price.set", "PriceTier", tierId, { sku: variant.sku, price: price == null ? null : toMinor(price) });
  revalidatePath("/admin/trade/tiers");
  return done(price == null ? `${variant.sku} back to tier discount` : `${variant.sku} price set`);
}

/** Case size, trade minimum and whether a variant is sold on trade. */
export async function setVariantTradeSettings(input: z.input<typeof variantTradeSchema>): Promise<ActionResult> {
  const user = await requirePermission("trade.manage");
  const parsed = variantTradeSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { variantId, ...data } = parsed.data;
  const variant = await db.productVariant.findUnique({ where: { id: variantId }, select: { sku: true, caseSize: true, tradeMinQty: true, tradeEnabled: true, product: { select: { isGiftCard: true } } } });
  if (!variant) return fail("Variant not found.");
  if (variant.product.isGiftCard) return fail("Gift cards are never sold on trade.");
  await db.productVariant.update({ where: { id: variantId }, data });
  await audit(user.id, "trade.variant", "ProductVariant", variantId, { sku: variant.sku, before: { caseSize: variant.caseSize, tradeMinQty: variant.tradeMinQty, tradeEnabled: variant.tradeEnabled }, after: data });
  revalidatePath("/admin/trade/packs");
  revalidatePath("/trade/portal", "layout");
  return done(`${variant.sku} saved`);
}

// ─────────────────────────────── Quotes ───────────────────────────────

export async function replyToQuoteAction(input: z.input<typeof replyQuoteSchema>): Promise<ActionResult> {
  const user = await requirePermission("trade.manage");
  const parsed = replyQuoteSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const d = parsed.data;
  try {
    const q = await replyToQuote(d.id, {
      // Valid through the end of the chosen day (store time).
      validUntil: new Date(`${d.validUntil}T23:59:59+05:30`),
      replyMessage: d.replyMessage || null,
      staffNotes: d.staffNotes || null,
      lines: d.lines.map((l) => ({ id: l.id, variantId: l.variantId, quantity: l.quantity, quotedPrice: l.quotedPrice == null ? null : toMinor(l.quotedPrice) })),
    });
    await audit(user.id, "trade.quote.reply", "Quote", q.id, { number: q.number, validUntil: d.validUntil, lines: q.items.length });
    revalidatePath("/admin/trade/quotes");
    revalidatePath(`/admin/trade/quotes/${q.id}`);
    revalidatePath("/trade/portal", "layout");
    return done(`Quote ${q.number} sent to the buyer`);
  } catch (e) {
    return handle(e);
  }
}

export async function withdrawQuoteAction(input: z.input<typeof quoteIdSchema>): Promise<ActionResult> {
  const user = await requirePermission("trade.manage");
  const parsed = quoteIdSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const q = await withdrawQuote(parsed.data.id);
    await audit(user.id, "trade.quote.withdraw", "Quote", q.id, { number: q.number });
    revalidatePath("/admin/trade/quotes");
    revalidatePath(`/admin/trade/quotes/${q.id}`);
    revalidatePath("/trade/portal", "layout");
    return done(`Quote ${q.number} withdrawn — buyer notified`);
  } catch (e) {
    return handle(e);
  }
}

export async function saveQuoteNotes(input: z.input<typeof quoteNotesSchema>): Promise<ActionResult> {
  const user = await requirePermission("trade.manage");
  const parsed = quoteNotesSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const r = await db.quote.updateMany({ where: { id: parsed.data.id }, data: { staffNotes: parsed.data.notes || null } });
  if (!r.count) return fail("Quote not found.");
  await audit(user.id, "trade.quote.notes", "Quote", parsed.data.id);
  revalidatePath(`/admin/trade/quotes/${parsed.data.id}`);
  return done("Notes saved");
}

// ─────────────────────────────── Invoices ───────────────────────────────

/** Record payment of a trade invoice: payment CAPTURED, paidAt, PENDING → PAID, timeline event, audit. */
export async function markTradeInvoicePaid(orderId: string): Promise<ActionResult> {
  const user = await requirePermission("trade.manage");
  const parsed = orderIdSchema.safeParse({ orderId });
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const r = await markInvoicePaid(parsed.data.orderId);
    await audit(user.id, "trade.invoice.paid", "Order", r.id, { number: r.number, total: r.total });
    revalidatePath(`/admin/orders/${r.id}`);
    revalidatePath("/admin/orders");
    if (r.tradeAccountId) revalidateTrade(r.tradeAccountId);
    return done(`${r.number} marked paid`);
  } catch (e) {
    return handle(e);
  }
}
