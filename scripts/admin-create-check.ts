// Staff-created records and dashboard data checks against the local database:
//  • trade accounts opened by staff (new + existing login, duplicate, staff email, permission, credit cap, validation);
//  • visits booked by staff (capacity, override + audit, lead time waived, pass email) and reception walk-ins;
//  • dashboard helpers (goal projection maths, store-time boundaries, heatmap bucketing in the store time zone,
//    today-vs-yesterday pulse, top movers, attention counts and their permission filtering).
// Creates its own data (emails @admin-check.test, orders ADMCHK-*, visits in January 2030, orders in March 2031),
// restores the "visits" and "dashboard" Setting rows, deletes everything it made and confirms real data is unchanged.
// Run: npm run test:admin
import "dotenv/config";

// Never send real mail from a test run. Must happen before the email module reads the environment.
process.env.RESEND_API_KEY = "";
// Never send real mail from tests (SMTP takes precedence over Resend when configured).
process.env.SMTP_USER = "";
process.env.SMTP_PASSWORD = "";

export {};

const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};

const DOMAIN = "@admin-check.test";
const ORDER_PREFIX = "ADMCHK-";
const IST = "Asia/Kolkata";

async function main() {
  const { db } = await import("@/server/db");
  const SC = await import("@/server/staff-create");
  const V = await import("@/server/visits");
  const S = await import("@/server/visit-schedule");
  const D = await import("@/server/dashboard");
  const L = await import("@/lib/dashboard");
  const { ALL_PERMISSIONS } = await import("@/lib/permissions");
  const { TradeError } = await import("@/server/trade");

  async function throws(fn: () => Promise<unknown>, check: (e: unknown) => boolean, msg: string) {
    try {
      await fn();
      ok(false, `${msg} (did not throw)`);
    } catch (e) {
      ok(check(e), `${msg} — “${(e as Error).message}”`);
    }
  }

  // Capture dev-mode email logs (sendEmail logs instead of sending when no Resend key).
  const mail: string[] = [];
  const info = console.info;
  console.info = (...args: unknown[]) => {
    mail.push(args.map(String).join(" "));
  };

  // Only what this script can touch: other checks may be writing to the same database concurrently.
  const snapshot = async () => ({
    users: await db.user.count({ where: { email: { endsWith: DOMAIN } } }),
    accounts: await db.tradeAccount.count({ where: { user: { email: { endsWith: DOMAIN } } } }),
    visits: await db.visit.count({ where: { OR: [{ email: { endsWith: DOMAIN } }, { name: "Gate Guest" }, { reference: "V-99-9999" }] } }),
    orders: await db.order.count({ where: { number: { startsWith: ORDER_PREFIX } } }),
    audit: await db.auditLog.count({ where: { actor: { email: { endsWith: DOMAIN } } } }),
    settings: (await db.setting.findMany({ where: { key: { in: ["visits", "dashboard", "visitReminders"] } }, orderBy: { key: "asc" } })).map((s) => `${s.key}:${JSON.stringify(s.value)}`).join("|"),
  });
  const before = await snapshot();
  const visitSettingsRow = await db.setting.findUnique({ where: { key: V.VISIT_SETTINGS_KEY } });
  const dashRow = await db.setting.findUnique({ where: { key: D.DASHBOARD_SETTINGS_KEY } });

  const owner = await db.user.create({ data: { email: `owner${DOMAIN}`, role: "OWNER", name: "Check Owner" } });
  const staff = await db.user.create({ data: { email: `support${DOMAIN}`, role: "SUPPORT", name: "Check Support" } });
  const customer = await db.user.create({ data: { email: `existing${DOMAIN}`, role: "CUSTOMER" } });
  const actor = { id: owner.id, permissions: ALL_PERMISSIONS };
  const noTrade = { id: owner.id, permissions: ALL_PERMISSIONS.filter((p) => p !== "trade.manage") };
  const noVisits = { id: owner.id, permissions: ALL_PERMISSIONS.filter((p) => p !== "visits.manage") };

  try {
    // ───────────── Trade accounts ─────────────
    const application = {
      businessName: "Check Boutique",
      businessType: "RETAILER",
      contactName: "Asha Check",
      phone: "+91 98111 22222",
      taxId: "07aaaaa0000a1z5",
      website: "checkboutique.example",
      line1: "12 Khan Market",
      line2: "",
      city: "New Delhi",
      state: "Delhi",
      postalCode: "110003",
      country: "in",
      expectedMonthly: "₹50,000 – ₹2 lakh a month",
      message: "",
    } as const;
    const base = { application, status: "APPROVED" as const, tierId: null, terms: "NET_30" as const, creditLimit: 250_000, minOrderValue: 0, staffNotes: "Met at the atelier" };

    mail.length = 0;
    const created = await SC.staffCreateTradeAccount(actor, { ...base, email: `New.Buyer${DOMAIN}` });
    const newUser = await db.user.findUniqueOrThrow({ where: { id: created.account.userId } });
    ok(created.newUser && newUser.email === `new.buyer${DOMAIN}` && newUser.role === "CUSTOMER" && newUser.name === "Asha Check", "new email creates a lower-cased CUSTOMER login");
    ok(created.account.status === "APPROVED" && created.account.reviewedById === owner.id && created.account.reviewedAt != null, "account is created APPROVED and marked reviewed by the staff member");
    ok(created.account.creditLimit === 25_000_000 && created.account.terms === "NET_30" && created.account.taxId === "07AAAAA0000A1Z5", "credit limit stored in minor units; tax ID normalised by the shared schema");
    ok(created.account.website === "https://checkboutique.example" && (created.account.address as { country: string }).country === "IN", "website and country normalised like the public application");
    const createAudit = await db.auditLog.findFirst({ where: { actorId: owner.id, action: "trade.create", entityId: created.account.id } });
    ok(Boolean(createAudit) && (createAudit?.meta as { newUser?: boolean })?.newUser === true, "trade.create is audit-logged with newUser");
    ok(mail.some((m) => m.includes(`to=new.buyer${DOMAIN}`) && m.includes("Welcome to Maison Oud Trade")), "buyer gets the welcome email");

    const linked = await SC.staffCreateTradeAccount(actor, { ...base, application: { ...application, businessName: "Existing Co" }, email: `EXISTING${DOMAIN}`, status: "PENDING", terms: "PREPAID", creditLimit: 0 });
    ok(!linked.newUser && linked.account.userId === customer.id && linked.account.status === "PENDING" && linked.account.reviewedById === null, "existing customer is linked (case-insensitive); PENDING stays unreviewed");
    ok(linked.account.creditLimit === 0, "prepaid accounts get no credit");

    await throws(
      () => SC.staffCreateTradeAccount(actor, { ...base, email: `existing${DOMAIN}` }),
      (e) => e instanceof SC.ExistingTradeAccountError && e.accountId === linked.account.id,
      "duplicate account for the same login is refused with a link to it",
    );
    await throws(() => SC.staffCreateTradeAccount(actor, { ...base, email: staff.email }), (e) => e instanceof TradeError && /staff/.test((e as Error).message), "staff emails are refused");
    await throws(() => SC.staffCreateTradeAccount(noTrade, { ...base, email: `nope${DOMAIN}` }), (e) => e instanceof SC.StaffPermissionError, "refused without trade.manage");
    await throws(
      () => SC.staffCreateTradeAccount(actor, { ...base, email: `rich${DOMAIN}`, creditLimit: 50_000_000 }),
      (e) => e instanceof SC.StaffInputError && Boolean(e.fieldErrors.creditLimit),
      "credit limit above the staff cap is refused",
    );
    await throws(
      () => SC.staffCreateTradeAccount(actor, { ...base, email: `nocredit${DOMAIN}`, creditLimit: 0 }),
      (e) => e instanceof SC.StaffInputError && Boolean(e.fieldErrors.creditLimit),
      "credit terms without a limit are refused",
    );
    await throws(
      () => SC.staffCreateTradeAccount(actor, { ...base, email: `notax${DOMAIN}`, application: { ...application, taxId: "" } }),
      (e) => e instanceof SC.StaffInputError && Boolean(e.fieldErrors["application.taxId"]),
      "application rules are shared (resellers need a tax ID)",
    );
    await throws(() => SC.staffCreateTradeAccount(actor, { ...base, email: "not-an-email" }), (e) => e instanceof SC.StaffInputError && Boolean(e.fieldErrors.email), "login email is validated");
    ok((await db.user.count({ where: { email: { in: [`nope${DOMAIN}`, `rich${DOMAIN}`, `nocredit${DOMAIN}`, `notax${DOMAIN}`] } } })) === 0, "refused requests create no logins");

    // ───────────── Visits ─────────────
    // Tue 1 Jan 2030, 09:30 in India. Lead time 2 days would stop a visitor booking today; staff may.
    const now = new Date("2030-01-01T04:00:00Z");
    await V.saveVisitSettings({
      timezone: IST,
      weekly: { sun: [], mon: [], tue: ["11:00", "14:00"], wed: [], thu: ["11:00", "14:00"], fri: [], sat: [] },
      slotMinutes: 75,
      capacityPerSlot: 4,
      maxGroupSize: 3,
      leadDays: 2,
      horizonDays: 30,
      closedDates: [],
      address: "Test atelier",
      directions: "Test directions",
      autoConfirm: { enabled: false, maxGroupSize: 1 },
    });
    const slot = S.zonedToUtc("2030-01-01", "14:00", IST);
    const v = { purpose: "TOUR" as const, phone: "+91 98765 43210", name: "Staff Booked" };

    mail.length = 0;
    const a = await SC.staffCreateVisit(actor, { ...v, email: `visit-a${DOMAIN}`, groupSize: 3, startsAt: slot.toISOString() }, { now });
    ok(a.visit.status === "CONFIRMED" && !a.overCapacity, `staff booking is CONFIRMED immediately even with auto-confirm off (${a.visit.status})`);
    ok(S.slotProblem((await V.getVisitSettings()), slot, now) !== null, "…for a same-day slot a visitor could not book (lead time waived for staff)");
    ok(mail.some((m) => m.includes(`to=visit-a${DOMAIN}`) && m.includes(a.visit.reference) && m.includes("confirmed") && m.includes(`/visit/${a.visit.token}`)), "visitor pass email sent with the manage link");
    ok(Boolean(await db.auditLog.findFirst({ where: { actorId: owner.id, action: "visit.create", entityId: a.visit.id } })), "visit.create is audit-logged");

    await throws(
      () => SC.staffCreateVisit(actor, { ...v, email: `visit-b${DOMAIN}`, groupSize: 2, startsAt: slot.toISOString() }, { now }),
      (e) => e instanceof V.VisitError && /Only 1 place/.test((e as Error).message),
      "capacity is respected (1 left, party of 2)",
    );
    const b = await SC.staffCreateVisit(actor, { ...v, email: `visit-b${DOMAIN}`, groupSize: 2, startsAt: slot.toISOString(), override: true }, { now });
    ok(b.overCapacity && (await V.placesTaken(db, slot)) === 5, "override books over capacity (5 / 4)");
    const ov = await db.auditLog.findFirst({ where: { actorId: owner.id, action: "visit.capacity_override", entityId: b.visit.id } });
    ok((ov?.meta as { remainingBefore?: number })?.remainingBefore === 1, "capacity override is audit-logged with the places that were left");
    const big = await SC.staffCreateVisit(actor, { ...v, email: `visit-c${DOMAIN}`, groupSize: 4, startsAt: S.zonedToUtc("2030-01-03", "11:00", IST).toISOString() }, { now });
    ok(big.visit.groupSize === 4, "staff may book a party above the visitor maximum when capacity allows");
    await throws(
      () => SC.staffCreateVisit(actor, { ...v, email: `visit-d${DOMAIN}`, groupSize: 1, startsAt: S.zonedToUtc("2030-01-01", "12:00", IST).toISOString() }, { now }),
      (e) => e instanceof V.VisitError,
      "only configured slots can be booked",
    );
    await throws(
      () => SC.staffCreateVisit(actor, { ...v, purpose: "WHOLESALE", email: `visit-e${DOMAIN}`, groupSize: 1, startsAt: S.zonedToUtc("2030-01-03", "14:00", IST).toISOString() }, { now }),
      (e) => e instanceof V.VisitError && /company/.test((e as Error).message),
      "wholesale bookings still need a company",
    );
    await throws(() => SC.staffCreateVisit(noVisits, { ...v, email: `visit-f${DOMAIN}`, groupSize: 1, startsAt: slot.toISOString() }, { now }), (e) => e instanceof SC.StaffPermissionError, "refused without visits.manage");
    await throws(() => SC.staffCreateVisit(actor, { ...v, email: "bad", groupSize: 0, startsAt: "soon" }, { now }), (e) => e instanceof SC.StaffInputError, "visit input is zod-validated");

    // Walk-in at Thu 3 Jan 11:30 IST: joins the running 11:00 slot (already holding 4 of 4) and is checked in.
    const walkNow = new Date("2030-01-03T06:00:00Z");
    const s2 = await V.getVisitSettings();
    ok(S.walkInStart(s2, walkNow).toISOString() === S.zonedToUtc("2030-01-03", "11:00", IST).toISOString(), "walk-in is recorded against the slot running now");
    ok(S.walkInStart(s2, new Date("2030-01-03T10:03:00Z")).toISOString() === "2030-01-03T10:00:00.000Z", "outside a slot, walk-in time is floored to five minutes");
    mail.length = 0;
    const w = await SC.staffWalkIn(actor, { name: "Gate Guest", groupSize: 2 }, { now: walkNow });
    ok(w.visit.status === "CHECKED_IN" && w.visit.checkedInAt?.getTime() === walkNow.getTime() && w.overCapacity, "walk-in is checked in now and admitted even when the slot is full");
    ok(mail.length === 0 && w.visit.email === "" && w.visit.staffNotes === "Walk-in", "walk-ins without an email get no mail and are noted");
    ok(Boolean(await db.auditLog.findFirst({ where: { actorId: owner.id, action: "visit.walk_in", entityId: w.visit.id } })), "walk-in is audit-logged");

    // ───────────── Dashboard helpers ─────────────
    const oct = { monthStart: S.zonedToUtc("2026-10-01", "00:00", IST), monthEnd: S.zonedToUtc("2026-11-01", "00:00", IST) };
    const mid = new Date(oct.monthStart.getTime() + 15.5 * 86_400_000);
    const g = L.goalProjection({ revenue: 500_000, target: 2_000_000, now: mid, ...oct });
    ok(g.daysInMonth === 31 && Math.abs(g.elapsed - 0.5) < 1e-9 && g.projected === 1_000_000, `half-way through a 31-day month, ₹5,000 projects to ₹10,000 (${g.projected})`);
    ok(g.progress === 0.25 && g.projectedProgress === 0.5 && !g.onTrack, "progress 25%, projected 50% — behind pace");
    ok(g.daysLeft === 15 && g.neededPerDay === Math.ceil(1_500_000 / 16), `15 days left after today; needed per day over the remaining 16 (${g.neededPerDay})`);
    const ahead = L.goalProjection({ revenue: 1_200_000, target: 2_000_000, now: mid, ...oct });
    ok(ahead.onTrack && ahead.projected === 2_400_000, "ahead of pace is on track");
    const none = L.goalProjection({ revenue: 300, target: 0, now: mid, ...oct });
    ok(none.progress === 0 && !none.onTrack && none.neededPerDay === 0, "no target → no progress, never on track");
    const early = L.goalProjection({ revenue: 999, target: 10_000, now: new Date(oct.monthStart.getTime() + 60_000), ...oct });
    ok(early.projected === 999, "first minutes of the month don't extrapolate wildly");
    const clock = D.storeClock(IST, new Date("2026-10-31T20:00:00Z"));
    ok(clock.today === "2026-11-01" && clock.monthFirst === "2026-11-01" && clock.todayStart.toISOString() === "2026-10-31T18:30:00.000Z", "store clock rolls into November at IST midnight (UTC still October)");
    ok(clock.monthEnd.toISOString() === "2026-11-30T18:30:00.000Z", "month end is IST midnight on 1 December");
    ok(L.relativeTime(new Date(Date.now() - 4 * 60_000)) === "4 min ago" && L.relativeTime(new Date(Date.now() - 3 * 3600_000)) === "3 h ago", "relative times");
    ok(D.parseDashboardSettings({ monthlyTarget: -5 }).monthlyTarget === 0, "damaged dashboard settings fall back to no goal");
    await D.saveDashboardSettings({ monthlyTarget: 12_345_600 });
    ok((await D.getDashboardSettings()).monthlyTarget === 12_345_600, "monthly goal round-trips through the Setting table");

    // Orders in March 2031 (nothing real there). Wed 5 Mar 2031 01:30 IST = Tue 4 Mar 20:00 UTC.
    let seq = 0;
    const order = (placedAt: string, total: number, extra: Record<string, unknown> = {}, items: { sku: string; unitPrice: number; quantity: number }[] = []) =>
      db.order.create({
        data: {
          number: `${ORDER_PREFIX}${++seq}`,
          email: `buyer${DOMAIN}`,
          currency: "INR",
          subtotal: total,
          shipping: 0,
          tax: 0,
          total,
          status: "PAID",
          shippingAddress: {},
          placedAt: new Date(placedAt),
          ...extra,
          items: { create: items.map((i) => ({ name: i.sku, label: "50 ml", ...i })) },
        },
      });
    await order("2031-03-04T20:00:00Z", 10_000);
    await order("2031-03-04T20:15:00Z", 20_000);
    await order("2031-03-04T21:00:00Z", 99_999, { status: "PENDING", reservedUntil: new Date("2031-03-04T21:30:00Z") }); // awaiting payment: not a sale
    await order("2031-03-04T21:10:00Z", 99_999, { status: "CANCELLED" });
    const heat = await D.getSalesHeatmap(IST, new Date("2031-03-10T06:00:00Z"));
    ok(heat.grid[2]![1]!.orders === 2 && heat.grid[2]![1]!.revenue === 30_000, `(${JSON.stringify(heat.grid[2]![1])}) heatmap buckets by IST weekday/hour (Wed 01:00), not UTC (Tue 20:00)`);
    ok(heat.grid[1]![20]!.orders === 0 && heat.total === 2 && heat.peak?.day === 2 && heat.peak.hour === 1, "unpaid and cancelled orders are excluded; peak found");
    const grid = L.heatmapGrid([{ dow: 7, hour: 23, orders: 3, revenue: 5 }, { dow: 9, hour: 1, orders: 1, revenue: 1 }]);
    ok(grid.grid[6]![23]!.orders === 3 && grid.total === 3, "ISO Sunday maps to the last row; invalid rows ignored");

    // Pulse at Thu 6 Mar 2031 15:30 IST: today vs the same span yesterday.
    const pulseNow = new Date("2031-03-06T10:00:00Z");
    await order("2031-03-06T05:00:00Z", 40_000, {}, [{ sku: "ADMCHK-A", unitPrice: 20_000, quantity: 2 }]); // today 10:30 IST
    await order("2031-03-05T05:00:00Z", 15_000, {}, [{ sku: "ADMCHK-A", unitPrice: 15_000, quantity: 1 }]); // yesterday, before this time
    await order("2031-03-05T12:00:00Z", 70_000, {}, [{ sku: "ADMCHK-B", unitPrice: 70_000, quantity: 1 }]); // yesterday, after this time
    await order("2031-03-06T11:00:00Z", 5_000); // in the future relative to pulseNow
    const pulse = await D.getPulse(IST, pulseNow);
    ok(pulse.todayRevenue === 40_000 && pulse.todayOrders === 1, `today so far: ₹400, 1 order (${pulse.todayRevenue}, ${pulse.todayOrders})`);
    // Yesterday (Wed 5 Mar IST) up to 15:30: the two 01:30/02:00 heatmap orders and the 10:30 one; not the 17:30 one.
    ok(pulse.yesterdayRevenue === 45_000 && pulse.yesterdayOrders === 3, `yesterday counts only up to the same time of day (${pulse.yesterdayRevenue}, ${pulse.yesterdayOrders})`);
    ok(pulse.lastOrder?.number === `${ORDER_PREFIX}5` && pulse.lastOrder.total === 40_000, "last order is the latest sale at or before now");
    // Order 7 at Mar 5 12:00Z counts as this week; the ones on 4–5 Mar too. Previous week is empty except nothing → move from 0.
    await order("2031-02-25T06:00:00Z", 60_000, {}, [{ sku: "ADMCHK-B", unitPrice: 60_000, quantity: 1 }, { sku: "ADMCHK-C", unitPrice: 90_000, quantity: 1 }]);
    const movers = await D.getTopMovers(IST, pulseNow);
    const by = new Map(movers.map((m) => [m.name, m]));
    ok(by.get("ADMCHK-A")?.change === 55_000 && by.get("ADMCHK-A")?.units === 3, "top movers: A up ₹550 on 3 units this week");
    ok(by.get("ADMCHK-C")?.change === -90_000 && by.get("ADMCHK-B")?.change === 10_000, "C fell to nothing, B rose ₹100 week on week");
    ok(movers[0]?.name === "ADMCHK-C", "ranked by size of the move");

    // The goal ring sums the month's daily series instead of running the four KPI queries; both must agree.
    const A = await import("@/server/analytics");
    const march = A.makeRange("custom", "2031-03-01", "2031-03-31", IST);
    const seriesSum = (await A.getSalesSeries(march)).reduce((sum, d) => sum + d.revenue, 0);
    const net = (await A.getKpis(march)).netRevenue;
    ok(seriesSum === net && net > 0, `month-to-date for the goal: series sum equals KPI net revenue (${seriesSum} = ${net})`);

    // Attention counts move with real records and respect permissions.
    const before1 = await D.getAttention(ALL_PERMISSIONS, 0);
    const count = (items: Awaited<ReturnType<typeof D.getAttention>>, key: string) => items.find((i) => i.key === key)?.count ?? -1;
    await db.visit.create({ data: { reference: "V-99-9999", name: "Pending Check", email: `pending${DOMAIN}`, phone: "1234567", purpose: "TOUR", groupSize: 1, startsAt: new Date("2030-06-04T05:30:00Z"), status: "REQUESTED" } });
    await SC.staffCreateTradeAccount(actor, { ...base, application: { ...application, businessName: "Pending Co" }, email: `pending-trade${DOMAIN}`, status: "PENDING" });
    const after1 = await D.getAttention(ALL_PERMISSIONS, 0);
    ok(count(after1, "visits") === count(before1, "visits") + 1 && count(after1, "trade-apps") === count(before1, "trade-apps") + 1, "attention counts include new visit requests and trade applications");
    ok(count(after1, "pack") >= 0 && after1.find((i) => i.key === "pack")?.href === "/admin/orders?status=TO_PACK", "orders to pack deep-link to the TO_PACK view");
    const narrow = await D.getAttention(["orders.view"], 0);
    ok(narrow.map((i) => i.key).join() === "pack,ship", "a viewer with only orders.view sees only order queues");
    const feed = await D.getActivity(["visits.manage", "trade.view"], 15);
    ok(feed.length > 0 && feed.every((f) => f.kind === "visit" || f.kind === "trade" || f.kind === "quote"), "activity feed only shows kinds the viewer may open");
    ok(feed.every((f, i) => i === 0 || feed[i - 1]!.at.getTime() >= f.at.getTime()), "activity feed is newest first");
  } finally {
    console.info = info;
    const users = await db.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await db.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await db.visit.deleteMany({ where: { OR: [{ email: { endsWith: DOMAIN } }, { name: "Gate Guest" }, { reference: "V-99-9999" }] } });
    await db.order.deleteMany({ where: { number: { startsWith: ORDER_PREFIX } } });
    await db.tradeAccount.deleteMany({ where: { userId: { in: ids } } });
    await db.session.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    for (const [key, row] of [
      [V.VISIT_SETTINGS_KEY, visitSettingsRow],
      [D.DASHBOARD_SETTINGS_KEY, dashRow],
    ] as const) {
      if (row) await db.setting.update({ where: { key }, data: { value: row.value ?? {} } });
      else await db.setting.deleteMany({ where: { key } });
    }
    const after = await snapshot();
    ok(JSON.stringify(after) === JSON.stringify(before), `cleaned up: no test users, accounts, visits, orders or audit rows left; settings restored (${JSON.stringify(after)})`);
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
