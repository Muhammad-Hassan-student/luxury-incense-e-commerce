import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma, Visit, VisitStatus } from "@/generated/prisma/client";
import { VisitEmail, visitEmailSubject, type VisitEmailKind } from "@/emails/visit-email";
import { VisitStaffEmail } from "@/emails/visit-staff";
import { db } from "./db";
import { sendEmail } from "./email";
import { staffWithPermission } from "./stock-report";
import {
  COMPANY_PURPOSES,
  HOLDING_STATUSES,
  addDays,
  autoConfirms,
  bookableDays,
  fmtVisitDay,
  fmtVisitTime,
  parseVisitSettings,
  purposeLabel,
  slotProblem,
  slotsForDay,
  staffSlotProblem,
  statusLabel,
  todayIn,
  visitSettingsSchema,
  zonedParts,
  zonedToUtc,
  type DayAvailability,
  type VisitPurpose,
  type VisitSettings,
  type VisitSettingsInput,
} from "./visit-schedule";

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof db;

/** Business-rule failure with a message safe to show to the visitor or staff. */
export class VisitError extends Error {}

export const VISIT_SETTINGS_KEY = "visits";
export const VISIT_REMINDERS_KEY = "visitReminders";
const TX = { maxWait: 15_000, timeout: 20_000 } as const;

// ─────────────────────────────── Settings ───────────────────────────────

export async function getVisitSettings(): Promise<VisitSettings> {
  const row = await db.setting.findUnique({ where: { key: VISIT_SETTINGS_KEY } });
  return parseVisitSettings(row?.value);
}

export async function saveVisitSettings(input: VisitSettingsInput) {
  const value = visitSettingsSchema.parse(input);
  const json = value as unknown as Prisma.InputJsonValue;
  await db.setting.upsert({ where: { key: VISIT_SETTINGS_KEY }, update: { value: json }, create: { key: VISIT_SETTINGS_KEY, value: json } });
  return value;
}

// ─────────────────────────────── Capacity ───────────────────────────────

const holding = { in: [...HOLDING_STATUSES] as VisitStatus[] };

/** People already holding places in the slot that starts at `startsAt`. */
export async function placesTaken(client: Client, startsAt: Date, excludeId?: string) {
  const r = await client.visit.aggregate({
    where: { startsAt, status: holding, ...(excludeId ? { id: { not: excludeId } } : {}) },
    _sum: { groupSize: true },
  });
  return r._sum.groupSize ?? 0;
}

/** Serialises everything that changes the head-count of one slot. Released at commit/rollback. */
async function lockSlot(tx: Tx, startsAt: Date) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"Visit.slot:" + startsAt.toISOString()}))`;
}

/**
 * Bookable days with each slot's remaining places.
 * Visitors see the lead-time/horizon window; staff (`staff: true`) see today onwards to the horizon.
 */
export async function getAvailability(opts: { settings?: VisitSettings; now?: Date; excludeVisitId?: string; staff?: boolean } = {}): Promise<DayAvailability[]> {
  const s = opts.settings ?? (await getVisitSettings());
  const now = opts.now ?? new Date();
  let days = bookableDays(s, now);
  if (opts.staff) {
    const today = todayIn(s.timezone, now);
    const last = addDays(today, s.horizonDays);
    days = [];
    for (let d = today; d <= last; d = addDays(d, 1)) if (slotsForDay(s, d).length) days.push(d);
  }
  if (!days.length) return [];
  const from = zonedToUtc(days[0]!, "00:00", s.timezone);
  const to = zonedToUtc(addDays(days[days.length - 1]!, 1), "00:00", s.timezone);
  const groups = await db.visit.groupBy({
    by: ["startsAt"],
    where: { startsAt: { gte: from, lt: to }, status: holding, ...(opts.excludeVisitId ? { id: { not: opts.excludeVisitId } } : {}) },
    _sum: { groupSize: true },
  });
  const taken = new Map(groups.map((g) => [g.startsAt.getTime(), g._sum.groupSize ?? 0]));
  return days
    .map((day) => ({
      day,
      slots: slotsForDay(s, day)
        .map((time) => {
          const at = zonedToUtc(day, time, s.timezone);
          return { time, startsAt: at.toISOString(), at, remaining: Math.max(0, s.capacityPerSlot - (taken.get(at.getTime()) ?? 0)) };
        })
        .filter((x) => x.at.getTime() > now.getTime())
        .map(({ time, startsAt, remaining }) => ({ time, startsAt, remaining })),
    }))
    .filter((d) => d.slots.length);
}

// ─────────────────────────────── References & tokens ───────────────────────────────

/** Next "V-YY-NNNN" for the current year. Call only while holding the reference lock. */
async function nextReference(tx: Tx, now: Date, tz: string) {
  const prefix = `V-${zonedParts(now, tz).day.slice(2, 4)}-`;
  const start = prefix.length + 1;
  const rows = await tx.$queryRaw<{ seq: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING(reference FROM ${start}::int) AS INTEGER))::int AS seq
    FROM "Visit" WHERE reference LIKE ${prefix + "%"} AND SUBSTRING(reference FROM ${start}::int) ~ '^[0-9]+$'`;
  return `${prefix}${String((rows[0]?.seq ?? 0) + 1).padStart(4, "0")}`;
}

