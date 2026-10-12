/**
 * Locale-aware twins of the visit formatters in src/server/visit-schedule.ts (which stay English for emails, admin
 * and tests). Client-safe; pass the active `Intl` tag from `useIntlLocale()` / `getIntlLocale()`.
 */

const utcDate = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};

/** "2026-10-09" → "Friday, 9 October" in the given locale (pure calendar formatting). */
export function fmtDayLabelIn(intl: string, day: string, opts: { year?: boolean; weekday?: "long" | "short" } = {}) {
  return new Intl.DateTimeFormat(intl, { timeZone: "UTC", weekday: opts.weekday ?? "long", day: "numeric", month: "long", ...(opts.year ? { year: "numeric" } : {}) }).format(
    utcDate(day),
  );
}

/** "11:00" → "11:00 am" (or the locale's own clock) without involving a time zone. */
export function fmtClockIn(intl: string, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Intl.DateTimeFormat(intl, { timeZone: "UTC", hour: "numeric", minute: "2-digit" }).format(new Date(Date.UTC(2000, 0, 1, h!, m!)));
}

/** "2026-10" → "October 2026". */
export function fmtMonthIn(intl: string, month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(intl, { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(y!, m! - 1, 1)));
}

/** Monday-first weekday names (narrow, short, long) × 7. */
export function weekdayNamesIn(intl: string) {
  const narrow = new Intl.DateTimeFormat(intl, { timeZone: "UTC", weekday: "narrow" });
  const short = new Intl.DateTimeFormat(intl, { timeZone: "UTC", weekday: "short" });
  const long = new Intl.DateTimeFormat(intl, { timeZone: "UTC", weekday: "long" });
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.UTC(2024, 0, 1 + i));
    return { narrow: narrow.format(d), short: short.format(d), long: long.format(d) };
  });
}

/** A visit's day in the atelier's time zone, e.g. "Friday, 9 October 2026". */
export function fmtVisitDayIn(intl: string, date: Date, tz: string) {
  return new Intl.DateTimeFormat(intl, { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
}

/** A visit's start time in the atelier's time zone, e.g. "11:00 am". */
export function fmtVisitTimeIn(intl: string, date: Date, tz: string) {
  return new Intl.DateTimeFormat(intl, { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(date);
}
