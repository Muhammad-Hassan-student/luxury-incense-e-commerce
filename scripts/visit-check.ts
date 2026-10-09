// Atelier visit checks against the local database: availability maths, capacity under concurrency, auto-confirm,
// self-service reschedule/cancel, reference numbering, reminders and reception transitions.
// Everything happens in January 2030 (no real bookings there) with test emails @visit-check.test; the "visits" and
// "visitReminders" Setting rows are restored afterwards. Emails are only logged (Resend is disabled for this run).
// Run: npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/visit-check.ts
import "dotenv/config";

// Never send real mail from a test run. Must happen before the email module reads the environment.
process.env.RESEND_API_KEY = "";
// Never send real mail from tests (SMTP takes precedence over Resend when configured).
process.env.SMTP_USER = "";
process.env.SMTP_PASSWORD = "";
process.env.EMAIL_TRANSPORT = "log";

const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};

const DOMAIN = "@visit-check.test";
const IST = "Asia/Kolkata";

async function main() {
  const { db } = await import("@/server/db");
  const V = await import("@/server/visits");
  const S = await import("@/server/visit-schedule");
  const { VisitError } = V;

  async function rejects(p: Promise<unknown>, msg: string, match?: RegExp) {
    try {
      await p;
      ok(false, `${msg} (did not throw)`);
    } catch (e) {
      const good = e instanceof VisitError && (!match || match.test(e.message));
      ok(good, `${msg}${good ? ` — “${(e as Error).message}”` : ` (threw ${(e as Error).message})`}`);
    }
  }

  const settingsBefore = await db.setting.findUnique({ where: { key: V.VISIT_SETTINGS_KEY } });
  const remindersBefore = await db.setting.findUnique({ where: { key: V.VISIT_REMINDERS_KEY } });
  const visitsBefore = await db.visit.count();

  try {
    // Tue 1 Jan 2030, 09:30 in India.
    const now = new Date("2030-01-01T04:00:00Z");
    const settings = await V.saveVisitSettings({
      timezone: IST,
      weekly: { sun: [], mon: [], tue: ["11:00", "14:00"], wed: [], thu: ["14:00", "11:00", "11:00"], fri: [], sat: [] },
      slotMinutes: 75,
      capacityPerSlot: 6,
      maxGroupSize: 6,
      leadDays: 2,
      horizonDays: 30,
      closedDates: ["2030-01-10"],
      address: "Test atelier",
      directions: "Test directions",
      autoConfirm: { enabled: true, maxGroupSize: 2 },
    });

    // ── Settings parsing ──
    ok(settings.weekly.thu.join() === "11:00,14:00", "slot lists are de-duplicated and sorted");
    const fallback = S.parseVisitSettings({ capacityPerSlot: -3 });
    ok(fallback.capacityPerSlot === S.DEFAULT_VISIT_SETTINGS.capacityPerSlot && fallback.timezone === IST, "damaged settings fall back to defaults");
    ok(S.parseVisitSettings(undefined).weekly.mon.length === 0 && S.parseVisitSettings(undefined).leadDays === 2, "missing settings use defaults");
    ok(!S.visitSettingsSchema.safeParse({ weekly: { ...settings.weekly, tue: ["25:00"] } }).success, "invalid slot times are rejected");
    ok(!S.visitSettingsSchema.safeParse({ timezone: "Mars/Olympus" }).success, "unknown time zones are rejected");

    // ── Time zone maths (India, UTC+05:30) ──
    ok(S.zonedToUtc("2030-01-03", "11:00", IST).toISOString() === "2030-01-03T05:30:00.000Z", "11:00 IST is 05:30 UTC");
    ok(S.zonedToUtc("2030-01-03", "00:00", IST).toISOString() === "2030-01-02T18:30:00.000Z", "IST midnight is 18:30 UTC the day before");
    const late = S.zonedParts(new Date("2030-01-02T19:00:00Z"), IST);
    ok(late.day === "2030-01-03" && late.time === "00:30", `19:00 UTC is already the next day in India (${late.day} ${late.time})`);
    ok(S.weekdayOf("2030-01-01") === "tue" && S.weekdayOf("2030-01-06") === "sun", "weekday of a calendar day");
    ok(S.addDays("2030-01-31", 1) === "2030-02-01" && S.addDays("2030-03-01", -1) === "2030-02-28", "calendar day arithmetic across months");

    // ── Availability window ──
    const w = S.bookableWindow(settings, now);
    ok(w.first === "2030-01-03" && w.last === "2030-01-31", `window from lead time to horizon (${w.first} → ${w.last})`);
    const days = S.bookableDays(settings, now);
    ok(days.join() === "2030-01-03,2030-01-08,2030-01-15,2030-01-17,2030-01-22,2030-01-24,2030-01-29,2030-01-31", `only Tue/Thu, closed 10 Jan skipped (${days.length} days)`);
    // Just after midnight in India it is already Wednesday, so the window moves even though UTC still says Tuesday.
    const lateNow = new Date("2030-01-01T19:00:00Z");
    ok(S.bookableWindow(settings, lateNow).first === "2030-01-04", "lead time counts India calendar days, not UTC");
    const at = (day: string, t: string) => S.zonedToUtc(day, t, IST);
    ok(S.slotProblem(settings, at("2030-01-03", "11:00"), now) === null, "Thu 3 Jan 11:00 is bookable");
    ok(/ahead/.test(S.slotProblem(settings, at("2030-01-03", "11:00"), lateNow) ?? ""), "…but not once India has rolled into the 2nd (lead time)");
    ok(/ahead/.test(S.slotProblem(settings, at("2030-01-01", "14:00"), now) ?? ""), "same-day slot rejected by lead time");
    ok(/visiting times/.test(S.slotProblem(settings, at("2030-01-03", "12:00"), now) ?? ""), "a time that isn’t a slot is rejected");
    ok(/visiting times/.test(S.slotProblem(settings, at("2030-01-07", "11:00"), now) ?? ""), "a weekday with no slots is rejected");
    ok(/closed/.test(S.slotProblem(settings, at("2030-01-10", "11:00"), now) ?? ""), "closed date rejected");
    ok(/up to 30 days/.test(S.slotProblem(settings, at("2030-02-05", "11:00"), now) ?? ""), "beyond the horizon rejected");
    ok(/passed/.test(S.slotProblem(settings, at("2030-01-03", "11:00"), new Date("2030-01-04T00:00:00Z")) ?? ""), "past slot rejected");
    ok(/visiting times/.test(S.slotProblem(settings, new Date("2030-01-03T11:00:00Z"), now) ?? ""), "11:00 UTC is not mistaken for the 11:00 IST slot");

    // ── Auto-confirm threshold & booking ──
    const slotA = at("2030-01-03", "11:00");
    const slotB = at("2030-01-03", "14:00");
    const base = { purpose: "TOUR" as const, phone: "+91 98765 43210", name: "Test Visitor" };
    const book = (email: string, groupSize: number, startsAt = slotA, extra: Partial<Parameters<typeof V.createVisit>[0]> = {}) =>
      V.createVisit({ ...base, email: `${email}${DOMAIN}`, groupSize, startsAt, ...extra }, { now });

    const small = (await book("small", 2)).visit;
    ok(small.status === "CONFIRMED", `party of 2 (≤ threshold) is auto-confirmed (${small.status})`);
    const big = (await book("big", 3)).visit;
    ok(big.status === "REQUESTED", `party of 3 (> threshold) is requested (${big.status})`);
    ok(small.durationMins === 75 && small.token.length >= 20 && small.email === `small${DOMAIN}`, "duration from settings, long token, email normalised");

    await rejects(book("toolarge", 7, slotB), "group above the maximum is rejected", /up to 6/);
    await rejects(book("trade", 2, slotB, { purpose: "WHOLESALE", company: "" }), "wholesale booking needs a company", /company/);
    await rejects(book("small", 1), "duplicate pending booking for the same email and slot is rejected", /already/);
    await rejects(book("SMALL", 1), "…case-insensitively", /already/);

    // ── Capacity: 5 of 6 taken; two people race for the last place ──
    const race = await Promise.allSettled([book("race1", 1), book("race2", 1)]);
    const won = race.filter((r) => r.status === "fulfilled");
    const lost = race.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    ok(won.length === 1 && lost.length === 1 && lost[0]!.reason instanceof VisitError, `only one of two concurrent bookings for the last place succeeds (${won.length} won)`);
    ok((await V.placesTaken(db, slotA)) === 6, "slot is exactly at capacity");
    await rejects(book("after", 1), "a full slot rejects further bookings", /filled|left/);
    const avail = await V.getAvailability({ now });
    const day3 = avail.find((d) => d.day === "2030-01-03");
    ok(day3?.slots.find((s) => s.time === "11:00")?.remaining === 0 && day3?.slots.find((s) => s.time === "14:00")?.remaining === 6, "availability shows 0 left at 11:00, 6 at 14:00");
    ok(avail.length === 8 && !avail.some((d) => d.day === "2030-01-10"), "availability lists only bookable days");

    // Partial fit: a group larger than what's left is refused with the count.
    await book("b1", 2, slotB);
    await book("b2", 3, slotB);
    await rejects(book("b3", 2, slotB), "a group larger than the remaining places is refused", /Only 1 place left/);

    // ── Reference numbers: unique and consecutive under concurrency ──
    const tuesdays = ["2030-01-08", "2030-01-15", "2030-01-22", "2030-01-29"];
    const many = await Promise.all(
      tuesdays.flatMap((d, i) => ["11:00", "14:00"].map((t, j) => book(`ref${i}${j}`, 1, at(d, t)).then((r) => r.visit.reference))),
    );
    const all = await db.visit.findMany({ where: { email: { endsWith: DOMAIN } }, select: { reference: true } });
    const seqs = all.map((v) => Number(v.reference.slice(5))).sort((a, b) => a - b);
    ok(many.every((r) => /^V-30-\d{4}$/.test(r)), `references look like V-30-0001 (${many[0]})`);
    ok(new Set(seqs).size === seqs.length && seqs[seqs.length - 1]! - seqs[0]! + 1 === seqs.length, `${seqs.length} references unique and consecutive (${seqs[0]}–${seqs[seqs.length - 1]})`);

    // ── Self-service by token ──
    ok((await V.getVisitByToken("nope-not-a-real-token")) === null && (await V.getVisitByToken("../../etc")) === null, "unknown or malformed tokens find nothing");
    const viaToken = await V.getVisitByToken(big.token);
    ok(viaToken?.id === big.id, "token resolves the visit");
    const slotC = at("2030-01-08", "11:00"); // one place taken by a ref booking
    await rejects(V.rescheduleVisit(big.id, slotB, { by: "visitor", now }), "can’t reschedule into a slot without room", /left|full/);
    await rejects(V.rescheduleVisit(big.id, at("2030-01-10", "11:00"), { by: "visitor", now }), "can’t reschedule onto a closed day", /closed/);
    // Staff confirm it first; a visitor move must send a party above the threshold back to REQUESTED.
    await V.transitionVisit(big.id, "CONFIRMED");
    const moved = await V.rescheduleVisit(big.id, slotC, { by: "visitor", now });
    ok(moved.after.status === "REQUESTED" && moved.after.startsAt.getTime() === slotC.getTime(), `visitor reschedule of a party of 3 → REQUESTED at the new time (${moved.after.status})`);
    ok((await V.placesTaken(db, slotA)) === 3 && (await V.placesTaken(db, slotC)) === 4, "places released from the old slot and taken in the new");
    const movedSmall = await V.rescheduleVisit(small.id, at("2030-01-15", "11:00"), { by: "visitor", now });
    ok(movedSmall.after.status === "CONFIRMED", "visitor reschedule of a party of 2 stays confirmed (auto-confirm)");
    const staffMove = await V.rescheduleVisit(big.id, at("2030-01-01", "14:00"), { by: "staff", now });
    ok(staffMove.after.status === "CONFIRMED", "staff may move inside the lead time; visit becomes confirmed");
    await rejects(V.rescheduleVisit(big.id, slotB, { by: "staff", now }), "staff can’t move a party of 3 into a slot with 1 place without override", /Only 1 place/);
    const forced = await V.rescheduleVisit(big.id, slotB, { by: "staff", override: true, now });
    ok(forced.after.startsAt.getTime() === slotB.getTime() && (await V.placesTaken(db, slotB)) === 8, "staff override books over capacity deliberately");

    const cancelled = await V.cancelByVisitor(movedSmall.after.id, now);
    ok(cancelled.status === "CANCELLED", "visitor can cancel by token");
    await rejects(V.cancelByVisitor(cancelled.id, now), "cancelling twice is refused", /cancelled/);
    await rejects(V.rescheduleVisit(cancelled.id, slotB, { by: "visitor", now }), "a cancelled visit can’t be rescheduled", /cancelled/);
    await rejects(V.cancelByVisitor(big.id, new Date("2030-01-04T00:00:00Z")), "a visit that has passed can’t be cancelled online", /already/);

    // ── Reminders: 20–28h ahead, once only ──
    const reminderNow = new Date(slotA.getTime() - 22 * 3600_000);
    const confirmedInWindow = await db.visit.count({ where: { status: "CONFIRMED", startsAt: { gte: new Date(reminderNow.getTime() + 20 * 3600_000), lte: new Date(reminderNow.getTime() + 28 * 3600_000) } } });
    const r1 = await V.sendVisitReminders(reminderNow);
    const r2 = await V.sendVisitReminders(new Date(reminderNow.getTime() + 3600_000));
    ok(confirmedInWindow > 0 && r1.sent === confirmedInWindow, `reminders sent to ${r1.sent} confirmed visitor(s) 22h ahead`);
    ok(r2.sent === 0, "the next hourly run sends none again");
    const tooEarly = await V.sendVisitReminders(new Date(slotA.getTime() - 40 * 3600_000));
    ok(tooEarly.due === 0, "nothing is due 40h ahead");
    const marker = await db.setting.findUnique({ where: { key: V.VISIT_REMINDERS_KEY } });
    const sent = (marker?.value as { sent?: unknown[] } | null)?.sent ?? [];
    ok(Array.isArray(sent) && sent.length >= r1.sent && sent.length <= 500, `sent ids stored in Setting "visitReminders" (${sent.length})`);
    const both = await Promise.all([V.sendVisitReminders(reminderNow), V.sendVisitReminders(reminderNow)]);
    ok(both.every((r) => r.sent === 0), "overlapping runs don’t re-send");

    // ── Reception transitions ──
    const guest = (await book("guest", 1, at("2030-01-17", "11:00"))).visit; // CONFIRMED
    const t1 = await V.transitionVisit(guest.id, "CHECKED_IN", now);
    ok(t1.after.status === "CHECKED_IN" && t1.after.checkedInAt?.getTime() === now.getTime(), "check in sets CHECKED_IN and checkedInAt");
    const undo = await V.transitionVisit(guest.id, "CONFIRMED");
    ok(undo.after.status === "CONFIRMED" && undo.after.checkedInAt === null, "undo check-in clears checkedInAt");
    const race2 = await Promise.allSettled([V.transitionVisit(guest.id, "CHECKED_IN"), V.transitionVisit(guest.id, "CHECKED_IN")]);
    ok(race2.filter((r) => r.status === "fulfilled").length === 1, "two desks checking in at once: one wins");
    await rejects(V.transitionVisit(guest.id, "DECLINED"), "can’t decline a checked-in visit");
    ok((await V.transitionVisit(guest.id, "COMPLETED")).after.status === "COMPLETED", "checked in → completed");
    await rejects(V.transitionVisit(guest.id, "CHECKED_IN"), "completed can’t be checked in again");
    const req = (await book("req", 4, at("2030-01-17", "14:00"))).visit;
    await rejects(V.transitionVisit(req.id, "COMPLETED"), "requested can’t jump to completed");
    ok((await V.transitionVisit(req.id, "NO_SHOW")).after.status === "NO_SHOW", "requested → no-show");
    ok((await V.transitionVisit(req.id, "CHECKED_IN")).after.status === "CHECKED_IN", "no-show → checked in (arrived late)");
    ok(V.nextVisitStatuses("REQUESTED").sort().join() === "CANCELLED,CHECKED_IN,CONFIRMED,DECLINED,NO_SHOW", "allowed moves from REQUESTED");

    // ── Emails render ──
    // (react-dom/server isn’t available under the react-server condition, so check the element and its data.)
    const { isValidElement } = await import("react");
    const { VisitEmail, visitEmailSubject } = await import("@/emails/visit-email");
    const pass = V.passFor(small, settings);
    ok(isValidElement(VisitEmail({ kind: "confirmed", pass, reason: null })) && pass.time === "11:00 am" && /Thursday, 3 January 2030/.test(pass.day), `email pass shows India time (${pass.day}, ${pass.time})`);
    ok(visitEmailSubject("confirmed", small.reference).includes(small.reference), "email subject carries the reference");
  } catch (e) {
    console.error("FAIL  unexpected error:", e);
    process.exitCode = 1;
  } finally {
    await db.visit.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    if (settingsBefore) await db.setting.update({ where: { key: V.VISIT_SETTINGS_KEY }, data: { value: settingsBefore.value ?? {} } });
    else await db.setting.deleteMany({ where: { key: V.VISIT_SETTINGS_KEY } });
    if (remindersBefore) await db.setting.update({ where: { key: V.VISIT_REMINDERS_KEY }, data: { value: remindersBefore.value ?? {} } });
    else await db.setting.deleteMany({ where: { key: V.VISIT_REMINDERS_KEY } });
    ok((await db.visit.count()) === visitsBefore, "test visits removed; settings restored");
    console.log("cleaned up");
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
