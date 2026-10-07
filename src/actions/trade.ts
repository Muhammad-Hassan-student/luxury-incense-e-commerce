"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
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

const invalid = (err: z.ZodError) => ({ ok: false as const, error: err.issues[0]?.message ?? "Please check the form.", fieldErrors: fieldErrors(err) });

function failure(e: unknown, context: string) {
  if (e instanceof TradeError) return { ok: false as const, error: e.message };
  console.error(`[trade] ${context} failed`, e);
  return { ok: false as const, error: "Something went wrong and nothing was changed. Please try again." };
}

/** The signed-in buyer's approved account, or a buyer-safe error. */
async function approvedAccount() {
  const user = await requireUser("/trade/portal");
  const account = await getTradeAccountByUser(user.id);
  if (!account) return { error: "Apply for a trade account first." } as const;
  const blocked = blockedMessage(account.status);
  if (blocked) return { error: blocked } as const;
  return { user, account } as const;
}

function revalidatePortal() {
  revalidatePath("/trade/portal", "layout");
}

/** Submit a trade application (one per user). */
export async function applyForTrade(input: ApplicationInput): Promise<TradeActionResult> {
  const user = await requireUser("/trade/apply");
  if (!(await rateLimit("trade-apply", 5, 600)).ok) return { ok: false, error: "Too many attempts. Please try again in a few minutes." };
  const parsed = applicationSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const d = parsed.data;
  if (!user.email) return { ok: false, error: "Your account has no email address." };
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
    return failure(e, "apply");
  }
  revalidatePath("/trade/apply");
  return { ok: true };
}

/** Place a trade order straight from the quick-order grid. */
export async function placeTradeOrderAction(input: PlaceOrderInput): Promise<TradeActionResult<{ number: string; proforma: boolean }>> {
  const ctx = await approvedAccount();
  if ("error" in ctx) return { ok: false, error: ctx.error ?? "Not allowed." };
  if (!(await rateLimit("trade-order", 10, 300)).ok) return { ok: false, error: "Too many attempts. Please wait a few minutes." };
  const parsed = placeOrderSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
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
    return failure(e, "order");
  }
}

export async function requestQuoteAction(input: RequestQuoteInput): Promise<TradeActionResult<{ number: string }>> {
  const ctx = await approvedAccount();
  if ("error" in ctx) return { ok: false, error: ctx.error ?? "Not allowed." };
  if (!(await rateLimit("trade-rfq", 10, 600)).ok) return { ok: false, error: "Too many requests. Please try again later." };
  const parsed = requestQuoteSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const q = await requestQuote(ctx.account.id, parsed.data);
    revalidatePortal();
    return { ok: true, number: q.number };
  } catch (e) {
    return failure(e, "rfq");
  }
}

export async function acceptQuoteAction(input: z.input<typeof acceptQuoteSchema>): Promise<TradeActionResult<{ number: string }>> {
  const ctx = await approvedAccount();
  if ("error" in ctx) return { ok: false, error: ctx.error ?? "Not allowed." };
  if (!(await rateLimit("trade-order", 10, 300)).ok) return { ok: false, error: "Too many attempts. Please wait a few minutes." };
  const parsed = acceptQuoteSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const order = await acceptQuote({ accountId: ctx.account.id, ...parsed.data });
    revalidatePortal();
    return { ok: true, number: order.number };
  } catch (e) {
    return failure(e, "accept quote");
  }
}

export async function declineQuoteAction(input: z.input<typeof quoteNumberSchema>): Promise<TradeActionResult> {
  const user = await requireUser("/trade/portal/quotes");
  const account = await getTradeAccountByUser(user.id);
  if (!account) return { ok: false, error: "Quote not found." };
  const parsed = quoteNumberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Quote not found." };
  try {
    await declineQuote(account.id, parsed.data.number);
    revalidatePortal();
    return { ok: true };
  } catch (e) {
    return failure(e, "decline quote");
  }
}