/** 144-bit URL-safe secret for the visitor's self-service link. */
const newToken = () => randomBytes(18).toString("base64url");

function isUnique(e: unknown) {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === "P2002";
}

// ─────────────────────────────── Booking ───────────────────────────────

export type BookingInput = {
  purpose: VisitPurpose;
  groupSize: number;
  startsAt: Date;
  name: string;
  email: string;
  phone: string;
  company?: string | null;
  message?: string | null;
  userId?: string | null;
  /** Staff bookings only. */
  staffNotes?: string | null;
};

/**
 * Staff-created booking (admin "New visit" / reception walk-in):
 *  • any configured slot that hasn't passed (no lead time / horizon), or for a walk-in the time given, even if past;
 *  • the visitor group-size limit doesn't apply (staff arrange large groups by hand);
 *  • capacity is enforced unless `override` (walk-ins are always admitted — they are already here);
 *  • status CONFIRMED, or CHECKED_IN for a walk-in.
 */
export type StaffBookingOptions = { override?: boolean; walkIn?: boolean };

export async function createVisit(input: BookingInput, opts: { now?: Date; settings?: VisitSettings; staff?: StaffBookingOptions } = {}) {
  const now = opts.now ?? new Date();
  const s = opts.settings ?? (await getVisitSettings());
  const staff = opts.staff;
  const walkIn = Boolean(staff?.walkIn);
  const problem = walkIn ? (Number.isNaN(input.startsAt.getTime()) ? "That time isn’t valid." : null) : staff ? staffSlotProblem(s, input.startsAt, now) : slotProblem(s, input.startsAt, now);
  if (problem) throw new VisitError(problem);
  if (input.groupSize < 1) throw new VisitError("Tell us how many are coming.");
  if (!staff && input.groupSize > s.maxGroupSize) throw new VisitError(`We can host groups of up to ${s.maxGroupSize}. For larger groups, write to us.`);
  if (!walkIn && COMPANY_PURPOSES.includes(input.purpose) && !input.company?.trim()) throw new VisitError(staff ? "Add the visitor’s company for wholesale and corporate visits." : "Please tell us your company.");
  const email = input.email.trim().toLowerCase();
  const status: VisitStatus = walkIn ? "CHECKED_IN" : staff || autoConfirms(s, input.groupSize) ? "CONFIRMED" : "REQUESTED";
  // Free places before this booking (negative when an earlier override already overbooked the slot).
  let remainingBefore = 0;

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const visit = await db.$transaction(async (tx) => {
        await lockSlot(tx, input.startsAt);
        if (email) {
          const dup = await tx.visit.findFirst({ where: { email, startsAt: input.startsAt, status: { in: ["REQUESTED", "CONFIRMED"] } }, select: { id: true } });
          if (dup) throw new VisitError(staff ? "This visitor already has a booking at that time." : "You already have a booking at this time. Check your email for the link to manage it.");
        }
        const remaining = s.capacityPerSlot - (await placesTaken(tx, input.startsAt));
        remainingBefore = remaining;
        if (input.groupSize > remaining && !(staff?.override || walkIn)) {
          if (staff) throw new VisitError(remaining > 0 ? `Only ${remaining} place${remaining === 1 ? "" : "s"} left at that time — tick “override capacity” to book anyway.` : "That time is full — tick “override capacity” to book anyway.");
          throw new VisitError(remaining > 0 ? `Only ${remaining} place${remaining === 1 ? "" : "s"} left at that time.` : "That time has just filled up. Please choose another.");
        }
        // Always taken after a slot lock, never before, so the two locks can't deadlock.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('Visit.reference'))`;
        const reference = await nextReference(tx, now, s.timezone);
        return tx.visit.create({
          data: {
            reference,
            token: newToken(),
            name: input.name.trim(),
            email,
            phone: input.phone.trim(),
            company: input.company?.trim() || null,
            purpose: input.purpose,
            groupSize: input.groupSize,
            startsAt: input.startsAt,
            durationMins: s.slotMinutes,
            status,
            message: input.message?.trim() || null,
            staffNotes: input.staffNotes?.trim() || null,
            checkedInAt: walkIn ? now : null,
            userId: input.userId ?? null,
          },
        });
      }, TX);
      return { visit, settings: s, remainingBefore, overCapacity: input.groupSize > remainingBefore };
    } catch (e) {
      if (isUnique(e) && attempt < 5) {
        await new Promise((r) => setTimeout(r, 20 + Math.random() * 80));
        continue;
      }
      throw e;
    }
  }
  throw new VisitError("We couldn’t save your booking. Please try again.");
}

