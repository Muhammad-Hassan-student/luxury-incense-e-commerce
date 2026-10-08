// Atelier visit scheduling: settings schema, time-zone maths and slot rules.
// Pure and client-safe (no server-only imports) so the booking UI, the server and the tests share one source of truth.
import { z } from "zod";

// ─────────────────────────────── Constants ───────────────────────────────

export const VISIT_PURPOSES = ["WHOLESALE", "CORPORATE", "WORKSHOP", "PRESS", "TOUR", "OTHER"] as const;
export type VisitPurpose = (typeof VISIT_PURPOSES)[number];

export const PURPOSE_INFO: Record<VisitPurpose, { label: string; blurb: string }> = {
  TOUR: { label: "Atelier tour", blurb: "Walk the rolling tables, the still room and the blending room with one of our perfumers." },
  WORKSHOP: { label: "Workshop", blurb: "Roll your own sticks and blend a bakhoor to take home. Hands-on, unhurried." },
  WHOLESALE: { label: "Wholesale buyer", blurb: "Meet the range, smell current batches and talk lead times, pricing and private label." },
  CORPORATE: { label: "Corporate group", blurb: "A visit for your team or clients, with gifting conversations if you wish." },
  PRESS: { label: "Press & creators", blurb: "Interviews, photography and a look behind the scenes. Tell us what you need." },
  OTHER: { label: "Something else", blurb: "Students, collaborators, the simply curious: write to us below." },
};

/** Purposes that ask for a company name. */
export const COMPANY_PURPOSES: readonly VisitPurpose[] = ["WHOLESALE", "CORPORATE"];

/** Statuses that hold places in a slot. */
export const HOLDING_STATUSES = ["REQUESTED", "CONFIRMED", "CHECKED_IN"] as const;

export const VISIT_STATUSES = ["REQUESTED", "CONFIRMED", "DECLINED", "CANCELLED", "CHECKED_IN", "COMPLETED", "NO_SHOW"] as const;
export type VisitStatusName = (typeof VISIT_STATUSES)[number];

export const STATUS_LABEL: Record<VisitStatusName, string> = {
  REQUESTED: "Requested",
  CONFIRMED: "Confirmed",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
  CHECKED_IN: "Checked in",
  COMPLETED: "Completed",
  NO_SHOW: "No-show",
};

