// Customer journeys (marketing automation) checks against the local database: segment entry enrolls once, re-runs and
// concurrent runs never double-send, frequency and daily caps, opt-out, staff/deleted/trade exclusion, personal coupons
// (single use, bound to the email, expiry), idempotent loyalty bonus, conversion attribution, signed unsubscribe tokens,
// permission denial, disabled journeys, dry-run and the kill switch.
// Creates its own category/product/users/orders, runs the engine scoped to those users only, and removes everything;
// journey settings and switches are restored, so real customers are never enrolled or emailed.
// Run: npm run test:automations
//
// Emails go to the console: the Resend key is blanked before any module reads the environment.
process.env.RESEND_API_KEY = "";
// Never send real mail from tests (SMTP takes precedence over Resend when configured).
process.env.SMTP_USER = "";
process.env.SMTP_PASSWORD = "";

// A module (not a global script), so helpers don't clash with other check scripts.
export {};

const DOMAIN = "automations-check.test";
const DAY = 86_400_000;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};

async function main() {
  await import("dotenv/config");
  const { db } = await import("@/server/db");
  const A = await import("@/server/automations");
  const M = await import("@/server/marketing");
  const { JOURNEY_KEYS, JOURNEY_SETTINGS_KEY } = await import("@/lib/journeys");
  const { resolvePermissions } = await import("@/lib/permissions");
  const { couponProblem } = await import("@/lib/pricing");
  const { segmentOf } = await import("@/server/analytics");
  const { cartInclude, cartLines } = await import("@/server/cart-lines");
  const { placeOrder } = await import("@/server/orders");
  const privacy = await import("@/server/privacy");

  const tag = `jrnchk${Date.now().toString(36)}`;
  const email = (who: string) => `${who}-${tag}@${DOMAIN}`;
  const userIds: string[] = [];
  const cartIds: string[] = [];
  const NOW = new Date();
  const at = (days: number) => new Date(NOW.getTime() + days * DAY);

  // ── Snapshot real data ──
  const settingsBefore = await db.setting.findUnique({ where: { key: JOURNEY_SETTINGS_KEY } });
  await A.ensureJourneys();
  const journeysBefore = await db.journey.findMany({ select: { key: true, enabled: true, config: true } });
  const realSegments = await db.customerSegment.findMany({ orderBy: { userId: "asc" } });
  const realCounts = async () =>
    Promise.all([
      db.journeyEnrollment.count({ where: { user: { email: { not: { endsWith: `@${DOMAIN}` } } } } }),
      db.journeyMessage.count({ where: { user: { email: { not: { endsWith: `@${DOMAIN}` } } } } }),
      db.coupon.count(),
      db.order.count(),
      db.loyaltyEntry.count(),
      db.marketingPreference.count(),
    ]);
  const countsBefore = await realCounts();
  const realPoints = await db.user.aggregate({ _sum: { loyaltyPoints: true }, where: { email: { not: { endsWith: `@${DOMAIN}` } } } });

  // ── Fixtures ──
  const category = await db.category.create({ data: { slug: tag, name: `${tag} Attars`, tagline: "t", description: "t", ambient: "GLOW" } });
  const product = await db.product.create({ data: { slug: tag, name: `${tag} Oud`, subtitle: "t", story: "t", categoryId: category.id, family: "WOODY", model: "OIL" } });
  const variant = await db.productVariant.create({ data: { productId: product.id, sku: `${tag}-A`.toUpperCase(), label: "12 ml", price: 120000, stock: 50, position: 0 } });

  const newUser = async (who: string, extra: { role?: "CUSTOMER" | "SUPPORT" | "MANAGER"; deletionRequestedAt?: Date } = {}) => {
    const u = await db.user.create({ data: { email: email(who), name: `JC ${who}`, ...extra } });
    userIds.push(u.id);
    return u;
  };
  let seq = 0;
  const order = async (user: { id: string; email: string }, placedAt: Date, extra: { status?: "PAID" | "DELIVERED"; couponCode?: string; total?: number; deliveredAt?: Date } = {}) =>
    db.order.create({
      data: {
        number: `${tag}-${++seq}`.toUpperCase(),
        userId: user.id,
        email: user.email,
        status: extra.status ?? "PAID",
        currency: "INR",
        subtotal: 120000,
        shipping: 0,
        tax: 0,
        total: extra.total ?? 120000,
        couponCode: extra.couponCode,
        shippingAddress: { fullName: "JC", line1: "1 Janpath", city: "New Delhi", country: "IN" },
        placedAt,
        items: { create: [{ variantId: variant.id, name: product.name, label: "12 ml", sku: variant.sku, unitPrice: 120000, quantity: 1 }] },
        ...(extra.status === "DELIVERED" ? { events: { create: [{ status: "DELIVERED", message: "Delivered", createdAt: extra.deliveredAt ?? placedAt }] } } : {}),
      },
    });
  const scope = () => [...userIds];
  const run = (now: Date, opts: { dryRun?: boolean } = {}) => A.runJourneys({ now, scope: scope(), ...opts });
  const enrollments = (userId: string, key?: string) => db.journeyEnrollment.findMany({ where: { userId, ...(key ? { journey: { key } } : {}) }, include: { messages: true } });
  const messages = (userId: string) => db.journeyMessage.findMany({ where: { userId }, orderBy: { sentAt: "asc" } });
  const actor = (role: "CUSTOMER" | "SUPPORT" | "MANAGER" | "OWNER", id: string) => ({ id, permissions: resolvePermissions(role, null) });
  const refused = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };

  try {
    const owner = await newUser("owner", { role: "MANAGER" });
    const manager = actor("MANAGER", owner.id);
    await A.saveJourneySettings(manager, { paused: false, dryRun: false, frequencyCapHours: 72, dailySendCap: 500, includeTrade: false, entryWindowDays: 7, cooldownDays: 90, attributionDays: 14 });
    for (const k of JOURNEY_KEYS) await A.setJourneyEnabled(manager, k, false);

    // Customers, by segment (segment rules are the reports' own).
    const alice = await newUser("alice"); // New: first order 2 days ago
    await order(alice, at(-2));
    const bob = await newUser("bob"); // At risk: 2 orders, last 95 days ago (entered at 91 days → 4 days ago)
    await order(bob, at(-200));
    await order(bob, at(-95));
    const carol = await newUser("carol"); // Champions: 3 orders, last 2 days ago
    for (const d of [-20, -10, -2]) await order(carol, at(d));
    const dave = await newUser("dave"); // Lost: last order 184 days ago (entered at 181 → 3 days ago)
    await order(dave, at(-184));
    const staff = await newUser("staff", { role: "SUPPORT" });
    await order(staff, at(-200));
    await order(staff, at(-95));
    const gone = await newUser("deleted", { deletionRequestedAt: at(-1) });
    await order(gone, at(-200));
    await order(gone, at(-95));
    const erin = await newUser("erin"); // At risk but opted out
    await order(erin, at(-200));
    await order(erin, at(-95));
    await M.setJourneyEmails(erin.email, false, "account");
    const trader = await newUser("trader"); // At risk, trade account
    await order(trader, at(-200));
    await order(trader, at(-95));
    await db.tradeAccount.create({ data: { userId: trader.id, businessName: `${tag} Spa`, businessType: "SPA", contactName: "T", phone: "+919800000000", address: {}, status: "APPROVED" } });
    const frank = await newUser("frank"); // New + a delivered, unreviewed order → welcome and review at once
    await order(frank, at(-6), { status: "DELIVERED", deliveredAt: at(-5.5) });

    ok(segmentOf(95, 2) === "At risk" && segmentOf(184, 1) === "Lost" && segmentOf(2, 3) === "Champions" && segmentOf(2, 1) === "New", "segment rules shared with the reports");

    // ── 1. Disabled journeys do nothing ──
    const r0 = await run(NOW);
    ok(r0.enrolled === 0 && r0.sent === 0 && (await db.journeyEnrollment.count({ where: { userId: { in: scope() } } })) === 0, "all journeys off → nothing enrolled or sent");
    ok((await db.customerSegment.count({ where: { userId: { in: scope() } } })) === 9, "segment snapshot recorded for the test customers");

    // ── 2. Permission ──
    const noPerm = await refused(() => A.setJourneyEnabled(actor("SUPPORT", staff.id), "welcome", true));
    const custPerm = await refused(() => A.saveJourneyConfig(actor("CUSTOMER", alice.id), "vip", { bonusPoints: 9999 }));
    ok(Boolean(noPerm?.includes("permission")) && Boolean(custPerm?.includes("permission")), `no automations.manage → refused (“${noPerm}”)`);
    ok(!(await db.journey.findUniqueOrThrow({ where: { key: "welcome" } })).enabled, "refused action changed nothing");
    ok((await refused(() => A.saveJourneyConfig(manager, "winback", { couponAfterDays: 7, percentOff: 90, couponValidDays: 14, reminderDaysBefore: 3, minSubtotal: 0 }))) !== null, "invalid config (90% off) rejected by zod");

    // ── 3. Dry run and kill switch write nothing ──
    for (const k of JOURNEY_KEYS) await A.setJourneyEnabled(manager, k, true);
    await A.saveJourneyConfig(manager, "vip", { bonusPoints: 300 });
    const dry = await run(NOW, { dryRun: true });
    ok(Boolean(dry.dryRun) && dry.wouldEnroll?.welcome === 2 && dry.wouldEnroll?.winback === 1 && dry.wouldEnroll?.vip === 1 && dry.wouldEnroll?.lapsed === 1 && dry.wouldEnroll?.review === 1, `dry run reports entries ${JSON.stringify(dry.wouldEnroll)}`);
    const preview = await A.previewEntries("winback");
    ok(!preview.people.some((p) => [staff.id, gone.id, erin.id, trader.id].includes(p.userId)), "preview applies the guardrails");
    await A.setJourneysPaused(manager, true);
    const paused = await run(NOW);
    ok(Boolean(paused.paused) && (await db.journeyEnrollment.count({ where: { userId: { in: scope() } } })) === 0, "dry run and kill switch enroll nothing");
    await A.setJourneysPaused(manager, false);

    // ── 4. Segment entry enrolls once; step 0 sends ──
    const r1 = await run(NOW);
    const en = async (u: { id: string }, key: string) => (await enrollments(u.id, key)).length;
    ok((await en(alice, "welcome")) === 1 && (await en(bob, "winback")) === 1 && (await en(carol, "vip")) === 1 && (await en(dave, "lapsed")) === 1, `entries enrolled (${r1.enrolled})`);
    ok((await en(staff, "winback")) === 0 && (await en(gone, "winback")) === 0, "staff and deleted accounts never enrolled");
    ok((await en(erin, "winback")) === 0, "opted-out customer not enrolled");
    ok((await en(trader, "winback")) === 0, "trade account excluded by default");
    ok((await messages(alice.id)).length === 1 && (await messages(bob.id)).length === 1 && (await messages(carol.id)).length === 1 && (await messages(dave.id)).length === 1, `step 0 emails sent (${r1.sent})`);
    ok((await messages(alice.id))[0].status === "SENT" && (await messages(alice.id))[0].template === "welcome", "welcome email recorded as sent");

    // Frequency cap: frank entered welcome and review at once → one email, the other waits 72h.
    const frankMsgs = await messages(frank.id);
    const frankRuns = await enrollments(frank.id);
    const waiting = frankRuns.find((e) => e.messages.length === 0);
    ok(frankRuns.length === 2 && frankMsgs.length === 1, "two journeys at once → only one email (frequency cap)");
    ok(waiting?.status === "ACTIVE" && Math.abs((waiting.nextRunAt?.getTime() ?? 0) - (frankMsgs[0].sentAt.getTime() + 72 * 3_600_000)) < 1000, "the other step is deferred to the end of the 72h window");

    // ── 5. Re-running and concurrent runs never double-send ──
    const totalMsgs = () => db.journeyMessage.count({ where: { userId: { in: scope() } } });
    const totalRuns = () => db.journeyEnrollment.count({ where: { userId: { in: scope() } } });
    const [m1, e1] = [await totalMsgs(), await totalRuns()];
    await run(NOW);
    ok((await totalMsgs()) === m1 && (await totalRuns()) === e1, "running the job again sends and enrolls nothing new");
    const gina = await newUser("gina");
    await order(gina, at(-1));
    const race = await Promise.allSettled([run(NOW), run(NOW), run(NOW), run(NOW)]);
    ok(race.every((r) => r.status === "fulfilled"), "4 concurrent runs complete");
    ok((await en(gina, "welcome")) === 1 && (await messages(gina.id)).length === 1, "concurrent runs → one enrollment, one email");
    ok((await totalMsgs()) === m1 + 1, "no other customer got a duplicate under concurrency");

    // ── 6. Loyalty bonus is idempotent ──
    const bonus = () => db.loyaltyEntry.findMany({ where: { userId: carol.id, reason: { contains: "thank-you bonus" } } });
    const carolPts = (await db.user.findUniqueOrThrow({ where: { id: carol.id } })).loyaltyPoints;
    ok((await bonus()).length === 1 && (await bonus())[0].points === 300 && carolPts === 300, "VIP: one +300 ledger entry and balance");
    await Promise.all([run(at(1)), run(at(1))]);
    ok((await bonus()).length === 1 && (await db.user.findUniqueOrThrow({ where: { id: carol.id } })).loyaltyPoints === 300, "bonus never granted twice");
    ok((await enrollments(carol.id, "vip"))[0].status === "COMPLETED", "VIP run completed");

    // ── 7. Personal coupon: unguessable, single use, bound to the email, expires ──
    const daveMsg = (await messages(dave.id))[0];
    const code = daveMsg.couponCode!;
    const coupon = await db.coupon.findUniqueOrThrow({ where: { code } });
    ok(/^LP-[A-Z2-9]{12}$/.test(code) && coupon.maxUses === 1 && coupon.type === "PERCENT" && coupon.value === 20, `lapsed coupon ${code}: 20%, single use`);
    ok(Math.abs((coupon.endsAt?.getTime() ?? 0) - at(21).getTime()) < 1000 && daveMsg.couponExpiresAt?.getTime() === coupon.endsAt?.getTime(), "expires after the configured 21 days");
    ok(couponProblem(coupon, 200000, at(22)) === "This code has expired." && couponProblem(coupon, 200000, at(1)) === null, "expired code refused by checkout pricing");
    ok((await M.personalCouponProblem(code, alice.email)) !== null && (await M.personalCouponProblem(code, dave.email.toUpperCase())) === null, "bound to dave’s email (case-insensitive)");
    const c = await db.cart.create({ data: { email: alice.email, couponId: coupon.id, items: { create: [{ variantId: variant.id, quantity: 1 }] } } });
    cartIds.push(c.id);
    const cart = await db.cart.findUniqueOrThrow({ where: { id: c.id }, include: cartInclude });
    const stolen = await refused(async () =>
      placeOrder({ cart, lines: await cartLines(cart), userId: alice.id, email: alice.email, address: { fullName: "A", phone: "+919800000000", line1: "1 Janpath", city: "New Delhi", state: "DL", postalCode: "110001", country: "IN" }, shippingRateId: "ship-in", provider: "COD", pointsRequested: 0, giftWrap: false }),
    );
    ok(Boolean(stolen?.includes("personal")) && (await db.order.count({ where: { couponCode: code } })) === 0, `checkout refuses the code for another email (“${stolen}”)`);

    // ── 8. Conversion & attribution ──
    const daveOrder = await order(dave, at(2), { couponCode: code, total: 96000 });
    ok((await M.personalCouponProblem(code, dave.email)) === "This code has already been used.", "single use: a second order can’t reuse it");
    await run(at(2.1));
    const daveAfter = await db.journeyMessage.findUniqueOrThrow({ where: { id: daveMsg.id } });
    const daveRun = (await enrollments(dave.id, "lapsed"))[0];
    ok(daveAfter.convertedOrderId === daveOrder.id && daveAfter.revenue === 96000, "order within 14 days attributed to the last email (revenue recorded)");
    ok(daveRun.status === "CONVERTED" && daveRun.convertedOrderId === daveOrder.id, "lapsed run marked CONVERTED");
    await run(at(2.2));
    ok((await db.journeyMessage.count({ where: { convertedOrderId: daveOrder.id } })) === 1, "an order is attributed once");

    // ── 9. Win-back: code after 7 days, reminder 3 days before expiry ──
    await db.marketingPreference.create({ data: { email: alice.email.toLowerCase(), journeys: false, source: "account" } });
    await run(at(7.1));
    const bobMsgs = await messages(bob.id);
    const wb = bobMsgs.find((m) => m.step === 1);
    ok(bobMsgs.length === 2 && /^WB-[A-Z2-9]{12}$/.test(wb?.couponCode ?? "") && (await db.coupon.findUniqueOrThrow({ where: { code: wb!.couponCode! } })).value === 15, "win-back personal 15% code on day 7");
    await run(at(7.1 + 10));
    ok((await messages(bob.id)).length === 2, "no reminder before its time");
    await run(at(7.1 + 11.1));
    const bobRun = (await enrollments(bob.id, "winback"))[0];
    ok((await messages(bob.id)).length === 3 && (await messages(bob.id))[2].template === "winback-reminder" && bobRun.status === "COMPLETED", "reminder 3 days before expiry, then the run completes");
    // ── 11. Daily send cap ──
    const hank = await newUser("hank");
    await order(hank, at(18.25));
    const sentToday = await db.journeyMessage.count({ where: { sentAt: { gt: at(18.3 - 1), lte: at(18.3) }, status: { in: ["SENDING", "SENT"] } } });
    await A.saveJourneySettings(manager, { ...(await A.getJourneySettings()), dailySendCap: sentToday });
    const capped = await run(at(18.3));
    ok(sentToday >= 1 && Boolean(capped.dailyCapReached) && (await messages(hank.id)).length === 0 && (await enrollments(hank.id, "welcome"))[0]?.status === "ACTIVE", `daily send cap (${sentToday}) defers sends`);
    await A.saveJourneySettings(manager, { ...(await A.getJourneySettings()), dailySendCap: 500 });
    await run(at(18.4));
    ok((await messages(hank.id)).length === 1, "…and they go out once there is room");

    await order(bob, at(20));
    await run(at(20.1));
    ok((await db.journeyMessage.findFirstOrThrow({ where: { userId: bob.id, step: 2 } })).convertedOrderId !== null, "late order (within 14 days of the reminder) attributed to the reminder");

    // ── 10. Opt-out stops sends ──
    // a) a preference written directly (bypassing the helper) is honoured by the engine at the next step — see step 9
    const aliceRun = (await enrollments(alice.id, "welcome"))[0];
    ok(aliceRun.status === "EXITED" && aliceRun.exitReason === "opted out" && (await messages(alice.id)).length === 1, "opted out mid-journey → exits at the next step, no further email");
    // b) the unsubscribe helper stops runs immediately
    await M.setJourneyEmails(gina.email, false, "link");
    const ginaRun = (await enrollments(gina.id, "welcome"))[0];
    ok(ginaRun.status === "EXITED" && ginaRun.exitReason === "opted out", "unsubscribing exits active runs immediately");

    // ── 12. Unsubscribe tokens ──
    const token = M.unsubscribeToken(hank.email);
    const [head, sig] = token.split(".");
    const forged = `${Buffer.from(alice.email.toLowerCase()).toString("base64url")}.${sig}`;
    const flipped = `${head}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
    ok(M.verifyUnsubscribeToken(token) === hank.email.toLowerCase(), "valid token → its email");
    ok(M.verifyUnsubscribeToken(forged) === null && M.verifyUnsubscribeToken(flipped) === null && M.verifyUnsubscribeToken("x.y") === null && M.verifyUnsubscribeToken(undefined) === null, "tampered, forged and garbage tokens refused");
    const headers = M.listUnsubscribeHeaders(hank.email);
    ok(headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click" && headers["List-Unsubscribe"].includes("/api/unsubscribe?t="), "List-Unsubscribe one-click headers");

    // ── 13. Privacy: export and deletion cover journey data ──
    const exp = await privacy.exportUserData(bob.id);
    const wbExport = exp.journeys.find((j) => j.journey === "Win-back");
    // Bob's third order made him a Champion: VIP enrolled, its email held back by the 72h cap.
    ok(wbExport?.messages.length === 3 && Boolean(wbExport.messages[1].couponCode) && exp.journeys.some((j) => j.journey === "VIP" && j.messages.length === 0) && exp.marketing.journeyEmails === true, `data export includes journeys and email preference (${JSON.stringify({ j: exp.journeys.map((j) => [j.journey, j.messages.length]), m: exp.marketing })})`);
    await M.setJourneyEmails(bob.email, true, "account");
    await privacy.deleteAccount(bob.id, { email: bob.email, phrase: "DELETE" });
    const bobScrubbed = await db.journeyMessage.findMany({ where: { userId: bob.id } });
    ok(
      bobScrubbed.every((m) => m.email.endsWith(".invalid")) &&
        (await db.marketingPreference.count({ where: { email: bob.email.toLowerCase() } })) === 0 &&
        (await db.customerSegment.count({ where: { userId: bob.id } })) === 0,
      "deletion scrubs message emails, drops preference and segment",
    );
    const reSend = await run(at(40));
    ok((await db.journeyMessage.count({ where: { userId: bob.id } })) === 3 && reSend.failed === 0, "deleted customer never emailed again");

    // ── 14. Audit ──
    const audits = await db.auditLog.findMany({ where: { actorId: owner.id }, select: { action: true } });
    ok(["journey.enable", "journey.config", "journeys.settings"].every((a) => audits.some((x) => x.action === a)), "admin changes are audited");
  } finally {
    // ── Clean up ── (runs even after a failure)
    const msgs = await db.journeyMessage.findMany({ where: { userId: { in: userIds } }, select: { couponCode: true } });
    await db.coupon.deleteMany({ where: { code: { in: msgs.flatMap((m) => (m.couponCode ? [m.couponCode] : [])) } } });
    await db.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    const testEmails = userIds.length ? (await db.user.findMany({ where: { id: { in: userIds } }, select: { email: true } })).map((u) => u.email.toLowerCase()) : [];
    await db.marketingPreference.deleteMany({ where: { OR: [{ email: { in: testEmails } }, { email: { endsWith: `@${DOMAIN}` } }] } });
    const orders = await db.order.findMany({ where: { OR: [{ userId: { in: userIds } }, { email: { endsWith: `@${DOMAIN}` } }, { number: { startsWith: tag.toUpperCase() } }] }, select: { id: true } });
    await db.inventoryLog.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
    await db.order.deleteMany({ where: { id: { in: orders.map((o) => o.id) } } });
    await db.cart.deleteMany({ where: { OR: [{ id: { in: cartIds } }, { userId: { in: userIds } }] } });
    await db.user.deleteMany({ where: { id: { in: userIds } } }); // enrollments, messages, segments, ledger, trade account cascade
    await db.product.delete({ where: { id: product.id } });
    await db.category.delete({ where: { id: category.id } });
    if (settingsBefore) await db.setting.update({ where: { key: JOURNEY_SETTINGS_KEY }, data: { value: settingsBefore.value ?? {} } });
    else await db.setting.deleteMany({ where: { key: JOURNEY_SETTINGS_KEY } });
    for (const j of journeysBefore) await db.journey.update({ where: { key: j.key }, data: { enabled: j.enabled, config: j.config ?? {} } });

    const countsAfter = await realCounts();
    ok(countsAfter.join() === countsBefore.join(), `no enrollments, messages, coupons, orders, ledger entries or preferences left behind (${countsAfter.join("/")})`);
    const segAfter = await db.customerSegment.findMany({ orderBy: { userId: "asc" } });
    ok(JSON.stringify(segAfter) === JSON.stringify(realSegments), "real customers’ segment snapshot untouched");
    const ptsAfter = await db.user.aggregate({ _sum: { loyaltyPoints: true }, where: { email: { not: { endsWith: `@${DOMAIN}` } } } });
    ok(ptsAfter._sum.loyaltyPoints === realPoints._sum.loyaltyPoints, "real loyalty balances unchanged");
    ok((await db.user.count({ where: { email: { endsWith: `@${DOMAIN}` } } })) === 0, "test users removed");
    ok((await db.journey.findMany({ where: { enabled: true } })).length === journeysBefore.filter((j) => j.enabled).length, "journey switches restored");
    console.log("cleaned up");
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