// ─────────────────────────────── Changes ───────────────────────────────

export const getVisitByToken = (token: string) => (/^[A-Za-z0-9_-]{10,64}$/.test(token) ? db.visit.findUnique({ where: { token } }) : Promise.resolve(null));

function visitorChangeProblem(v: Pick<Visit, "status" | "startsAt">, verb: string, now: Date) {
  if (v.status !== "REQUESTED" && v.status !== "CONFIRMED") return `This visit is ${statusLabel(v.status).toLowerCase()} and can’t be ${verb} online.`;
  if (v.startsAt.getTime() <= now.getTime()) return `This visit has already started, so it can’t be ${verb} online. Please call us.`;
  return null;
}

/** Whether a visitor may still change this visit themselves. */
export const visitorCanChange = (v: Pick<Visit, "status" | "startsAt">, now = new Date()) =>
  (v.status === "REQUESTED" || v.status === "CONFIRMED") && v.startsAt.getTime() > now.getTime();

/**
 * Moves a visit to another slot under that slot's lock.
 * Visitors: full booking rules; status goes back to REQUESTED unless auto-confirm applies.
 * Staff: any configured future slot, optional capacity override; status becomes CONFIRMED.
 */
export async function rescheduleVisit(id: string, startsAt: Date, opts: { by: "visitor" | "staff"; override?: boolean; now?: Date; settings?: VisitSettings }) {
  const now = opts.now ?? new Date();
  const s = opts.settings ?? (await getVisitSettings());
  const problem = opts.by === "visitor" ? slotProblem(s, startsAt, now) : staffSlotProblem(s, startsAt, now);
  if (problem) throw new VisitError(problem);
  return db.$transaction(async (tx) => {
    await lockSlot(tx, startsAt);
    const v = await tx.visit.findUnique({ where: { id } });
    if (!v) throw new VisitError("Visit not found.");
    const blocked =
      opts.by === "visitor"
        ? visitorChangeProblem(v, "moved", now)
        : v.status !== "REQUESTED" && v.status !== "CONFIRMED"
          ? `This visit is ${statusLabel(v.status).toLowerCase()} and can’t be moved.`
          : null;
    if (blocked) throw new VisitError(blocked);
    if (v.startsAt.getTime() === startsAt.getTime()) throw new VisitError("That’s already the time of this visit.");
    if (opts.by === "visitor" && v.groupSize > s.maxGroupSize) throw new VisitError("Please contact us to move a group of this size.");
    const remaining = s.capacityPerSlot - (await placesTaken(tx, startsAt, v.id));
    if (v.groupSize > remaining && !(opts.by === "staff" && opts.override)) {
      throw new VisitError(remaining > 0 ? `Only ${remaining} place${remaining === 1 ? "" : "s"} left at that time.` : "That time is full.");
    }
    const status: VisitStatus = opts.by === "staff" || autoConfirms(s, v.groupSize) ? "CONFIRMED" : "REQUESTED";
    const res = await tx.visit.updateMany({
      where: { id, status: { in: ["REQUESTED", "CONFIRMED"] }, startsAt: v.startsAt },
      data: { startsAt, status, durationMins: s.slotMinutes },
    });
    if (!res.count) throw new VisitError("This visit changed while you were editing it. Please reload.");
    return { before: v, after: await tx.visit.findUniqueOrThrow({ where: { id } }) };
  }, TX);
}

