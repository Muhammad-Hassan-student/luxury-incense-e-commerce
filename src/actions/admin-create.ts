"use server";

import { revalidatePath } from "next/cache";
import { forbidden } from "next/navigation";
import { requirePermission } from "@/server/roles";
import { TradeError } from "@/server/trade";
import {
  ExistingTradeAccountError,
  StaffInputError,
  StaffPermissionError,
  VisitError,
  staffCreateTradeAccount,
  staffCreateVisit,
  staffWalkIn,
  type StaffVisitInput,
  type WalkInInput,
} from "@/server/staff-create";
import type { StaffCreateAccountInput } from "@/server/trade-schemas";

export type CreateResult = { ok: true; id: string; message: string } | { ok: false; error: string; fieldErrors?: Record<string, string>; existingId?: string };

function failure(e: unknown): CreateResult {
  if (e instanceof StaffPermissionError) forbidden();
  if (e instanceof StaffInputError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
  if (e instanceof ExistingTradeAccountError) return { ok: false, error: e.message, existingId: e.accountId };
  if (e instanceof TradeError || e instanceof VisitError) return { ok: false, error: e.message };
  throw e;
}

/** Trade desk opens an account for a buyer (approved, or pending review). */
export async function createTradeAccountAction(input: StaffCreateAccountInput): Promise<CreateResult> {
  const actor = await requirePermission("trade.manage");
  try {
    const { account, newUser } = await staffCreateTradeAccount(actor, input);
    revalidatePath("/admin/trade");
    revalidatePath("/admin");
    return {
      ok: true,
      id: account.id,
      message: `${account.businessName} ${account.status === "APPROVED" ? "opened" : "added for review"}${newUser ? " — new login created" : ""}; buyer emailed`,
    };
  } catch (e) {
    return failure(e);
  }
}

/** Book a visit on someone's behalf: confirmed immediately, visitor pass emailed. */
export async function createVisitAction(input: StaffVisitInput): Promise<CreateResult> {
  const actor = await requirePermission("visits.manage");
  try {
    const { visit, when, overCapacity } = await staffCreateVisit(actor, input);
    revalidatePath("/admin/visits");
    revalidatePath("/admin");
    revalidatePath("/visit");
    return { ok: true, id: visit.id, message: `${visit.reference} booked for ${when}${overCapacity ? " (over capacity)" : ""} — pass emailed` };
  } catch (e) {
    return failure(e);
  }
}

/** Reception: someone arrived without a booking — record and check them in now. */
export async function walkInAction(input: WalkInInput): Promise<CreateResult> {
  const actor = await requirePermission("visits.manage");
  try {
    const { visit, overCapacity } = await staffWalkIn(actor, input);
    revalidatePath("/admin/visits");
    revalidatePath("/admin");
    return { ok: true, id: visit.id, message: `${visit.name} checked in (${visit.reference})${overCapacity ? " — slot is now over capacity" : ""}` };
  } catch (e) {
    return failure(e);
  }
}
