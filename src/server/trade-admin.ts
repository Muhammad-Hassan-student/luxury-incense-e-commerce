import "server-only";
import type { Prisma, TradeTerms } from "@/generated/prisma/client";
import { formatMoney } from "@/lib/money";
import { TERMS_LABEL, minimumOrderFor } from "@/components/trade/trade-rules";
import { brand } from "@/config/brand";
import { db } from "./db";
import { TradeError, tradeEmail } from "./trade";

/*
 * Staff decisions on trade accounts. Callers check `trade.manage` and audit; every decision emails the buyer.
 */

const userEmail = { user: { select: { email: true } }, tier: true } satisfies Prisma.TradeAccountInclude;

export type ApproveInput = { tierId: string | null; terms: TradeTerms; creditLimit: number; minOrderValue: number };

/** Approves a pending (or re-approves a rejected) application, or updates an approved account's tier and terms. */
export async function approveAccount(id: string, actorId: string, input: ApproveInput) {
  const current = await db.tradeAccount.findUnique({ where: { id }, select: { status: true } });
  if (!current) throw new TradeError("Trade account not found.");
  if (current.status === "SUSPENDED") throw new TradeError("Reactivate the account before changing its terms.");
  if (input.tierId && !(await db.priceTier.findUnique({ where: { id: input.tierId }, select: { id: true } }))) throw new TradeError("That price tier no longer exists.");
  if (input.terms !== "PREPAID" && input.creditLimit <= 0) throw new TradeError("Credit terms need a credit limit.");

  const wasApproved = current.status === "APPROVED";
  const account = await db.tradeAccount.update({
    where: { id },
    data: {
      status: "APPROVED",
      tierId: input.tierId,
      terms: input.terms,
      creditLimit: input.terms === "PREPAID" ? 0 : input.creditLimit,
      minOrderValue: input.minOrderValue,
      rejectionReason: null,
      ...(wasApproved ? {} : { reviewedById: actorId, reviewedAt: new Date() }),
    },
    include: userEmail,
  });
  const minimum = minimumOrderFor(account, account.tier);
  const details: [string, string][] = [
    ["Price tier", account.tier ? `${account.tier.name} (${account.tier.discountPercent}% off retail)` : "Standard trade"],
    ["Payment terms", TERMS_LABEL[account.terms]],
    ...(account.terms !== "PREPAID" ? ([["Credit limit", formatMoney(account.creditLimit)]] as [string, string][]) : []),
    ["Minimum order", minimum ? formatMoney(minimum) : "None"],
  ];
  await tradeEmail(
    account.user.email,
    wasApproved ? "Your trade terms have been updated" : "Welcome to Maison Oud Trade",
    wasApproved
      ? {
          preview: "Your trade terms have changed",
          title: "Your terms have been updated",
          paragraphs: [`We’ve updated the trade terms for ${account.businessName}. They apply to your next order.`],
          details,
          cta: { label: "Open the trade portal", path: "/trade/portal" },
        }
      : {
          preview: "Your trade account is approved",
          title: "You’re approved",
          paragraphs: [
            `Welcome, ${account.businessName}. Your trade account is open: wholesale prices, case packs and your payment terms are now live in the trade portal.`,
            `Questions about an order? Reply to this email or write to ${brand.email}.`,
          ],
          details,
          cta: { label: "Open the trade portal", path: "/trade/portal" },
        },
  );
  return { account, wasApproved };
}

export async function rejectAccount(id: string, actorId: string, reason: string) {
  const r = await db.tradeAccount.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "REJECTED", rejectionReason: reason, reviewedById: actorId, reviewedAt: new Date() },
  });
  if (!r.count) throw new TradeError("Only applications under review can be declined.");
  const account = await db.tradeAccount.findUniqueOrThrow({ where: { id }, include: userEmail });
  await tradeEmail(account.user.email, "About your trade application", {
    preview: "An update on your trade application",
    title: "We can’t open an account just now",
    paragraphs: [
      `Thank you for applying on behalf of ${account.businessName}. We’re not able to open a trade account at the moment.`,
      reason,
      `You’re always welcome to shop with us at retail, and to write to ${brand.email} if your circumstances change.`,
    ],
  });
  return account;
}

export async function suspendAccount(id: string, reason: string) {
  const r = await db.tradeAccount.updateMany({ where: { id, status: "APPROVED" }, data: { status: "SUSPENDED" } });
  if (!r.count) throw new TradeError("Only approved accounts can be suspended.");
  const account = await db.tradeAccount.findUniqueOrThrow({ where: { id }, include: userEmail });
  await tradeEmail(account.user.email, "Your trade account is on hold", {
    preview: "Your trade account has been suspended",
    title: "Your account is on hold",
    paragraphs: [
      `We’ve put the trade account for ${account.businessName} on hold, so new orders and quotes are paused. Existing orders and invoices are unaffected.`,
      ...(reason ? [reason] : []),
      `Please contact ${brand.email} to resolve this.`,
    ],
  });
  return account;
}

export async function reactivateAccount(id: string) {
  const r = await db.tradeAccount.updateMany({ where: { id, status: "SUSPENDED" }, data: { status: "APPROVED" } });
  if (!r.count) throw new TradeError("Only suspended accounts can be reactivated.");
  const account = await db.tradeAccount.findUniqueOrThrow({ where: { id }, include: userEmail });
  await tradeEmail(account.user.email, "Your trade account is active again", {
    preview: "Your trade account is active again",
    title: "Welcome back",
    paragraphs: [`The trade account for ${account.businessName} is active again. Your prices and terms are as before.`],
    cta: { label: "Open the trade portal", path: "/trade/portal" },
  });
  return account;
}
