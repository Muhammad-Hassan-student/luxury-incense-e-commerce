"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { rateLimit } from "@/server/rate-limit";
import { VisitError, cancelByVisitor, createVisit, emailVisitor, getAvailability, getVisitByToken, notifyStaff, rescheduleVisit } from "@/server/visits";
import { VISIT_PURPOSES, type DayAvailability } from "@/server/visit-schedule";

export type VisitActionResult = { ok: true; token: string; status: string; message?: string } | { ok: false; error: string };

type VisitT = Awaited<ReturnType<typeof getTranslations<"visit.errors">>>;

const firstError = (e: z.ZodError, t: VisitT) => e.issues[0]?.message ?? t("checkForm");

const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

/** Built per request so validation messages come out in the visitor's language. */
const makeBookingSchema = (t: VisitT) =>
  z.object({
    purpose: z.enum(VISIT_PURPOSES, t("purpose")),
    startsAt: isoDate,
    groupSize: z.number().int(t("groupWhole")).min(1, t("groupMin")).max(500),
    name: z.string().trim().min(2, t("name")).max(120),
    email: z.string().trim().max(200).pipe(z.email(t("email"))),
    phone: z
      .string()
      .trim()
      .min(7, t("phone"))
      .max(32)
      .regex(/^[+()\d\s.-]+$/, t("phoneChars")),
    company: z.string().trim().max(160).optional().default(""),
    message: z.string().trim().max(1000).optional().default(""),
  });

/** Public booking. Rate-limited per IP; the server re-checks slot, window and capacity under a lock. */
export async function bookVisit(input: z.input<ReturnType<typeof makeBookingSchema>>): Promise<VisitActionResult> {
  const t = await getTranslations("visit.errors");
  if (!(await rateLimit("visit-book", 6, 60 * 60)).ok) return { ok: false, error: t("tooManyBookings") };
  const parsed = makeBookingSchema(t).safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error, t) };
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
  const t = await getTranslations("visit.errors");
  if (!(await rateLimit("visit-manage", 30, 60 * 60)).ok) return { ok: false, error: t("tooManyAttempts") };
  const token = tokenSchema.safeParse(input?.token);
  if (!token.success) return { ok: false, error: t("notFound") };
  const v = await getVisitByToken(token.data);
  if (!v) return { ok: false, error: t("notFound") };
  try {
    const after = await cancelByVisitor(v.id);
    await emailVisitor(after, "cancelled-by-visitor");
    await notifyStaff(after, "cancelled");
    revalidatePath(`/visit/${after.token}`);
    revalidatePath("/admin/visits");
    return { ok: true, token: after.token, status: after.status, message: t("cancelled") };
  } catch (e) {
    if (e instanceof VisitError) return { ok: false, error: e.message };
    throw e;
  }
}

const rescheduleSchema = z.object({ token: tokenSchema, startsAt: isoDate });

export async function rescheduleVisitByToken(input: z.input<typeof rescheduleSchema>): Promise<VisitActionResult> {
  const t = await getTranslations("visit.errors");
  if (!(await rateLimit("visit-manage", 30, 60 * 60)).ok) return { ok: false, error: t("tooManyAttempts") };
  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("chooseNewTime") };
  const v = await getVisitByToken(parsed.data.token);
  if (!v) return { ok: false, error: t("notFound") };
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
      message: after.status === "CONFIRMED" ? t("movedConfirmed") : t("movedRequested"),
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