/** Allowed status moves (staff). CHECKED_IN → CONFIRMED is "undo check-in"; NO_SHOW → CHECKED_IN is a late arrival. */
const FROM: Record<VisitStatus, VisitStatus[]> = {
  REQUESTED: [],
  CONFIRMED: ["REQUESTED", "CHECKED_IN"],
  DECLINED: ["REQUESTED"],
  CANCELLED: ["REQUESTED", "CONFIRMED"],
  CHECKED_IN: ["REQUESTED", "CONFIRMED", "NO_SHOW"],
  COMPLETED: ["CHECKED_IN"],
  NO_SHOW: ["REQUESTED", "CONFIRMED"],
};

export const nextVisitStatuses = (from: VisitStatus) => (Object.keys(FROM) as VisitStatus[]).filter((to) => FROM[to].includes(from));

export async function transitionVisit(id: string, to: VisitStatus, now = new Date()) {
  const v = await db.visit.findUnique({ where: { id } });
  if (!v) throw new VisitError("Visit not found.");
  if (!FROM[to].includes(v.status)) throw new VisitError(`Can’t move a ${statusLabel(v.status).toLowerCase()} visit to ${statusLabel(to).toLowerCase()}.`);
  const data: Prisma.VisitUpdateManyMutationInput = { status: to };
  if (to === "CHECKED_IN") data.checkedInAt = now;
  if (to === "CONFIRMED" && v.status === "CHECKED_IN") data.checkedInAt = null;
  // Conditional on the status we read, so two desks pressing at once can't double-apply.
  const res = await db.visit.updateMany({ where: { id, status: v.status }, data });
  if (!res.count) throw new VisitError("This visit changed a moment ago. Please reload.");
  return { before: v, after: await db.visit.findUniqueOrThrow({ where: { id } }) };
}

/** Visitor self-cancel: only before the visit, from REQUESTED/CONFIRMED. */
export async function cancelByVisitor(id: string, now = new Date()) {
  const v = await db.visit.findUnique({ where: { id } });
  if (!v) throw new VisitError("Visit not found.");
  const blocked = visitorChangeProblem(v, "cancelled", now);
  if (blocked) throw new VisitError(blocked);
  const res = await db.visit.updateMany({ where: { id, status: { in: ["REQUESTED", "CONFIRMED"] } }, data: { status: "CANCELLED" } });
  if (!res.count) throw new VisitError("This visit changed a moment ago. Please reload.");
  return db.visit.findUniqueOrThrow({ where: { id } });
}

// ─────────────────────────────── Email ───────────────────────────────

export function passFor(v: Visit, s: VisitSettings) {
  return {
    reference: v.reference,
    name: v.name,
    groupSize: v.groupSize,
    day: fmtVisitDay(v.startsAt, s.timezone),
    time: fmtVisitTime(v.startsAt, s.timezone),
    address: s.address,
    token: v.token,
    status: statusLabel(v.status),
  };
}

