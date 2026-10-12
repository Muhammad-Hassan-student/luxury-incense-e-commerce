"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { brand } from "@/config/brand";
import { requireUser } from "@/server/roles";
import { rateLimit } from "@/server/rate-limit";
import { TradeError, blockedMessage, getTradeAccountByUser, placeTradeOrder, submitApplication } from "@/server/trade";
import { acceptQuote, declineQuote, requestQuote } from "@/server/trade-quotes";
import { acceptQuoteSchema, applicationSchema, placeOrderSchema, quoteNumberSchema, requestQuoteSchema, type ApplicationInput, type PlaceOrderInput, type RequestQuoteInput } from "@/server/trade-schemas";

export type TradeActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; fieldErrors?: Record<string, string> };

function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

const invalid = async (err: z.ZodError) => {
  const t = await getTranslations("trade.errors");
  return { ok: false as const, error: err.issues[0]?.message ?? t("checkForm"), fieldErrors: fieldErrors(err) };
};

async function failure(e: unknown, context: string) {
  if (e instanceof TradeError) return { ok: false as const, error: e.message };
  console.error(`[trade] ${context} failed`, e);
  const t = await getTranslations("trade.errors");
  return { ok: false as const, error: t("generic") };
}

/** The signed-in buyer's approved account, or a buyer-safe error. */
async function approvedAccount() {
  const user = await requireUser("/trade/portal");
  const account = await getTradeAccountByUser(user.id);
  const t = await getTranslations("trade.errors");
  if (!account) return { error: t("applyFirst") } as const;
  const blocked = blockedMessage(account.status);
  if (blocked) {
    const s = account.status;
    if (s === "PENDING" || s === "REJECTED" || s === "SUSPENDED") return { error: t(`blocked_${s}`, { email: brand.email }) } as const;
    return { error: blocked } as const;
  }
  return { user, account } as const;
}

function revalidatePortal() {
  revalidatePath("/trade/portal", "layout");
}

/** Submit a trade application (one per user). */
export async function applyForTrade(input: ApplicationInput): Promise<TradeActionResult> {
  const user = await requireUser("/trade/apply");
  const t = await getTranslations("trade.errors");
  if (!(await rateLimit("trade-apply", 5, 600)).ok) return { ok: false, error: t("tooManyAttempts") };
  const parsed = applicationSchema.safeParse(input);
  if (!parsed.success) return await invalid(parsed.error);
  const d = parsed.data;
  if (!user.email) return { ok: false, error: t("noEmail") };
  try {
    await submitApplication(
      { id: user.id, email: user.email },
      {
        businessName: d.businessName,
        businessType: d.businessType,
        contactName: d.contactName,
        phone: d.phone,
        taxId: d.taxId,
        website: d.website,
        address: { fullName: d.contactName, phone: d.phone, line1: d.line1, line2: d.line2, city: d.city, state: d.state, postalCode: d.postalCode, country: d.country },
        expectedMonthly: d.expectedMonthly,
        message: d.message,
      },
    );
  } catch (e) {
    return await failure(e, "apply");
  }
  revalidatePath("/trade/apply");
  return { ok: true };
}

/** Place a trade order straight from the quick-order grid. */
export async function placeTradeOrderAction(input: PlaceOrderInput): Promise<TradeActionResult<{ number: string; proforma: boolean }>> {
  const ctx = await approvedAccount();
  const t = await getTranslations("trade.errors");
  if ("error" in ctx) return { ok: false, error: ctx.error ?? t("notAllowed") };
  if (!(await rateLimit("trade-order", 10, 300)).ok) return { ok: false, error: t("tooManyWait") };
  const parsed = placeOrderSchema.safeParse(input);
  if (!parsed.success) return await invalid(parsed.error);
  try {
    const order = await placeTradeOrder({
      accountId: ctx.account.id,
      lines: parsed.data.lines,
      address: parsed.data.address,
      shippingRateId: parsed.data.shippingRateId,
      poNumber: parsed.data.poNumber,
      notes: parsed.data.notes,
    });
    revalidatePortal();
    revalidatePath("/account/orders");
    return { ok: true, number: order.number, proforma: order.proforma };
  } catch (e) {
    return await failure(e, "order");
  }
}

export async function requestQuoteAction(input: RequestQuoteInput): Promise<TradeActionResult<{ number: string }>> {
  const ctx = await approvedAccount();
  const t = await getTranslations("trade.errors");
  if ("error" in ctx) return { ok: false, error: ctx.error ?? t("notAllowed") };
  if (!(await rateLimit("trade-rfq", 10, 600)).ok) return { ok: false, error: t("tooManyRequests") };
  const parsed = requestQuoteSchema.safeParse(input);
  if (!parsed.success) return await invalid(parsed.error);
  try {
    const q = await requestQuote(ctx.account.id, parsed.data);
    revalidatePortal();
    return { ok: true, number: q.number };
  } catch (e) {
    return await failure(e, "rfq");
  }
}

export async function acceptQuoteAction(input: z.input<typeof acceptQuoteSchema>): Promise<TradeActionResult<{ number: string }>> {
  const ctx = await approvedAccount();
  const t = await getTranslations("trade.errors");
  if ("error" in ctx) return { ok: false, error: ctx.error ?? t("notAllowed") };
  if (!(await rateLimit("trade-order", 10, 300)).ok) return { ok: false, error: t("tooManyWait") };
  const parsed = acceptQuoteSchema.safeParse(input);
  if (!parsed.success) return await invalid(parsed.error);
  try {
    const order = await acceptQuote({ accountId: ctx.account.id, ...parsed.data });
    revalidatePortal();
    return { ok: true, number: order.number };
  } catch (e) {
    return await failure(e, "accept quote");
  }
}

export async function declineQuoteAction(input: z.input<typeof quoteNumberSchema>): Promise<TradeActionResult> {
  const user = await requireUser("/trade/portal/quotes");
  const account = await getTradeAccountByUser(user.id);
  const t = await getTranslations("trade.errors");
  if (!account) return { ok: false, error: t("quoteNotFound") };
  const parsed = quoteNumberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("quoteNotFound") };
  try {
    await declineQuote(account.id, parsed.data.number);
    revalidatePortal();
    return { ok: true };
  } catch (e) {
    return await failure(e, "decline quote");
  }
}
