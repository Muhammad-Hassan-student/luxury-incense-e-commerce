"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ReturnResolution } from "@/generated/prisma/enums";
import { requireUser } from "@/server/roles";
import { rateLimit } from "@/server/rate-limit";
import { cancelReturnRequest, createReturnRequest, ReturnError } from "@/server/returns";
import { RETURN_REASONS } from "@/lib/returns";

const orderNumber = z.string().trim().min(3).max(40).regex(/^[A-Z0-9-]+$/);

const requestSchema = z.object({
  number: orderNumber,
  items: z
    .array(z.object({ orderItemId: z.string().min(1).max(64), quantity: z.number().int().min(0).max(1000) }))
    .min(1)
    .max(100),
  reason: z.enum(RETURN_REASONS),
  note: z.string().trim().max(1000).nullish(),
  preferred: z.enum(ReturnResolution),
});

export type ReturnActionResult = { ok: true; number: string } | { ok: false; error: string };

function revalidateOrder(number: string) {
  revalidatePath(`/account/orders/${number}`);
  revalidatePath("/account/orders");
  revalidatePath("/admin/returns");
}

/** Customer asks to return pieces from a delivered order. */
export async function requestReturn(input: z.input<typeof requestSchema>): Promise<ReturnActionResult> {
  const user = await requireUser();
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose the pieces, quantities and a reason." };
  if (!(await rateLimit("return-request", 5, 600)).ok) return { ok: false, error: "Too many attempts. Please try again in a few minutes." };
  try {
    const ret = await createReturnRequest({
      userId: user.id,
      orderNumber: parsed.data.number,
      items: parsed.data.items,
      reason: parsed.data.reason,
      note: parsed.data.note ?? null,
      preferred: parsed.data.preferred,
    });
    revalidateOrder(parsed.data.number);
    return { ok: true, number: ret.number };
  } catch (e) {
    if (e instanceof ReturnError) return { ok: false, error: e.message };
    console.error("[returns] request failed", e);
    return { ok: false, error: "Something went wrong and no return was created. Please try again or contact us." };
  }
}

const cancelSchema = z.object({ returnId: z.string().min(1).max(64), number: orderNumber });

/** Customer withdraws a return that hasn't been reviewed yet. */
export async function cancelMyReturn(input: z.input<typeof cancelSchema>): Promise<ReturnActionResult> {
  const user = await requireUser();
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Return not found." };
  try {
    const { number } = await cancelReturnRequest({ userId: user.id, returnId: parsed.data.returnId });
    revalidateOrder(parsed.data.number);
    return { ok: true, number };
  } catch (e) {
    if (e instanceof ReturnError) return { ok: false, error: e.message };
    console.error("[returns] cancel failed", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
