// Returns & exchanges (RMA) checks against the local database: policy window, over-return prevention (incl. concurrent
// requests), restocking, refund maths with a restocking fee, store credit, exchanges, rejected/cancelled flows,
// provider-failure rollback and permission denial. Creates its own category/product/variants/users/orders and removes them;
// real stock is never touched.
// Run: npm run test:returns
//
// Emails go to the console: the Resend key is blanked before any module reads the environment.
process.env.RESEND_API_KEY = "";

// A module (not a global script), so helpers don't clash with other check scripts.
export {};

const DOMAIN = "returns-check.invalid";
const addr = { fullName: "Return Tester", phone: "+919800000000", line1: "1 Janpath", city: "New Delhi", state: "DL", postalCode: "110001", country: "IN" };
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};

async function main() {
  await import("dotenv/config");
  const { db } = await import("@/server/db");
  const { cartInclude, cartLines } = await import("@/server/cart-lines");
  const { placeOrder, advanceOrder } = await import("@/server/orders");
  const R = await import("@/server/returns");
  const { refundQuote, loyaltyClawback, returnTimeline } = await import("@/lib/returns");
  const { resolvePermissions } = await import("@/lib/permissions");

  const tag = `rmachk${Date.now().toString(36)}`;
  const email = (who: string) => `${who}-${tag}@${DOMAIN}`;
  const userIds: string[] = [];
  const cartIds: string[] = [];

  // ── Snapshot real data ──
  const realVariantsBefore = await db.productVariant.findMany({ select: { id: true, stock: true, reserved: true } });
  const countsBefore = await Promise.all([db.returnRequest.count(), db.giftCard.count(), db.order.count()]);
  const settingsBefore = await db.setting.findUnique({ where: { key: R.RETURN_SETTINGS_KEY } });

  // ── Fixtures ──
  const category = await db.category.create({ data: { slug: tag, name: `${tag} Attars`, tagline: "t", description: "t", ambient: "GLOW" } });
  const product = await db.product.create({ data: { slug: tag, name: `${tag} Oud`, subtitle: "t", story: "t", categoryId: category.id, family: "WOODY", model: "OIL" } });
  const A = await db.productVariant.create({ data: { productId: product.id, sku: `${tag}-A`.toUpperCase(), label: "12 ml", price: 120000, stock: 30, position: 0 } });
  const B = await db.productVariant.create({ data: { productId: product.id, sku: `${tag}-B`.toUpperCase(), label: "3 ml", price: 45000, stock: 30, position: 1 } });
  const stock = async (id: string) => (await db.productVariant.findUniqueOrThrow({ where: { id } })).stock;

  const newUser = async (who: string, role: "CUSTOMER" | "SUPPORT" = "CUSTOMER") => {
    const u = await db.user.create({ data: { email: email(who), name: `RC ${who}`, role } });
    userIds.push(u.id);
    return u;
  };
  const order = async (user: { id: string; email: string }, items: { variantId: string; quantity: number }[]) => {
    const c = await db.cart.create({ data: { email: user.email, items: { create: items } } });
    cartIds.push(c.id);
    const cart = await db.cart.findUniqueOrThrow({ where: { id: c.id }, include: cartInclude });
    const { order } = await placeOrder({ cart, lines: await cartLines(cart), userId: user.id, email: user.email, address: addr, shippingRateId: "ship-in", provider: "COD", pointsRequested: 0, giftWrap: false });
    return db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: { orderBy: { id: "asc" } } } });
  };
  const deliver = async (id: string) => {
    await advanceOrder(id, "PACKED");
    await advanceOrder(id, "SHIPPED", { trackingNumber: "TRK1", carrier: "Test" });
    await advanceOrder(id, "DELIVERED");
  };
  const line = (o: { items: { id: string; variantId: string | null }[] }, v: { id: string }) => o.items.find((i) => i.variantId === v.id)!.id;
  const err = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return null;
    } catch (e) {
      return e instanceof R.ReturnError ? e.message : `unexpected: ${e instanceof Error ? e.message : String(e)}`;
    }
  };
  const isRma = (s: string | null) => s !== null && !s.startsWith("unexpected");

  try {
    await R.saveReturnSettings({ enabled: true, windowDays: 14, restockingFeePercent: 10, nonReturnableCategories: [] });
    const alice = await newUser("alice");
    const bob = await newUser("bob");
    const staffUser = await newUser("staff", "SUPPORT");
    const staff = { id: staffUser.id, permissions: resolvePermissions("SUPPORT", null) };
    const customerActor = { id: alice.id, permissions: resolvePermissions("CUSTOMER", null) };
    const packerRole = await db.staffRole.create({ data: { name: `${tag} packer`, permissions: ["orders.fulfil"] } });
    const packer = { id: staffUser.id, permissions: resolvePermissions("SUPPORT", packerRole.permissions) };

    // ── 1. Pure maths ──
    const q = refundQuote({ order: { subtotal: 10000, total: 9800, shipping: 500 }, lines: [{ unitPrice: 2500, quantity: 2 }], feePercent: 10 });
    ok(q.gross === 4650 && q.fee === 465 && q.amount === 4185, `refund maths: 5000 of 10000 list, 9300 charged for goods → gross ${q.gross}, fee ${q.fee}, refund ${q.amount}`);
    const capped = refundQuote({ order: { subtotal: 10000, total: 9800, shipping: 500 }, lines: [{ unitPrice: 2500, quantity: 2 }], alreadyRefunded: 9000, feePercent: 10, waiveFee: true });
    ok(capped.gross === 300 && capped.fee === 0 && capped.amount === 300, `capped at what is still refundable (${capped.amount}); waived fee = 0`);
    ok(loyaltyClawback({ earned: 100, alreadyReversed: 0, gross: 4650, goodsCharged: 9300 }) === 50 && loyaltyClawback({ earned: 100, alreadyReversed: 80, gross: 4650, goodsCharged: 9300 }) === 20, "loyalty clawback is proportional and never exceeds what was earned");
    const tl = returnTimeline({ status: "REJECTED", resolution: null, preferred: "REFUND", requestedAt: new Date(), approvedAt: null, receivedAt: null, resolvedAt: null, rejectedAt: new Date(), cancelledAt: null });
    ok(tl.length === 2 && tl[1].tone === "stop" && tl[1].label === "Declined", "timeline stops at Declined");

    // ── 2. Eligibility & window ──
    const o1 = await order(alice, [
      { variantId: A.id, quantity: 3 },
      { variantId: B.id, quantity: 1 },
    ]);
    const req = (o: { number: string }, items: { orderItemId: string; quantity: number }[], extra: Partial<Parameters<typeof R.createReturnRequest>[0]> = {}) =>
      R.createReturnRequest({ userId: alice.id, orderNumber: o.number, items, reason: "Scent not for me", preferred: "REFUND", ...extra });

    const notDelivered = await err(() => req(o1, [{ orderItemId: line(o1, A), quantity: 1 }]));
    ok(Boolean(notDelivered?.includes("delivered")), `undelivered order refused: “${notDelivered}”`);
    await deliver(o1.id);
    const deliveredAt = (await db.orderEvent.findFirstOrThrow({ where: { orderId: o1.id, status: "DELIVERED" } })).createdAt;
    const elig = await R.getReturnEligibility(o1.id);
    ok(!elig?.problem && elig?.deadline?.getTime() === deliveredAt.getTime() + 14 * 864e5, "delivered → eligible, deadline = delivery + 14 days");
    const late = await err(() => req(o1, [{ orderItemId: line(o1, A), quantity: 1 }], { now: new Date(deliveredAt.getTime() + 15 * 864e5) }));
    ok(Boolean(late?.includes("14-day return window closed")), `outside the window refused: “${late}”`);
    const notMine = await err(() => R.createReturnRequest({ userId: bob.id, orderNumber: o1.number, items: [{ orderItemId: line(o1, A), quantity: 1 }], reason: "Other", preferred: "REFUND" }));
    ok(notMine === "We couldn’t find that order.", "another customer cannot return my order");

    // ── 3. Over-return prevention ──
    const tooMany = await err(() => req(o1, [{ orderItemId: line(o1, A), quantity: 4 }]));
    ok(Boolean(tooMany?.includes("up to 3")), `more than purchased refused: “${tooMany}”`);
    const r1 = await req(o1, [{ orderItemId: line(o1, A), quantity: 2 }], { note: "Too strong for me" });
    ok(/^RMA-\d{5,}$/.test(r1.number) && r1.status === "REQUESTED", `return created ${r1.number}`);
    const again = await err(() => req(o1, [{ orderItemId: line(o1, A), quantity: 2 }]));
    ok(Boolean(again?.includes("up to 1")), `already-returned units counted: “${again}”`);
    ok((await db.orderEvent.count({ where: { orderId: o1.id, message: { startsWith: `Return ${r1.number} requested` } } })) === 1, "order event written for the request");
    const eligAfter = await R.getReturnEligibility(o1.id);
    ok(eligAfter?.deadline?.getTime() === deliveredAt.getTime() + 14 * 864e5, "a return request doesn't extend the window (deadline still counts from first delivery)");

    // ── 4. Concurrent requests can't exceed what was bought ──
    const o2 = await order(alice, [{ variantId: A.id, quantity: 3 }]);
    await deliver(o2.id);
    const race = await Promise.allSettled(Array.from({ length: 6 }, () => req(o2, [{ orderItemId: line(o2, A), quantity: 1 }])));
    const won = race.filter((x) => x.status === "fulfilled");
    const lost = race.filter((x): x is PromiseRejectedResult => x.status === "rejected");
    const claimed = await db.returnItem.aggregate({ where: { orderItem: { orderId: o2.id } }, _sum: { quantity: true } });
    ok(won.length === 3 && lost.length === 3 && claimed._sum.quantity === 3, `6 concurrent requests for 3 units → ${won.length} accepted, ${lost.length} refused, ${claimed._sum.quantity} claimed`);
    ok(lost.every((l) => l.reason instanceof R.ReturnError), "refused racers get a customer-safe ReturnError");
    const nums = won.map((w) => (w as PromiseFulfilledResult<{ number: string }>).value.number);
    ok(new Set(nums).size === nums.length, `RMA numbers unique under concurrency (${nums.join(", ")})`);

    // ── 5. Customer cancel ──
    const wonIds = won.map((w) => (w as PromiseFulfilledResult<{ id: string }>).value.id);
    ok(isRma(await err(() => R.cancelReturnRequest({ userId: bob.id, returnId: wonIds[0] }))), "another customer cannot cancel my return");
    await R.cancelReturnRequest({ userId: alice.id, returnId: wonIds[0] });
    const cancelled = await db.returnRequest.findUniqueOrThrow({ where: { id: wonIds[0] } });
    ok(cancelled.status === "CANCELLED" && cancelled.cancelledAt !== null, "customer cancels while REQUESTED");
    ok(isRma(await err(() => R.cancelReturnRequest({ userId: alice.id, returnId: wonIds[0] }))), "cannot cancel twice");
    const afterCancel = await R.getReturnEligibility(o2.id);
    ok(afterCancel?.lines[0].returnable === 1, "cancelled units become returnable again");
    await R.approveReturn(staff, wonIds[1]);
    ok(isRma(await err(() => R.cancelReturnRequest({ userId: alice.id, returnId: wonIds[1] }))), "approved return can no longer be cancelled by the customer");

    // ── 6. Permission denial ──
    ok(resolvePermissions("SUPPORT", null).includes("returns.manage") && !resolvePermissions("CUSTOMER", null).includes("returns.manage"), "support has returns.manage; customers don't");
    const denied = await err(() => R.approveReturn(customerActor, r1.id));
    const deniedPacker = await err(() => R.resolveReturn(packer, r1.id, { resolution: "REFUND" }));
    ok(Boolean(denied?.includes("permission")) && Boolean(deniedPacker?.includes("permission")), `no returns.manage → refused (“${denied}”)`);
    ok((await db.returnRequest.findUniqueOrThrow({ where: { id: r1.id } })).status === "REQUESTED", "refused actions change nothing");
    ok(isRma(await err(() => R.receiveReturn(staff, r1.id, []))), "cannot receive before approval");

    // ── 7. Reject flow ──
    const rj = await req(o1, [{ orderItemId: line(o1, A), quantity: 1 }]);
    ok(isRma(await err(() => R.rejectReturn(staff, rj.id, "x"))), "rejection needs a reason");
    await R.rejectReturn(staff, rj.id, "Opened and partly used");
    const rjAfter = await db.returnRequest.findUniqueOrThrow({ where: { id: rj.id } });
    ok(rjAfter.status === "REJECTED" && rjAfter.rejectionReason === "Opened and partly used" && rjAfter.rejectedAt !== null, "rejected with reason recorded");
    ok(isRma(await err(() => R.approveReturn(staff, rj.id))), "rejected return can't be approved");
    ok((await R.getReturnEligibility(o1.id))?.lines.find((l) => l.orderItemId === line(o1, A))?.returnable === 1, "rejected units become returnable again");

    // ── 8. Receive → restock, refund with fee (COD → manual) and proportional loyalty ──
    const aBefore = await stock(A.id);
    await R.approveReturn(staff, r1.id);
    const r1Items = await db.returnItem.findMany({ where: { returnId: r1.id } });
    ok(isRma(await err(() => R.receiveReturn(staff, r1.id, []))), "every line must be inspected");
    await R.receiveReturn(staff, r1.id, r1Items.map((i) => ({ itemId: i.id, condition: "RESELLABLE" as const, restock: true })));
    ok((await stock(A.id)) === aBefore + 2, `resellable units restocked (${aBefore} → ${await stock(A.id)})`);
    const log = await db.inventoryLog.findFirst({ where: { variantId: A.id, orderId: o1.id, reason: "RETURN", actorId: staff.id } });
    ok(log?.delta === 2, "InventoryLog RETURN +2 with order and actor");

    const order1 = await db.order.findUniqueOrThrow({ where: { id: o1.id } });
    const expectGross = Math.round((A.price * 2 * (order1.total - order1.shipping)) / order1.subtotal);
    const expectFee = Math.round(expectGross * 0.1);
    const preview = await R.previewReturnRefund(r1.id);
    ok(preview?.gross === expectGross && preview.fee === expectFee && preview.amount === expectGross - expectFee, `preview: gross ${preview?.gross}, fee ${preview?.fee}, refund ${preview?.amount}`);
    const ptsBefore = (await db.user.findUniqueOrThrow({ where: { id: alice.id } })).loyaltyPoints;
    const earned = (await db.loyaltyEntry.findMany({ where: { orderId: o1.id, points: { gt: 0 } } })).reduce((s, e) => s + e.points, 0);
    const res1 = await R.resolveReturn(staff, r1.id, { resolution: "REFUND" });
    const r1Done = await db.returnRequest.findUniqueOrThrow({ where: { id: r1.id } });
    ok(r1Done.status === "REFUNDED" && r1Done.refundAmount === expectGross - expectFee && r1Done.restockingFee === expectFee, `refunded ${r1Done.refundAmount} after ${r1Done.restockingFee} fee`);
    ok(r1Done.refundMethod === "MANUAL" && r1Done.providerAmount === r1Done.refundAmount, "COD order → recorded as a manual refund");
    const expectPts = Math.round((earned * expectGross) / (order1.total - order1.shipping));
    const ptsAfter = (await db.user.findUniqueOrThrow({ where: { id: alice.id } })).loyaltyPoints;
    ok(res1.points === expectPts && ptsAfter === ptsBefore - expectPts, `loyalty reversed proportionally (${earned} earned → −${expectPts})`);
    ok((await db.order.findUniqueOrThrow({ where: { id: o1.id } })).status === "DELIVERED", "order itself stays delivered (partial return)");
    ok(isRma(await err(() => R.resolveReturn(staff, r1.id, { resolution: "REFUND" }))), "cannot refund the same return twice");
    const audits = await db.auditLog.findMany({ where: { actorId: staff.id, entityId: r1.id }, select: { action: true } });
    ok(["return.approve", "return.receive", "return.refund"].every((a) => audits.some((x) => x.action === a)), `audit trail: ${audits.map((a) => a.action).join(", ")}`);
    const events = await db.orderEvent.findMany({ where: { orderId: o1.id, message: { contains: r1.number } } });
    ok(events.length === 4, `order timeline has request/approve/receive/refund events (${events.length})`);

    // Damaged → not restocked; store credit with the fee waived.
    const bBefore = await stock(B.id);
    const r2 = await req(o1, [{ orderItemId: line(o1, B), quantity: 1 }], { preferred: "STORE_CREDIT", reason: "Damaged in transit" });
    await R.approveReturn(staff, r2.id);
    const r2Item = await db.returnItem.findFirstOrThrow({ where: { returnId: r2.id } });
    await R.receiveReturn(staff, r2.id, [{ itemId: r2Item.id, condition: "DAMAGED", restock: false }]);
    ok((await stock(B.id)) === bBefore && (await db.returnItem.findUniqueOrThrow({ where: { id: r2Item.id } })).condition === "DAMAGED", "damaged unit recorded, not restocked");
    await R.resolveReturn(staff, r2.id, { resolution: "STORE_CREDIT", waiveFee: true });
    const r2Done = await db.returnRequest.findUniqueOrThrow({ where: { id: r2.id } });
    const credit = r2Done.giftCardId ? await db.giftCard.findUnique({ where: { id: r2Done.giftCardId } }) : null;
    const expectB = Math.round((B.price * (order1.total - order1.shipping)) / order1.subtotal);
    ok(r2Done.status === "REFUNDED" && r2Done.resolution === "STORE_CREDIT" && r2Done.restockingFee === 0 && r2Done.refundAmount === expectB, `store credit ${r2Done.refundAmount} (fee waived)`);
    ok(credit?.balance === expectB && credit.isActive && credit.recipientEmail === alice.email && credit.sourceOrderId === null, `gift card ${credit?.code} issued for the credit`);
    const totalBack = await db.returnRequest.aggregate({ where: { orderId: o1.id, status: "REFUNDED" }, _sum: { refundAmount: true, restockingFee: true } });
    ok((totalBack._sum.refundAmount ?? 0) + (totalBack._sum.restockingFee ?? 0) <= order1.total - order1.shipping, "never more than the goods charged on the order");

    // ── 9. Exchange → zero-value replacement order, stock taken ──
    const o3 = await order(alice, [{ variantId: A.id, quantity: 1 }]);
    await deliver(o3.id);
    const ex = await req(o3, [{ orderItemId: line(o3, A), quantity: 1 }], { preferred: "EXCHANGE", reason: "Damaged in transit" });
    await R.approveReturn(staff, ex.id);
    const exItem = await db.returnItem.findFirstOrThrow({ where: { returnId: ex.id } });
    const aBeforeEx = await stock(A.id);
    await R.receiveReturn(staff, ex.id, [{ itemId: exItem.id, condition: "RESELLABLE", restock: true }]);
    const out = await R.resolveReturn(staff, ex.id, { resolution: "EXCHANGE" });
    const exDone = await db.returnRequest.findUniqueOrThrow({ where: { id: ex.id } });
    const repl = await db.order.findUniqueOrThrow({ where: { id: exDone.exchangeOrderId! }, include: { items: true, payments: true } });
    ok(exDone.status === "EXCHANGED" && out.replacement?.id === repl.id, `exchanged → replacement ${repl.number}`);
    ok(repl.total === 0 && repl.status === "PAID" && repl.items.length === 1 && repl.items[0].unitPrice === 0 && repl.items[0].quantity === 1 && repl.userId === alice.id && !repl.payments.length, "replacement is a zero-value, ready-to-pack order");
    ok((await stock(A.id)) === aBeforeEx, "restocked unit +1, replacement −1 → net unchanged");
    ok((await db.inventoryLog.count({ where: { orderId: repl.id, reason: "SALE", delta: -1 } })) === 1, "replacement stock logged as a sale");

    // ── 10. Provider failure rolls everything back ──
    const o4 = await order(alice, [{ variantId: A.id, quantity: 1 }]);
    await deliver(o4.id);
    await db.payment.updateMany({ where: { orderId: o4.id }, data: { provider: "RAZORPAY", status: "CAPTURED", raw: {} } }); // no payment id → provider call throws
    const pf = await req(o4, [{ orderItemId: line(o4, A), quantity: 1 }]);
    await R.approveReturn(staff, pf.id);
    const pfItem = await db.returnItem.findFirstOrThrow({ where: { returnId: pf.id } });
    await R.receiveReturn(staff, pf.id, [{ itemId: pfItem.id, condition: "RESELLABLE", restock: false }]);
    const ptsPf = (await db.user.findUniqueOrThrow({ where: { id: alice.id } })).loyaltyPoints;
    const pfErr = await err(() => R.resolveReturn(staff, pf.id, { resolution: "REFUND" }));
    const pfAfter = await db.returnRequest.findUniqueOrThrow({ where: { id: pf.id } });
    ok(pfErr !== null && pfAfter.status === "RECEIVED" && pfAfter.refundAmount === null && (await db.user.findUniqueOrThrow({ where: { id: alice.id } })).loyaltyPoints === ptsPf, `provider refund failure → nothing changed (${pfErr})`);

    // ── 11. Non-returnable categories ──
    await R.saveReturnSettings({ enabled: true, windowDays: 14, restockingFeePercent: 10, nonReturnableCategories: [tag] });
    const o5 = await order(alice, [{ variantId: B.id, quantity: 1 }]);
    await deliver(o5.id);
    const blockedElig = await R.getReturnEligibility(o5.id);
    const blocked = await err(() => req(o5, [{ orderItemId: line(o5, B), quantity: 1 }]));
    ok(Boolean(blockedElig?.lines[0].blocked) && blockedElig?.lines[0].returnable === 0 && Boolean(blocked?.includes("can’t be returned")), `non-returnable category refused: “${blocked}”`);
    await R.saveReturnSettings({ enabled: false, windowDays: 14, restockingFeePercent: 0, nonReturnableCategories: [] });
    ok(Boolean((await R.getReturnEligibility(o5.id))?.problem?.includes("paused")), "returns can be switched off");
  } finally {
    // ── Clean up ── (runs even after a failure)
    const orders = await db.order.findMany({ where: { OR: [{ email: { endsWith: `@${DOMAIN}` } }, { userId: { in: userIds } }] }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    const returns = await db.returnRequest.findMany({ where: { orderId: { in: orderIds } }, select: { id: true, giftCardId: true } });
    await db.giftCard.deleteMany({ where: { id: { in: returns.flatMap((r) => (r.giftCardId ? [r.giftCardId] : [])) } } });
    await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: returns.map((r) => r.id) } }] } });
    await db.inventoryLog.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.order.deleteMany({ where: { id: { in: orderIds } } }); // returns, items, events, payments cascade
    await db.cart.deleteMany({ where: { OR: [{ id: { in: cartIds } }, { userId: { in: userIds } }] } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.staffRole.deleteMany({ where: { name: { startsWith: tag } } });
    await db.product.delete({ where: { id: product.id } }); // variants + their logs cascade
    await db.category.delete({ where: { id: category.id } });
    if (settingsBefore) await db.setting.update({ where: { key: R.RETURN_SETTINGS_KEY }, data: { value: settingsBefore.value ?? {} } });
    else await db.setting.deleteMany({ where: { key: R.RETURN_SETTINGS_KEY } });

    const realAfter = await db.productVariant.findMany({ select: { id: true, stock: true, reserved: true } });
    const key = (v: { id: string; stock: number; reserved: number }) => `${v.id}:${v.stock}:${v.reserved}`;
    ok(JSON.stringify(realAfter.map(key).sort()) === JSON.stringify(realVariantsBefore.map(key).sort()), "real catalogue stock unchanged; test variants removed");
    const countsAfter = await Promise.all([db.returnRequest.count(), db.giftCard.count(), db.order.count()]);
    ok(countsAfter.join() === countsBefore.join(), `no returns, gift cards or orders left behind (${countsAfter.join("/")})`);
    console.log("cleaned up");
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
