// WhatsApp, COD verification and RTO risk checks against the local database, in WhatsApp mock mode (nothing is sent):
// phone normalisation, consent + STOP, webhook verify challenge + signature, idempotent inbound confirmation, delivery
// receipts, the signed single-use expiring confirmation link, reminders + auto-cancel releasing stock, risk scoring,
// COD blocked above the risk threshold / value limit, the notification hub and permission denial.
// Creates its own category/product/users/orders and removes them; restores settings it touches.
// Run: npm run test:whatsapp
import "./no-real-email";
import "dotenv/config";
import { createHmac } from "node:crypto";

export {};

const DOMAIN = "whatsapp-check.invalid";
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};

async function main() {
  const { db } = await import("@/server/db");
  const { cartInclude, cartLines } = await import("@/server/cart-lines");
  const { placeOrder, advanceOrder, CheckoutError } = await import("@/server/orders");
  const I = await import("@/server/integrations");
  const { normalizePhone, looksFakePhone } = await import("@/server/whatsapp/phone");
  const { canMessage, recordOptIn } = await import("@/server/whatsapp/messages");
  const { whatsappMode } = await import("@/server/whatsapp/client");
  const { sendAbandonedBagWhatsApp } = await import("@/server/whatsapp/abandoned");
  const { resendOrderNotice } = await import("@/server/whatsapp/admin");
  const route = await import("@/app/api/webhooks/whatsapp/route");
  const cod = await import("@/server/cod");
  const { codToken } = await import("@/server/cod-token");
  const risk = await import("@/server/risk");
  const { notifyOrderStatus } = await import("@/server/notify");
  const { setJourneyEmails } = await import("@/server/marketing");
  const { resolvePermissions } = await import("@/lib/permissions");

  const tag = `wachk${Date.now().toString(36)}`;
  const email = (who: string) => `${who}-${tag}@${DOMAIN}`;
  const rnd = () => String(Math.floor(Math.random() * 1e9)).padStart(9, "1");
  const newPhone = () => `+91 9${rnd()}`;
  const userIds: string[] = [];
  const cartIds: string[] = [];
  const phones = new Set<string>();

  // ── Snapshot what we touch ──
  const WA_KEY = "integration:whatsapp";
  const [waBefore, riskBefore, codFlagBefore] = await Promise.all([
    db.setting.findUnique({ where: { key: WA_KEY } }),
    db.setting.findUnique({ where: { key: risk.RISK_SETTINGS_KEY } }),
    db.featureFlag.findUnique({ where: { key: "cod" } }),
  ]);
  const realVariantsBefore = await db.productVariant.findMany({ select: { id: true, stock: true, reserved: true } });

  // ── Fixtures ──
  const category = await db.category.create({ data: { slug: tag, name: `${tag} Attars`, tagline: "t", description: "t", ambient: "GLOW" } });
  const product = await db.product.create({ data: { slug: tag, name: `${tag} Oud`, subtitle: "t", story: "t", categoryId: category.id, family: "WOODY", model: "OIL" } });
  const V = await db.productVariant.create({ data: { productId: product.id, sku: `${tag}-A`.toUpperCase(), label: "12 ml", price: 120000, stock: 40, position: 0 } });
  const stock = async () => (await db.productVariant.findUniqueOrThrow({ where: { id: V.id } })).stock;

  const newUser = async (who: string, role: "CUSTOMER" | "SUPPORT" | "OWNER" = "CUSTOMER", phone?: string) => {
    const u = await db.user.create({ data: { email: email(who), name: `WA ${who}`, role, phone } });
    userIds.push(u.id);
    return u;
  };
  const addr = (phone: string, postalCode = "110001") => {
    phones.add(normalizePhone(phone) ?? phone);
    return { fullName: "Asha Verma", phone, line1: "1 Janpath", city: "New Delhi", state: "DL", postalCode, country: "IN" };
  };
  const place = async (o: { user?: { id: string; email: string } | null; email?: string; phone: string; postalCode?: string; qty?: number; optIn?: boolean; provider?: "COD" | "STRIPE"; storefront?: boolean }) => {
    const mail = o.user?.email ?? o.email ?? email("guest");
    const c = await db.cart.create({ data: { email: mail, items: { create: [{ variantId: V.id, quantity: o.qty ?? 1 }] } } });
    cartIds.push(c.id);
    const cart = await db.cart.findUniqueOrThrow({ where: { id: c.id }, include: cartInclude });
    const { order } = await placeOrder({
      cart,
      lines: await cartLines(cart),
      userId: o.user?.id ?? null,
      email: mail,
      address: addr(o.phone, o.postalCode),
      shippingRateId: "ship-in",
      provider: o.provider ?? "COD",
      pointsRequested: 0,
      giftWrap: false,
      ...(o.storefront === false ? {} : { storefront: { whatsappOptIn: o.optIn ?? true } }),
    });
    return db.order.findUniqueOrThrow({ where: { id: order.id } });
  };
  const err = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return null;
    } catch (e) {
      return e;
    }
  };
  const sign = (body: string, secret = "wa-app-secret-test") => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const post = (body: string, sig: string | null) =>
    route.POST(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", body, headers: sig ? { "x-hub-signature-256": sig } : {} }));
  const inbound = (from: string, m: Record<string, unknown>) =>
    JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", messages: [{ from: from.replace("+", ""), timestamp: "1", ...m }] } }] }] });
  const receipt = (id: string, status: string) =>
    JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: { statuses: [{ id, status, timestamp: "1", recipient_id: "1" }] } }] }] });
  const wamid = () => `wamid.${tag}.${Math.random().toString(36).slice(2)}`;

  try {
    // Webhook secrets + defaults; mock mode is forced by no-real-email (WHATSAPP_TRANSPORT=log).
    await I.saveIntegration("whatsapp", { enabled: false, appSecret: "wa-app-secret-test", verifyToken: "wa-verify-test" });
    I.forgetIntegrations();
    await db.featureFlag.upsert({ where: { key: "cod" }, update: { enabled: true }, create: { key: "cod", enabled: true, description: "Cash on delivery" } });
    const owner = { id: (await newUser("owner", "OWNER")).id, permissions: resolvePermissions("OWNER", null) };
    const support = { id: (await newUser("support", "SUPPORT")).id, permissions: resolvePermissions("SUPPORT", null) };
    const customer = await newUser("alice", "CUSTOMER");
    const customerActor = { id: customer.id, permissions: resolvePermissions("CUSTOMER", null) };
    const packerRole = await db.staffRole.create({ data: { name: `${tag} packer`, permissions: ["orders.fulfil"] } });
    const packer = { id: support.id, permissions: resolvePermissions("SUPPORT", packerRole.permissions) };
    await risk.saveRiskSettings(owner, { codBlockRiskAbove: 70, codMaxOrderValue: 2_500_000, codFee: 0, prepaidIncentive: "none", confirmWithinHours: 24, reminderBeforeHours: 6 });

    ok((await whatsappMode()) === "mock", "test runs are always in WhatsApp mock mode");

    // ── 1. Phone normalisation ──
    const cases: [string, string | null][] = [
      ["98765 43210", "+919876543210"],
      ["+91 98765-43210", "+919876543210"],
      ["09876543210", "+919876543210"],
      ["919876543210", "+919876543210"],
      ["0091 98765 43210", "+919876543210"],
      ["12345", null],
      ["5876543210", null],
      ["abc9876543210", null],
      ["+44 7700 900123", "+447700900123"],
    ];
    ok(cases.every(([i, o]) => normalizePhone(i) === o), "phone normalisation to E.164 (+91 default, 0/91/+91/00 prefixes, rejects junk)");
    ok(normalizePhone("050 123 4567", "AE") === "+971501234567", "other countries use their calling code");
    ok(looksFakePhone("+919999999999") && looksFakePhone("+919000000001") && !looksFakePhone("+919812734650"), "obviously fake numbers are flagged");

    // ── 2. COD order placed → awaiting confirmation, consent recorded, WhatsApp request recorded ──
    const p1 = newPhone();
    const e1 = normalizePhone(p1)!;
    const s0 = await stock();
    const o1 = await place({ user: customer, phone: p1 });
    ok(o1.codStatus === "AWAITING" && o1.codConfirmBy !== null && Math.abs(o1.codConfirmBy.getTime() - Date.now() - 24 * 3600_000) < 120_000, "storefront COD order awaits confirmation (deadline +24h)");
    ok(o1.riskScore !== null && Array.isArray(o1.riskReasons) && o1.whatsappOptIn, `risk score stored with reasons (score ${o1.riskScore}); WhatsApp opt-in on the order`);
    const contact = await db.whatsAppContact.findUnique({ where: { phone: e1 } });
    ok(Boolean(contact?.optedIn && contact.consentAt && contact.source === "checkout"), "checkout opt-in stored per phone with a consent timestamp");
    const req1 = await db.whatsAppMessage.findFirst({ where: { orderId: o1.id, kind: "cod_confirm" } });
    const vars1 = req1?.vars as { body: string[]; buttons: string[] } | null;
    ok(req1?.test === true && req1.status === "SENT" && req1.phone === e1 && vars1?.buttons[0] === `CONFIRM:${o1.id}` && vars1.body[3].includes("/order/confirm/"), "COD confirmation request recorded in test mode with Confirm/Cancel buttons + web link");
    ok((await stock()) === s0 - 1, "stock is committed while awaiting confirmation");
    const held = await err(() => advanceOrder(o1.id, "PACKED"));
    ok(held instanceof Error && /awaiting the customer/.test(held.message) && cod.codHold(o1), "fulfilment refuses to pack an unconfirmed COD order (codHold)");

    // ── 3. Webhook: GET verify + signature ──
    const get = (q: string) => route.GET(new Request(`http://localhost/api/webhooks/whatsapp?${q}`));
    const g1 = await get("hub.mode=subscribe&hub.verify_token=wa-verify-test&hub.challenge=8675309");
    const g2 = await get("hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=8675309");
    ok(g1.status === 200 && (await g1.text()) === "8675309" && g2.status === 403, "GET verification echoes hub.challenge only for the saved verify token");
    const noop = receipt("wamid.nothing", "delivered");
    ok((await post(noop, sign(noop))).status === 200, "POST with a valid X-Hub-Signature-256 is accepted");
    ok((await post(noop, sign(noop, "other-secret"))).status === 401 && (await post(noop, null)).status === 401 && (await post(noop + " ", sign(noop))).status === 401, "wrong secret, missing header or altered body → 401");

    // ── 4. Delivery receipts move forward only ──
    const w1 = req1!.waMessageId!;
    for (const st of ["delivered", "read", "delivered"]) {
      const b = receipt(w1, st);
      await post(b, sign(b));
    }
    ok((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: req1!.id } })).status === "READ", "delivery receipts update status (sent → delivered → read; a late 'delivered' doesn't regress)");

    // ── 5. Inbound button confirm, idempotent ──
    const confirmId = wamid();
    const btn = inbound(e1, { id: confirmId, type: "button", button: { payload: `CONFIRM:${o1.id}`, text: "Confirm" } });
    const r1 = await post(btn, sign(btn));
    const r2 = await post(btn, sign(btn)); // Meta retry
    const j2 = (await r2.json()) as { duplicates: number };
    const yes = inbound(e1, { id: wamid(), type: "text", text: { body: "yes" } });
    await post(yes, sign(yes)); // a typed YES afterwards
    const after1 = await db.order.findUniqueOrThrow({ where: { id: o1.id } });
    const confirmEvents = await db.orderEvent.count({ where: { orderId: o1.id, message: { startsWith: "Cash on delivery confirmed" } } });
    ok(r1.status === 200 && after1.codStatus === "CONFIRMED" && after1.codConfirmedVia === "whatsapp" && after1.codTokenHash === null, "WhatsApp Confirm button confirms the COD order (link invalidated)");
    ok(j2.duplicates === 1 && confirmEvents === 1 && (await db.whatsAppMessage.count({ where: { waMessageId: confirmId } })) === 1, "replayed webhook + extra YES are idempotent (one confirmation event)");
    ok((await db.whatsAppMessage.count({ where: { orderId: o1.id, kind: "order_confirmed" } })) === 1, "confirmation sends the order-confirmed template once");
    const forged = inbound(newPhone(), { id: wamid(), type: "button", button: { payload: `CANCEL:${o1.id}`, text: "Cancel" } });
    await post(forged, sign(forged));
    ok((await db.order.findUniqueOrThrow({ where: { id: o1.id } })).status === "PENDING", "a button payload from another phone can't act on the order");

    // ── 6. Notification hub: shipped (tracking link) / delivered (review link), once each ──
    await advanceOrder(o1.id, "PACKED");
    await advanceOrder(o1.id, "SHIPPED", { trackingNumber: "AWB123", carrier: "Delhivery" });
    await notifyOrderStatus(o1.id, "shipped"); // e.g. the courier sync firing too
    const shipped = await db.whatsAppMessage.findMany({ where: { orderId: o1.id, kind: "shipped" } });
    ok(shipped.length === 1 && JSON.stringify(shipped[0].vars).includes("/track?order=") && JSON.stringify(shipped[0].vars).includes("Delhivery"), "shipped → one WhatsApp with courier + tracking link (duplicate trigger ignored)");
    await notifyOrderStatus(o1.id, "out_for_delivery");
    const ofd = await db.whatsAppMessage.findFirst({ where: { orderId: o1.id, kind: "out_for_delivery" } });
    const due = (ofd?.vars as { body: string[] } | null)?.body[2] ?? "";
    ok(due.replace(/\D/g, "") === String(o1.total / 100), `out for delivery → amount to pay on delivery (${due})`);
    await advanceOrder(o1.id, "DELIVERED");
    const delivered = await db.whatsAppMessage.findFirst({ where: { orderId: o1.id, kind: "delivered" } });
    ok(Boolean(delivered && JSON.stringify(delivered.vars).includes(`/product/${tag}#reviews`)), "delivered → WhatsApp with a review link");

    // ── 7. STOP / START ──
    const stop = inbound(e1, { id: wamid(), type: "text", text: { body: "STOP" } });
    await post(stop, sign(stop));
    const c2 = await db.whatsAppContact.findUniqueOrThrow({ where: { phone: e1 } });
    ok(!c2.optedIn && c2.optedOutAt !== null && !(await canMessage(e1, "transactional")) && !(await canMessage(e1, "marketing")), "replying STOP opts the phone out");
    const ack = await db.whatsAppMessage.findFirst({ where: { phone: e1, kind: "text", body: { contains: "unsubscribed" } } });
    ok(Boolean(ack), "STOP is acknowledged once");
    const resendAfterStop = await err(() => resendOrderNotice(owner, o1.id, "delivered"));
    ok(resendAfterStop instanceof Error && /opted out/.test(resendAfterStop.message), "no messages after STOP, even on a staff resend");
    const start = inbound(e1, { id: wamid(), type: "text", text: { body: "START" } });
    await post(start, sign(start));
    ok(await canMessage(e1, "transactional"), "START opts back in");

    // ── 8. Web link: signed, single use, expiring; viewing doesn't consume ──
    const p2 = newPhone();
    const o2 = await place({ email: email("linky"), phone: p2, optIn: false });
    const t2 = codToken(o2.id);
    ok((await db.whatsAppMessage.count({ where: { orderId: o2.id } })) === 0, "no WhatsApp without opt-in (email + link only)");
    const peek = await cod.peekCodLink(t2);
    const peekAgain = await cod.peekCodLink(t2);
    ok(peek.state === "awaiting" && peekAgain.state === "awaiting", "opening the link shows the order without confirming it");
    ok((await cod.peekCodLink(t2.slice(0, -2) + "xx")).state === "invalid" && (await cod.answerCodLink(`${Buffer.from(o1.id).toString("base64url")}.${t2.split(".")[1]}`, "confirm")) === "invalid", "tampered / cross-order tokens are rejected");
    ok((await cod.answerCodLink(t2, "confirm")) === "confirmed", "the link confirms the order");
    ok((await cod.answerCodLink(t2, "cancel")) === "already_confirmed" && (await db.order.findUniqueOrThrow({ where: { id: o2.id } })).status === "PENDING", "the link is single use (a second answer changes nothing)");
    const o3 = await place({ email: email("late"), phone: newPhone(), optIn: false });
    await db.order.update({ where: { id: o3.id }, data: { codConfirmBy: new Date(Date.now() - 60_000) } });
    ok((await cod.answerCodLink(codToken(o3.id), "confirm")) === "expired" && (await cod.peekCodLink(codToken(o3.id))).state === "expired", "an expired link is refused");

    // ── 9. Reminder, then auto-cancel releases stock ──
    const p4 = newPhone();
    const before4 = await stock();
    const o4 = await place({ email: email("sleepy"), phone: p4, qty: 2 });
    ok((await stock()) === before4 - 2, "2 units committed for the unconfirmed order");
    await db.order.update({ where: { id: o4.id }, data: { codConfirmBy: new Date(Date.now() + 3600_000) } });
    const sweep1 = await cod.runCodSweep(new Date(), { orderIds: [o4.id, o3.id] });
    const sweep1b = await cod.runCodSweep(new Date(), { orderIds: [o4.id] });
    ok(sweep1.reminded === 1 && sweep1b.reminded === 0 && (await db.whatsAppMessage.count({ where: { orderId: o4.id, kind: "cod_reminder" } })) === 1, "reminder sent once before the deadline");
    ok(sweep1.cancelled === 1 && (await db.order.findUniqueOrThrow({ where: { id: o3.id } })).status === "CANCELLED", "an expired confirmation is cancelled by the sweep");
    const beforeSweep2 = await stock();
    const sweep2 = await cod.runCodSweep(new Date(Date.now() + 2 * 3600_000), { orderIds: [o4.id] });
    const o4a = await db.order.findUniqueOrThrow({ where: { id: o4.id } });
    ok(sweep2.cancelled === 1 && o4a.status === "CANCELLED" && o4a.codStatus === "CANCELLED" && (await stock()) === beforeSweep2 + 2, "unconfirmed after N hours → auto-cancelled, stock released");
    ok((await db.whatsAppMessage.count({ where: { orderId: o4.id, kind: "cancelled" } })) === 1, "customer told about the auto-cancel");
    ok((await cod.answerCodLink(codToken(o4.id), "confirm")) !== "confirmed", "a cancelled order can't be confirmed afterwards");

    // ── 10. Staff call outcome + permissions ──
    const o5 = await place({ email: email("caller"), phone: newPhone(), optIn: false });
    const denied1 = await err(() => cod.staffCodOutcome(customerActor, o5.id, "confirmed"));
    const denied2 = await err(() => cod.staffCodOutcome(packer, o5.id, "cancelled"));
    const denied3 = await err(() => risk.saveRiskSettings(support, { codFee: 100 }));
    const denied4 = await err(() => resendOrderNotice(customerActor, o1.id, "delivered"));
    ok([denied1, denied2, denied3, denied4].every((d) => d instanceof risk.PermissionError), "permission denied: customer confirming, packer cancelling, support editing risk rules, customer resending");
    ok((await cod.staffCodOutcome(support, o5.id, "no_answer", "rang twice")) === "noted", "staff can log an unanswered call");
    ok((await cod.staffCodOutcome(support, o5.id, "confirmed", "spoke to Asha")) === "confirmed" && (await db.order.findUniqueOrThrow({ where: { id: o5.id } })).codConfirmedVia === "staff", "staff can confirm on a call");
    ok((await db.auditLog.count({ where: { actorId: support.id, entityId: o5.id } })) === 2, "staff COD actions are audited");

    // ── 11. Risk scoring ──
    const base = { email: email("fresh"), phone: newPhone(), postalCode: `7${rnd().slice(0, 5)}`, amount: 120000 };
    const fresh = await risk.scoreRisk(base);
    ok(fresh.reasons.some((r) => r.code === "new_customer") && fresh.score === 15, `new customer → 15 (${fresh.score})`);
    const bad = await risk.scoreRisk({ ...base, phone: "12345", email: `x-${tag}@mailinator.com` });
    ok(["invalid_phone", "disposable_email"].every((c) => bad.reasons.some((r) => r.code === c)), `invalid phone + disposable email (${bad.score}: ${bad.reasons.map((r) => r.code).join(",")})`);
    const repeat = await risk.scoreRisk({ email: email("sleepy"), phone: p4, postalCode: "110001", amount: 120000 });
    ok(repeat.reasons.some((r) => r.code === "past_rto"), `a past cancelled COD order counts against the customer (${repeat.score})`);
    const returning = await risk.scoreRisk({ email: customer.email, phone: p1, postalCode: "110001", amount: 120000, userId: customer.id });
    ok(!returning.reasons.some((r) => r.code === "new_customer"), "a customer with a delivered order isn't 'new'");
    const accountUser = await newUser("acct", "CUSTOMER", "+919812734650");
    const mismatch = await risk.scoreRisk({ ...base, userId: accountUser.id });
    ok(mismatch.reasons.some((r) => r.code === "phone_mismatch"), "phone different from the account's → flagged");
    const high = await risk.scoreRisk({ ...base, amount: 2_000_000 });
    ok(high.reasons.some((r) => r.code === "high_value"), "high COD value flagged");
    const vEmail = email("velocity");
    const vPhone = newPhone();
    for (let i = 0; i < 2; i++) await place({ email: vEmail, phone: vPhone, storefront: false });
    const vel = await risk.scoreRisk({ email: vEmail, phone: vPhone, postalCode: "110001", amount: 120000 });
    ok(vel.reasons.some((r) => r.code === "velocity"), "many orders in 24 hours flagged");
    const pin = `9${rnd().slice(0, 5)}`;
    for (let i = 0; i < 3; i++) {
      const o = await place({ email: email(`pin${i}`), phone: newPhone(), postalCode: pin, optIn: false });
      if (i < 2) await cod.cancelCod(o.id, "staff", "test refusal");
    }
    const pinRisk = await risk.scoreRisk({ ...base, postalCode: pin });
    const stats = await risk.pincodeStats(180, 500);
    ok(pinRisk.reasons.some((r) => r.code === "pincode_rto") && stats.some((s) => s.pin === pin && s.total === 3 && s.failed === 2), "pincode with a high COD failure rate flagged (and shown in pincode stats)");
    const capped = await risk.scoreRisk({ ...base, email: `y-${tag}@yopmail.com`, phone: "999", amount: 3_000_000, postalCode: pin });
    ok(capped.score <= 100 && capped.score >= 70, `score stays within 0–100 (${capped.score})`);

    // ── 12. COD blocked above the threshold / value / blocklist; COD fee applied ──
    await risk.saveRiskSettings(owner, { codBlockRiskAbove: 40, codMaxOrderValue: 200_000, codFee: 4900, prepaidIncentive: "percent", prepaidPercent: 5, blockedPincodes: ["560099"] });
    const riskyTry = await err(() => place({ email: `z-${tag}@mailinator.com`, phone: "12345 67", optIn: false }));
    ok(riskyTry instanceof CheckoutError && /pay online/i.test(riskyTry.message) && /5% off/.test(riskyTry.message), `COD refused above the risk threshold with a friendly message (“${(riskyTry as Error)?.message}”)`);
    const bigTry = await err(() => place({ email: email("big"), phone: newPhone(), qty: 2 }));
    ok(bigTry instanceof CheckoutError && /up to ₹2,000/.test(bigTry.message), "COD refused above the max order value");
    const pinTry = await err(() => place({ email: email("blockedpin"), phone: newPhone(), postalCode: "560099" }));
    ok(pinTry instanceof CheckoutError && /pincode/.test(pinTry.message), "COD refused for a blocklisted pincode");
    const decision = await risk.codDecision({ email: `z-${tag}@mailinator.com`, phone: "12345 67", postalCode: "110001", amount: 120000 });
    ok(!decision.allowed && decision.incentive === "5% off", "checkout gets 'COD unavailable' + the prepaid incentive");
    const feeOrder = await place({ email: email("fee"), phone: newPhone(), postalCode: `8${rnd().slice(0, 5)}`, optIn: false });
    const shipRate = (await db.shippingRate.findUniqueOrThrow({ where: { id: "ship-in" } })).price;
    ok(feeOrder.total === 120000 + shipRate + 4900 && feeOrder.shipping === shipRate + 4900, `COD fee added to the order (${feeOrder.total})`);
    const prepaid = { subtotal: 120000, discount: 0, pointsValue: 0, shipping: 0, tax: 18305, total: 120000, giftCardApplied: 0, payable: 120000 };
    const adj = risk.applyStorefrontRules(prepaid, { provider: "ONLINE", goodsSubtotal: 120000, giftCardBalance: 0, settings: await risk.getRiskSettings(), taxRatePercent: 18, taxInclusive: true });
    ok(adj.adjust.prepaidDiscount === 6000 && adj.pricing.payable === 114000, "pay-online incentive: 5% off the goods");

    // ── 13. Abandoned bag: consent, marketing opt-out, once per bag, frequency cap ──
    const shopper = await newUser("shopper", "CUSTOMER");
    const sp = normalizePhone(newPhone())!;
    phones.add(sp);
    await recordOptIn(sp, { email: shopper.email, userId: shopper.id });
    const bag = await db.cart.create({ data: { userId: shopper.id, items: { create: [{ variantId: V.id, quantity: 1 }] } } });
    cartIds.push(bag.id);
    const later = new Date(Date.now() + 4 * 3600_000);
    const a1 = await sendAbandonedBagWhatsApp(later, { cartIds: [bag.id] });
    const a2 = await sendAbandonedBagWhatsApp(later, { cartIds: [bag.id] });
    ok(a1.sent === 1 && a2.sent === 0, "abandoned bag → one WhatsApp per bag to a consented phone");
    const bag2 = await db.cart.create({ data: { email: shopper.email, items: { create: [{ variantId: V.id, quantity: 1 }] } } });
    cartIds.push(bag2.id);
    ok((await sendAbandonedBagWhatsApp(later, { cartIds: [bag2.id] })).sent === 0, "frequency cap: no second marketing message to the same phone within the window");
    const nobody = await newUser("noconsent", "CUSTOMER", newPhone());
    const bag3 = await db.cart.create({ data: { userId: nobody.id, items: { create: [{ variantId: V.id, quantity: 1 }] } } });
    cartIds.push(bag3.id);
    ok((await sendAbandonedBagWhatsApp(later, { cartIds: [bag3.id] })).sent === 0, "no consent → no abandoned-bag WhatsApp");
    await db.whatsAppMessage.deleteMany({ where: { cartId: bag.id } });
    await setJourneyEmails(shopper.email, false, "account");
    ok((await sendAbandonedBagWhatsApp(later, { cartIds: [bag.id] })).sent === 0, "marketing opt-out is respected");
  } finally {
    // ── Clean up ── (runs even after a failure)
    const orders = await db.order.findMany({ where: { OR: [{ email: { endsWith: `@${DOMAIN}` } }, { email: { startsWith: "z-" + tag } }, { userId: { in: userIds } }] }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    await db.whatsAppMessage.deleteMany({ where: { OR: [{ orderId: { in: orderIds } }, { cartId: { in: cartIds } }, { phone: { in: [...phones] } }, { waMessageId: { startsWith: `wamid.${tag}` } }] } });
    await db.whatsAppContact.deleteMany({ where: { OR: [{ phone: { in: [...phones] } }, { email: { endsWith: `@${DOMAIN}` } }] } });
    await db.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await db.inventoryLog.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.loyaltyEntry.deleteMany({ where: { userId: { in: userIds } } });
    await db.order.deleteMany({ where: { id: { in: orderIds } } });
    await db.cart.deleteMany({ where: { OR: [{ id: { in: cartIds } }, { userId: { in: userIds } }] } });
    await db.marketingPreference.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.staffRole.deleteMany({ where: { name: { startsWith: tag } } });
    await db.product.delete({ where: { id: product.id } });
    await db.category.delete({ where: { id: category.id } });
    const restore = async (key: string, row: { value: unknown } | null) => {
      if (row) await db.setting.upsert({ where: { key }, update: { value: row.value as object }, create: { key, value: row.value as object } });
      else await db.setting.deleteMany({ where: { key } });
    };
    await restore(WA_KEY, waBefore);
    await restore(risk.RISK_SETTINGS_KEY, riskBefore);
    if (codFlagBefore) await db.featureFlag.update({ where: { key: "cod" }, data: { enabled: codFlagBefore.enabled } });
    else await db.featureFlag.deleteMany({ where: { key: "cod" } });
    I.forgetIntegrations();

    // Compare only variants that existed before (other check scripts may be creating/removing their own meanwhile).
    const realAfter = new Map((await db.productVariant.findMany({ select: { id: true, stock: true, reserved: true } })).map((v) => [v.id, v]));
    ok(realVariantsBefore.every((v) => !realAfter.has(v.id) || (realAfter.get(v.id)!.stock === v.stock && realAfter.get(v.id)!.reserved === v.reserved)) && !realAfter.has(V.id), "real catalogue stock unchanged; test variant removed");
    const left = await Promise.all([
      db.order.count({ where: { OR: [{ email: { endsWith: `@${DOMAIN}` } }, { id: { in: orderIds } }] } }),
      db.whatsAppMessage.count({ where: { OR: [{ phone: { in: [...phones] } }, { orderId: { in: orderIds } }, { waMessageId: { startsWith: `wamid.${tag}` } }] } }),
      db.whatsAppContact.count({ where: { OR: [{ phone: { in: [...phones] } }, { email: { endsWith: `@${DOMAIN}` } }] } }),
    ]);
    ok(left.every((n) => n === 0), `no test orders, WhatsApp messages or contacts left behind (${left.join("/")})`);
    console.log("cleaned up");
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
