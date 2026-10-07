"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { rateLimit } from "@/server/rate-limit";
import { VisitError, cancelByVisitor, createVisit, emailVisitor, getAvailability, getVisitByToken, notifyStaff, rescheduleVisit } from "@/server/visits";
import { VISIT_PURPOSES, type DayAvailability } from "@/server/visit-schedule";

export type VisitActionResult = { ok: true; token: string; status: string; message?: string } | { ok: false; error: string };

const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Please check the form.";

const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const bookingSchema = z.object({
  purpose: z.enum(VISIT_PURPOSES, "Choose what brings you to us."),
  startsAt: isoDate,
  groupSize: z.number().int("Group size must be a whole number.").min(1, "At least one guest.").max(500),
  name: z.string().trim().min(2, "Please give your name.").max(120),
  email: z.string().trim().max(200).pipe(z.email("Enter a valid email.")),
  phone: z
    .string()
    .trim()
    .min(7, "Enter a phone number we can reach you on.")
    .max(32)
    .regex(/^[+()\d\s.-]+$/, "Phone numbers may contain digits, spaces, +, - and brackets."),
  company: z.string().trim().max(160).optional().default(""),
  message: z.string().trim().max(1000).optional().default(""),
});

/** Public booking. Rate-limited per IP; the server re-checks slot, window and capacity under a lock. */
export async function bookVisit(input: z.input<typeof bookingSchema>): Promise<VisitActionResult> {
  if (!(await rateLimit("visit-book", 6, 60 * 60)).ok) return { ok: false, error: "Too many booking attempts. Please try again in a while." };
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const session = await auth();
  try {
    const { visit, settings } = await createVisit({ ...parsed.data, userId: session?.user?.id ?? null });
    await emailVisitor(visit, visit.status === "CONFIRMED" ? "confirmed" : "received", { settings });
    await notifyStaff(visit, "new", settings);
    revalidatePath("/admin/visits");
    return { ok: true, token: visit.token, status: visit.status };
  } catch (e) {
    if (e instanceof VisitError) return { ok: false, error: e.message };
    throw e;
  }
}

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{10,64}$/);

export async function cancelVisitByToken(input: { token: string }): Promise<VisitActionResult> {
  if (!(await rateLimit("visit-manage", 30, 60 * 60)).ok) return { ok: false, error: "Too many attempts. Please try again later." };
  const token = tokenSchema.safeParse(input?.token);
  if (!token.success) return { ok: false, error: "Booking not found." };
  const v = await getVisitByToken(token.data);
  if (!v) return { ok: false, error: "Booking not found." };
  try {
    const after = await cancelByVisitor(v.id);
    await emailVisitor(after, "cancelled-by-visitor");
    await notifyStaff(after, "cancelled");
    revalidatePath(`/visit/${after.token}`);
    revalidatePath("/admin/visits");
    return { ok: true, token: after.token, status: after.status, message: "Your visit is cancelled." };
  } catch (e) {
    if (e instanceof VisitError) return { ok: false, error: e.message };
    throw e;
  }
}

const rescheduleSchema = z.object({ token: tokenSchema, startsAt: isoDate });

export async function rescheduleVisitByToken(input: z.input<typeof rescheduleSchema>): Promise<VisitActionResult> {
  if (!(await rateLimit("visit-manage", 30, 60 * 60)).ok) return { ok: false, error: "Too many attempts. Please try again later." };
  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please choose a new time." };
  const v = await getVisitByToken(parsed.data.token);
  if (!v) return { ok: false, error: "Booking not found." };
  try {
    const { after } = await rescheduleVisit(v.id, parsed.data.startsAt, { by: "visitor" });
    await emailVisitor(after, after.status === "CONFIRMED" ? "rescheduled" : "received");
    await notifyStaff(after, "rescheduled");
    revalidatePath(`/visit/${after.token}`);
    revalidatePath("/admin/visits");
    return {
      ok: true,
      token: after.token,
      status: after.status,
      message: after.status === "CONFIRMED" ? "Your visit has moved and is confirmed." : "Your new time is requested; we’ll confirm it shortly.",
    };
  } catch (e) {
    if (e instanceof VisitError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Fresh availability for the booking widget (e.g. after a slot fills while someone is choosing). */
export async function refreshVisitAvailability(input?: { token?: string }): Promise<DayAvailability[]> {
  let excludeVisitId: string | undefined;
  if (input?.token) {
    const t = tokenSchema.safeParse(input.token);
    const v = t.success ? await getVisitByToken(t.data) : null;
    excludeVisitId = v?.id;
  }
  return getAvailability({ excludeVisitId });
}