/** Emails the visitor; never throws (a mail failure must not undo a booking). */
export async function emailVisitor(v: Visit, kind: VisitEmailKind, opts: { reason?: string | null; settings?: VisitSettings } = {}) {
  try {
    const s = opts.settings ?? (await getVisitSettings());
    const pass = passFor(v, s);
    await sendEmail({
      to: v.email,
      subject: visitEmailSubject(kind, v.reference),
      react: VisitEmail({ kind, pass, reason: opts.reason }),
      devLog: `${v.reference} ${kind} ${pass.day} ${pass.time} → /visit/${v.token}`,
    });
  } catch (e) {
    console.error("[visits] visitor email failed", e);
  }
}

/** Heads-up to everyone who holds visits.manage. Never throws. */
export async function notifyStaff(v: Visit, event: "new" | "cancelled" | "rescheduled", settings?: VisitSettings) {
  try {
    const s = settings ?? (await getVisitSettings());
    const recipients = await staffWithPermission("visits.manage");
    const when = `${fmtVisitDay(v.startsAt, s.timezone)}, ${fmtVisitTime(v.startsAt, s.timezone)}`;
    const subject = `${event === "new" ? "Visit booking" : event === "cancelled" ? "Visit cancelled" : "Visit moved"}: ${v.reference} · ${when}`;
    for (const to of recipients) {
      await sendEmail({
        to,
        subject,
        react: VisitStaffEmail({
          event,
          id: v.id,
          reference: v.reference,
          name: v.name,
          email: v.email,
          phone: v.phone,
          company: v.company,
          purpose: purposeLabel(v.purpose),
          groupSize: v.groupSize,
          when,
          status: statusLabel(v.status),
          message: v.message,
        }),
      });
    }
    return recipients.length;
  } catch (e) {
    console.error("[visits] staff email failed", e);
    return 0;
  }
}

// ─────────────────────────────── Reminders ───────────────────────────────

const REMINDER_KEEP = 500;
const REMINDER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
type SentEntry = { id: string; at: string };

function readSent(value: unknown): SentEntry[] {
  const list = value && typeof value === "object" && !Array.isArray(value) ? (value as { sent?: unknown }).sent : undefined;
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is SentEntry => !!x && typeof x === "object" && typeof (x as SentEntry).id === "string" && typeof (x as SentEntry).at === "string");
}

/**
 * Emails CONFIRMED visitors whose visit starts in 20–28 hours, once each.
 * Sent ids live in Setting "visitReminders" (bounded, pruned after a week); they're claimed under an advisory lock
 * before sending, so overlapping cron runs can't double-send.
 */
export async function sendVisitReminders(now = new Date()) {
  const due = await db.visit.findMany({
    where: { status: "CONFIRMED", startsAt: { gte: new Date(now.getTime() + 20 * 3600_000), lte: new Date(now.getTime() + 28 * 3600_000) } },
    orderBy: { startsAt: "asc" },
  });
  if (!due.length) return { due: 0, sent: 0 };
  const claimed = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('Setting.visitReminders'))`;
    const row = await tx.setting.findUnique({ where: { key: VISIT_REMINDERS_KEY } });
    const cutoff = now.getTime() - REMINDER_TTL_MS;
    const kept = readSent(row?.value).filter((e) => Date.parse(e.at) >= cutoff);
    const seen = new Set(kept.map((e) => e.id));
    const fresh = due.filter((v) => !seen.has(v.id));
    if (fresh.length) {
      const sent = [...kept, ...fresh.map((v) => ({ id: v.id, at: now.toISOString() }))].slice(-REMINDER_KEEP);
      const value = { sent, lastRunAt: now.toISOString() };
      await tx.setting.upsert({ where: { key: VISIT_REMINDERS_KEY }, update: { value }, create: { key: VISIT_REMINDERS_KEY, value } });
    }
    return fresh;
  }, TX);
  const s = await getVisitSettings();
  for (const v of claimed) await emailVisitor(v, "reminder", { settings: s });
  return { due: due.length, sent: claimed.length };
}