export function statusTone(s: VisitStatusName): "gold" | "ember" | "muted" {
  if (s === "DECLINED" || s === "CANCELLED" || s === "NO_SHOW") return "ember";
  if (s === "COMPLETED") return "muted";
  return "gold";
}

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABEL: Record<Weekday, string> = { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" };

// ─────────────────────────────── Settings ───────────────────────────────

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");
const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const slotList = z
  .array(time)
  .max(24)
  .transform((a) => [...new Set(a)].sort());

export const DEFAULT_VISIT_SETTINGS = {
  timezone: "Asia/Kolkata",
  weekly: {
    sun: ["11:00", "14:00"],
    mon: [] as string[],
    tue: ["11:00", "14:00", "16:00"],
    wed: ["11:00", "14:00", "16:00"],
    thu: ["11:00", "14:00", "16:00"],
    fri: ["11:00", "14:00", "16:00"],
    sat: ["11:00", "14:00", "16:00"],
  },
  slotMinutes: 90,
  capacityPerSlot: 12,
  maxGroupSize: 8,
  leadDays: 2,
  horizonDays: 60,
  closedDates: [] as string[],
  address: "Maison Oud Atelier\nPlot 14, Kanauj Road, Industrial Area\nKannauj, Uttar Pradesh 209725, India",
  directions:
    "Two hours by road from Lucknow, or forty minutes from Kannauj railway station. Ask for the old attar distillery lane; our gate is the brass one on the left. Parking inside.",
  autoConfirm: { enabled: true, maxGroupSize: 4 },
};

export const visitSettingsSchema = z
  .object({
    timezone: z.string().refine(isValidTimeZone, "Unknown time zone").default(DEFAULT_VISIT_SETTINGS.timezone),
    weekly: z
      .object({ sun: slotList, mon: slotList, tue: slotList, wed: slotList, thu: slotList, fri: slotList, sat: slotList })
      .default(DEFAULT_VISIT_SETTINGS.weekly),
    slotMinutes: z.number().int().min(15).max(480).default(DEFAULT_VISIT_SETTINGS.slotMinutes),
    capacityPerSlot: z.number().int().min(1).max(500).default(DEFAULT_VISIT_SETTINGS.capacityPerSlot),
    maxGroupSize: z.number().int().min(1).max(500).default(DEFAULT_VISIT_SETTINGS.maxGroupSize),
    leadDays: z.number().int().min(0).max(90).default(DEFAULT_VISIT_SETTINGS.leadDays),
    horizonDays: z.number().int().min(1).max(365).default(DEFAULT_VISIT_SETTINGS.horizonDays),
    closedDates: z
      .array(dayStr)
      .max(400)
      .transform((a) => [...new Set(a)].sort())
      .default(DEFAULT_VISIT_SETTINGS.closedDates),
    address: z.string().trim().max(500).default(DEFAULT_VISIT_SETTINGS.address),
    directions: z.string().trim().max(2000).default(DEFAULT_VISIT_SETTINGS.directions),
    autoConfirm: z
      .object({ enabled: z.boolean(), maxGroupSize: z.number().int().min(1).max(500) })
      .default(DEFAULT_VISIT_SETTINGS.autoConfirm),
  })
  .superRefine((s, ctx) => {
    if (s.horizonDays < s.leadDays) ctx.addIssue({ code: "custom", path: ["horizonDays"], message: "Horizon must be at least the lead time" });
  });

export type VisitSettings = z.output<typeof visitSettingsSchema>;
export type VisitSettingsInput = z.input<typeof visitSettingsSchema>;

/** Stored JSON → settings; falls back to defaults if the row is missing or damaged. */
export function parseVisitSettings(value: unknown): VisitSettings {
  const parsed = visitSettingsSchema.safeParse(value && typeof value === "object" ? value : {});
  return parsed.success ? parsed.data : visitSettingsSchema.parse({});
}

// ─────────────────────────────── Calendar-day maths ───────────────────────────────
// A "day" is a YYYY-MM-DD string in the atelier's time zone. Arithmetic on it is done in UTC so it never drifts.

const pad = (n: number) => String(n).padStart(2, "0");

export function addDays(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayIndex(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

export const weekdayOf = (day: string): Weekday => WEEKDAYS[weekdayIndex(day)]!;

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    partsCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(date: Date, tz: string) {
  const parts = Object.fromEntries(partsFormatter(tz).formatToParts(date).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour!;
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}`, seconds: Number(parts.second) };
}

/** Offset (ms) of `tz` from UTC at the given instant. */
function offsetAt(date: Date, tz: string) {
  const p = zonedParts(date, tz);
  const [y, m, d] = p.day.split("-").map(Number);
  const [hh, mm] = p.time.split(":").map(Number);
  const asUtc = Date.UTC(y!, m! - 1, d!, hh!, mm!, p.seconds);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Wall-clock day + time in `tz` → the UTC instant. */
export function zonedToUtc(day: string, hhmm: string, tz: string) {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  let t = guess - offsetAt(new Date(guess), tz);
  // Second pass settles DST transitions (no-op for India).
  t = guess - offsetAt(new Date(t), tz);
  return new Date(t);
}

export const todayIn = (tz: string, now = new Date()) => zonedParts(now, tz).day;

// ─────────────────────────────── Slot rules ───────────────────────────────

/** Configured slot times for a day (empty when the day is closed or the weekday has none). */
export function slotsForDay(s: VisitSettings, day: string): string[] {
  if (s.closedDates.includes(day)) return [];
  return s.weekly[weekdayOf(day)] ?? [];
}

/** First and last bookable days (inclusive) as seen from `now`. */
export function bookableWindow(s: VisitSettings, now = new Date()) {
  const today = todayIn(s.timezone, now);
  return { first: addDays(today, s.leadDays), last: addDays(today, s.horizonDays) };
}

/** All days in the window that have at least one configured slot. */
export function bookableDays(s: VisitSettings, now = new Date()) {
  const { first, last } = bookableWindow(s, now);
  const out: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) if (slotsForDay(s, d).length) out.push(d);
  return out;
}

/**
 * Why a start time can't be booked by a visitor, or null when it can.
 * Checks the slot exists for that weekday, the day isn't closed, it's in the future, within lead time and horizon.
 */
export function slotProblem(s: VisitSettings, startsAt: Date, now = new Date()): string | null {
  if (Number.isNaN(startsAt.getTime())) return "That time isn’t valid.";
  if (startsAt.getTime() <= now.getTime()) return "That time has already passed.";
  const { day, time } = zonedParts(startsAt, s.timezone);
  if (s.closedDates.includes(day)) return "The atelier is closed that day.";
  if (!slotsForDay(s, day).includes(time)) return "That isn’t one of our visiting times.";
  const { first, last } = bookableWindow(s, now);
  if (day < first) return `Visits need booking at least ${s.leadDays} day${s.leadDays === 1 ? "" : "s"} ahead.`;
  if (day > last) return `We take bookings up to ${s.horizonDays} days ahead.`;
  return null;
}

/** Staff may move a visit to any configured slot that hasn't passed (lead time and horizon don't apply). */
export function staffSlotProblem(s: VisitSettings, startsAt: Date, now = new Date()): string | null {
  if (Number.isNaN(startsAt.getTime())) return "That time isn’t valid.";
  if (startsAt.getTime() <= now.getTime()) return "That time has already passed.";
  const { day, time } = zonedParts(startsAt, s.timezone);
  if (!slotsForDay(s, day).includes(time)) return "That isn’t one of the configured visiting times for that day.";
  return null;
}

/**
 * Start time recorded for a walk-in: the slot running right now (so the guest joins that group on the reception board),
 * else the current time floored to five minutes.
 */
export function walkInStart(s: VisitSettings, now = new Date()): Date {
  const day = todayIn(s.timezone, now);
  const running = slotsForDay(s, day)
    .map((t) => zonedToUtc(day, t, s.timezone))
    .filter((at) => at.getTime() <= now.getTime() && now.getTime() < at.getTime() + s.slotMinutes * 60_000)
    .pop();
  return running ?? new Date(Math.floor(now.getTime() / 300_000) * 300_000);
}

export const autoConfirms =(s: VisitSettings, groupSize: number) => s.autoConfirm.enabled && groupSize <= s.autoConfirm.maxGroupSize;

// ─────────────────────────────── Formatting ───────────────────────────────

export function fmtVisitDay(date: Date, tz: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
}

export function fmtVisitTime(date: Date, tz: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(date).toLowerCase();
}

/** "11:00" → "11:00 am" without involving a time zone. */
export function fmtClock(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h! >= 12 ? "pm" : "am";
  const h12 = h! % 12 === 0 ? 12 : h! % 12;
  return `${h12}:${pad(m!)} ${suffix}`;
}

/** "2026-10-09" → "Friday, 9 October" (pure calendar formatting). */
export function fmtDayLabel(day: string, opts: { year?: boolean; weekday?: "long" | "short" } = {}) {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: opts.weekday ?? "long", day: "numeric", month: "long", ...(opts.year ? { year: "numeric" } : {}) }).format(
    new Date(Date.UTC(y!, m! - 1, d!)),
  );
}

export const purposeLabel = (p: string) => PURPOSE_INFO[p as VisitPurpose]?.label ?? p;
export const statusLabel = (s: string) => STATUS_LABEL[s as VisitStatusName] ?? s;

// ─────────────────────────────── Availability shape (server → client) ───────────────────────────────

export type SlotAvailability = { time: string; startsAt: string; remaining: number };
export type DayAvailability = { day: string; slots: SlotAvailability[] };
