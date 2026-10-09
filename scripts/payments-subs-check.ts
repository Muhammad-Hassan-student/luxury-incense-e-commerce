// Payments-from-database, server-side conversion events and Subscribe & Save checks against the local database.
// No network: payment calls are never made (renewals go down the pay-link path) and tracking uses a mocked fetch.
// Creates its own user/orders/subscriptions, restores integration + settings rows and stock. Run: npm run test:subs
import "./no-real-email";
import "dotenv/config";
import { createHmac } from "node:crypto";

export {};

// Env fallbacks for the "database overrides env" checks — set before any app module reads the environment.
process.env.STRIPE_SECRET_KEY = "sk_test_env_fallback_000";
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_env_fallback_000";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_env_fallback_000";
process.env.RAZORPAY_KEY_ID = "rzp_test_envfallback";
process.env.RAZORPAY_KEY_SECRET = "env_key_secret_000";
process.env.RAZORPAY_WEBHOOK_SECRET = "env_webhook_secret_000";

const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};
const DOMAIN = "subs-check.invalid";
const hmac = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");

(async () => {
  const { db } = await import("@/server/db");
  const I = await import("@/server/integrations");
  const P = await import("@/server/payments");
  const T = await import("@/server/tracking");
  const S = await import("@/server/subscriptions");
  const O = await import("@/server/orders");
  const { cartInclude, cartLines } = await import("@/server/cart-lines");
  const { reserve } = await import("@/server/inventory");
  const { purchaseEventId } = await import("@/lib/analytics-shared");
  const Stripe = (await import("stripe")).default;

  const KEYS = ["integration:stripe", "integration:razorpay", "integration:pixels", "subscriptions"];
  const saved = await db.setting.findMany({ where: { key: { in: KEYS } } });
  const variant = await db.productVariant.findUniqueOrThrow({ where: { sku: "NAG-CHAMPA-NOIR-20-STICKS" } });
  const before = { stock: variant.stock, reserved: variant.reserved };
  const userIds: string[] = [];
  const cartIds: string[] = [];
  const webhookIds: string[] = [];
  const addr = { fullName: "Asha Rao", phone: "98765 43210", line1: "1 MG Road", city: "Bengaluru", state: "KA", postalCode: "560001", country: "IN" };

  // Network mock for GA4 / Meta.
  const calls: { url: string; body: unknown }[] = [];
  T.setTrackingFetch(async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => (url.includes("graph.facebook.com") ? '{"events_received":1}' : "") };
  });

  try {
    await db.setting.deleteMany({ where: { key: { in: KEYS } } });
    I.forgetIntegrations();

    // ── 1. Keys: env fallback, database overrides ──
    let s = await I.getIntegration("stripe");
    ok(s.secretKey === "sk_test_env_fallback_000" && s.publishableKey === "pk_test_env_fallback_000", "nothing saved → Stripe keys fall back to env");
    let prov = await P.paymentProviders();
    ok(prov.stripe && prov.razorpay && prov.razorpayKeyId === "rzp_test_envfallback" && prov.stripePublishableKey === "pk_test_env_fallback_000", "providers enabled from env fallback; public keys exposed, secrets not");
    ok(!JSON.stringify(prov).includes("env_key_secret_000") && !JSON.stringify(prov).includes("sk_test_env"), "paymentProviders() never carries a secret");
    const c1 = await P.stripe();
    ok(c1 === (await P.stripe()), "Stripe client is memoised per key");

    await I.saveIntegration("stripe", { secretKey: "sk_test_db_111", publishableKey: "pk_test_db_111", webhookSecret: "whsec_db_111" });
    await I.saveIntegration("razorpay", { keyId: "rzp_test_db111", keySecret: "db_key_secret_111", webhookSecret: "db_webhook_secret_111" });
    I.forgetIntegrations();
    s = await I.getIntegration("stripe");
    ok(s.secretKey === "sk_test_db_111" && s.webhookSecret === "whsec_db_111", "saved Stripe keys override env");
    prov = await P.paymentProviders();
    ok(prov.razorpayKeyId === "rzp_test_db111" && prov.stripePublishableKey === "pk_test_db_111", "browser receives the saved public keys (no NEXT_PUBLIC_* needed)");
    ok((await P.stripe()) !== c1, "a new key builds a new Stripe client");

    // ── 2. Signatures with the saved secrets ──
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_x", order_id: "order_subs_check_none", status: "captured" } } } });
    ok(await P.verifyRazorpayWebhook(body, hmac("db_webhook_secret_111", body)), "Razorpay webhook verifies with the saved secret");
    ok(!(await P.verifyRazorpayWebhook(body, hmac("env_webhook_secret_000", body))), "…and rejects the env secret once a saved one exists");
    ok(!(await P.verifyRazorpayWebhook(body + " ", hmac("db_webhook_secret_111", body))) && !(await P.verifyRazorpayWebhook(body, "zz")), "tampered body / garbage signature rejected");
    ok(await P.verifyRazorpayPayment("order_1", "pay_1", hmac("db_key_secret_111", "order_1|pay_1")), "Checkout.js signature uses the saved key secret");
    const sHeader = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: "whsec_db_111" });
    const ev = await P.verifyStripeWebhook(body, sHeader);
    ok(Boolean(ev), "Stripe webhook verifies with the saved signing secret");
    let threw = false;
    try {
      await P.verifyStripeWebhook(body, Stripe.webhooks.generateTestHeaderString({ payload: body, secret: "whsec_env_fallback_000" }));
    } catch {
      threw = true;
    }
    ok(threw, "Stripe webhook signed with another secret is rejected");

    const { POST: razorpayHook } = await import("@/app/api/webhooks/razorpay/route");
    const evId = `evt_subs_check_${Date.now()}`;
    webhookIds.push(evId);
    const bad = await razorpayHook(new Request("http://x/api/webhooks/razorpay", { method: "POST", body, headers: { "x-razorpay-signature": hmac("env_webhook_secret_000", body), "x-razorpay-event-id": evId } }));
    const good = await razorpayHook(new Request("http://x/api/webhooks/razorpay", { method: "POST", body, headers: { "x-razorpay-signature": hmac("db_webhook_secret_111", body), "x-razorpay-event-id": evId } }));
    ok(bad.status === 400 && good.status === 200, `webhook route: wrong secret → ${bad.status}, saved secret → ${good.status}`);
    const { POST: stripeHook } = await import("@/app/api/webhooks/stripe/route");
    const sBody = JSON.stringify({ id: `evt_subs_${Date.now()}`, object: "event", type: "customer.created", data: { object: {} } });
    webhookIds.push(JSON.parse(sBody).id);
    const sRes = await stripeHook(new Request("http://x/api/webhooks/stripe", { method: "POST", body: sBody, headers: { "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: sBody, secret: "whsec_db_111" }) } }));
    const sBad = await stripeHook(new Request("http://x/api/webhooks/stripe", { method: "POST", body: sBody, headers: { "stripe-signature": "t=1,v1=00" } }));
    ok(sRes.status === 200 && sBad.status === 400, `Stripe route: saved secret → ${sRes.status}, bad signature → ${sBad.status}`);

    // ── 3. Conversions API payload: hashing + event id ──
    const fake = {
      id: "o1",
      number: "MO-TEST1",
      email: "  Asha.Rao@Example.COM ",
      userId: "u1",
      currency: "INR",
      total: 123450,
      tax: 100,
      shipping: 9900,
      couponCode: null,
      placedAt: new Date("2026-01-02T03:04:05Z"),
      shippingAddress: addr,
      items: [{ variantId: "v1", sku: "SKU1", name: "Nag Champa", label: "20 sticks", unitPrice: 56775, quantity: 2 }],
    };
    const tracking = { consent: true, ip: "203.0.113.9", ua: "UA/1", fbp: "fb.1.1.123", fbc: "fb.1.1.abc" };
    const meta = T.buildMetaPurchase(fake, tracking, "TEST123");
    const ud = meta.data[0].user_data as Record<string, unknown>;
    ok((ud.em as string[])[0] === T.sha256("asha.rao@example.com"), "email: trimmed, lowercased, SHA-256");
    ok((ud.ph as string[])[0] === T.sha256("919876543210") && T.normalizePhone("+91 98765-43210") === "919876543210", "phone: digits with country code (91…), SHA-256");
    ok(/^[0-9a-f]{64}$/.test((ud.ct as string[])[0]) && ud.client_ip_address === "203.0.113.9" && ud.fbp === "fb.1.1.123" && ud.fbc === "fb.1.1.abc", "city hashed; ip/ua/fbp/fbc sent as-is");
    ok(!JSON.stringify(meta).toLowerCase().includes("asha.rao") && !JSON.stringify(meta).includes("98765"), "no plain email or phone in the CAPI payload");
    ok(meta.data[0].event_id === purchaseEventId("MO-TEST1") && meta.data[0].event_id === "purchase-MO-TEST1", "CAPI event_id = browser Purchase eventID (dedupe)");
    ok(meta.test_event_code === "TEST123" && meta.data[0].custom_data.value === 1234.5 && meta.data[0].custom_data.currency === "INR", "value in major units, currency, test code");
    const ga = T.buildGa4Purchase(fake, { consent: true, gaClientId: "111.222" });
    ok(ga.client_id === "111.222" && ga.events[0].params.transaction_id === "MO-TEST1" && ga.events[0].params.items[0].price === 567.75, "GA4 MP purchase: client id from _ga, transaction_id, item prices");
    const att = T.attributionFrom({ get: (n: string) => ({ mo_consent: { value: "denied" } })[n as "mo_consent"] }, { get: () => "1.2.3.4" });
    ok(att.consent === false && Object.keys(att).length === 1, "no consent → nothing captured at checkout");
    const att2 = T.attributionFrom({ get: (n: string) => ({ mo_consent: { value: "granted" }, _ga: { value: "GA1.1.987.654" }, _fbp: { value: "fb.1.2.3" } } as Record<string, { value: string }>)[n] }, { get: (h: string) => (h === "x-forwarded-for" ? "198.51.100.7, 10.0.0.1" : h === "user-agent" ? "UA" : null) });
    ok(att2.consent && att2.ip === "198.51.100.7" && att2.gaClientId === "987.654" && att2.fbp === "fb.1.2.3", "consent → ip (first hop), ua, _ga client id, _fbp captured");

    // ── 4. Server purchase: once per order, consent only ──
    await I.saveIntegration("pixels", { enabled: true, ga4MeasurementId: "G-TEST", ga4ApiSecret: "ga-secret", metaPixelId: "123", metaCapiToken: "meta-token", metaTestEventCode: "TEST999" });
    I.forgetIntegrations();
    const user = await db.user.create({ data: { email: `buyer@${DOMAIN}`, name: "Subs Buyer" } });
    userIds.push(user.id);

    const makeOrder = async (o: { provider: "RAZORPAY" | "STRIPE"; tracking?: object; meta?: object; qty?: number }) =>
      db.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            number: `MO-SC${Date.now() % 1e7}${Math.floor(Math.random() * 100)}`,
            userId: user.id,
            email: user.email,
            currency: "INR",
            subtotal: variant.price * (o.qty ?? 1),
            shipping: 0,
            tax: 0,
            total: variant.price * (o.qty ?? 1),
            shippingAddress: addr,
            carrier: "Standard",
            reservedUntil: new Date(Date.now() + 600_000),
            items: { create: [{ variantId: variant.id, name: "Nag Champa Noir", label: "20 sticks", sku: variant.sku, unitPrice: variant.price, quantity: o.qty ?? 1, meta: o.meta }] },
            payments: { create: { provider: o.provider, amount: variant.price * (o.qty ?? 1), currency: "INR", raw: o.tracking ? { tracking: o.tracking } : {} } },
          },
        });
        await reserve(tx, variant.id, o.qty ?? 1, created.id);
        return created;
      });

    const consented = await makeOrder({ provider: "RAZORPAY", tracking });
    calls.length = 0;
    await O.confirmOrder(consented.id, { captured: true, raw: { paymentId: "pay_subs_1" } });
    const first = calls.length;
    await O.confirmOrder(consented.id, { captured: true, raw: { paymentId: "pay_subs_1" } });
    const results = await Promise.all([T.sendServerPurchase(consented.id), T.sendServerPurchase(consented.id)]);
    ok(first === 2 && calls.length === 2, `confirmed order → exactly one GA4 + one Meta call, replays add none (${first} → ${calls.length})`);
    ok(results.every((r) => !r.sent), "concurrent re-sends are refused (claim recorded once)");
    const metaCall = calls.find((c) => c.url.includes("graph.facebook.com"));
    ok(Boolean(metaCall) && (metaCall!.body as { data: { event_id: string }[] }).data[0].event_id === purchaseEventId(consented.number) && (metaCall!.body as { test_event_code?: string }).test_event_code === "TEST999", "CAPI Purchase carries the order's event_id and test code");
    ok(calls.some((c) => c.url.includes("mp/collect") && c.url.includes("measurement_id=G-TEST")), "GA4 Measurement Protocol called with the saved measurement id");
    webhookIds.push(`purchase:${consented.id}`);

    const noConsent = await makeOrder({ provider: "RAZORPAY" });
    calls.length = 0;
    await O.confirmOrder(noConsent.id, { captured: true, raw: { paymentId: "pay_subs_2" } });
    ok(calls.length === 0, "no cookie consent → no server-side events");

    T.setTrackingFetch(async () => {
      throw new Error("network down access_token=SHOULD_NOT_LEAK");
    });
    const failing = await makeOrder({ provider: "RAZORPAY", tracking });
    const origErr = console.error;
    const logged: string[] = [];
    console.error = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
    const confirmed = await O.confirmOrder(failing.id, { captured: true, raw: { paymentId: "pay_subs_3" } });
    console.error = origErr;
    webhookIds.push(`purchase:${failing.id}`);
    ok(confirmed && (await db.order.findUniqueOrThrow({ where: { id: failing.id } })).status === "PAID", "tracking failure never breaks order confirmation");
    ok(logged.some((l) => l.includes("[tracking]")) && !logged.some((l) => l.includes("SHOULD_NOT_LEAK")), "failure is logged with tokens redacted");
    T.setTrackingFetch(async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, text: async () => '{"events_received":1}' };
    });
    const test = await T.sendMetaTestEvent();
    ok(test.ok && (calls.at(-1)!.body as { test_event_code?: string }).test_event_code === "TEST999", "Meta test event uses the saved test event code");

    // ── 5. Subscribe & Save: cart pricing and creation ──
    await S.saveSubscriptionSettings({ enabled: true, discountPercent: 15, maxFailures: 2, retryDays: 1, payWindowDays: 3, reminderDays: 3 });
    const cart = await db.cart.create({ data: { userId: user.id, items: { create: [{ variantId: variant.id, quantity: 2, bundle: { subscribe: { intervalMonths: 2 } } }] } } });
    cartIds.push(cart.id);
    const full = await db.cart.findUniqueOrThrow({ where: { id: cart.id }, include: cartInclude });
    const [line] = await cartLines(full);
    ok(line.subscription?.intervalMonths === 2 && line.subscription.discountPercent === 15 && line.unitPrice === Math.round(variant.price * 0.85) && line.compareAtPrice === variant.price, `subscribe line priced at −15% (${line.unitPrice} vs ${variant.price})`);
    ok(line.label.includes("Every 2 months"), `line label shows the schedule ("${line.label}")`);

    const cod = await O.placeOrder({ cart: full, lines: [line], userId: user.id, email: user.email, address: addr, shippingRateId: "ship-in", provider: "COD", pointsRequested: 0, giftWrap: false });
    const codItem = await db.orderItem.findFirstOrThrow({ where: { orderId: cod.order.id } });
    ok((codItem.meta as { subscription?: { intervalMonths: number } }).subscription?.intervalMonths === 2, "order item keeps the subscription choice");
    ok((await db.subscription.count({ where: { userId: user.id } })) === 0, "COD (not prepaid) never starts a subscription");

    const subMeta = { subscription: { intervalMonths: 1, discountPercent: 15 } };
    const paidOrder = await makeOrder({ provider: "RAZORPAY", meta: subMeta, qty: 2 });
    await O.confirmOrder(paidOrder.id, { captured: true, raw: { paymentId: "pay_subs_4" } });
    webhookIds.push(`purchase:${paidOrder.id}`);
    const subs = await db.subscription.findMany({ where: { userId: user.id } });
    const placed = (await db.order.findUniqueOrThrow({ where: { id: paidOrder.id } })).placedAt;
    ok(subs.length === 1 && subs[0].quantity === 2 && subs[0].discountPercent === 15 && subs[0].provider === "RAZORPAY" && subs[0].originOrderId === paidOrder.id, "paid prepaid order → one subscription (qty, discount, provider)");
    ok(subs[0].nextRunAt.getTime() === S.addMonths(placed, 1).getTime(), "first renewal one interval after the order");
    ok((await S.createSubscriptionsForOrder(paidOrder.id)) === 0 && (await db.subscription.count({ where: { userId: user.id } })) === 1, "creation is idempotent");
    ok(S.addMonths(new Date("2026-01-31T10:00:00Z"), 1).toISOString().startsWith("2026-02-28"), "31 Jan + 1 month → 28 Feb");

    // ── 6. Renewal on the due date, idempotent ──
    const sub = subs[0];
    const now = new Date();
    ok((await S.runSubscriptions(now)).due === 0, "not due yet → nothing renews");
    await db.subscription.update({ where: { id: sub.id }, data: { nextRunAt: new Date(now.getTime() - 60_000) } });
    const reservedBefore = (await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).reserved;
    const runs = await Promise.all([S.runSubscriptions(now), S.runSubscriptions(now)]);
    await S.runSubscriptions(now);
    let renewals = await db.subscriptionRenewal.findMany({ where: { subscriptionId: sub.id } });
    ok(renewals.length === 1 && Boolean(renewals[0].orderId), `due → exactly one renewal order across 3 runs (2 concurrent) [links ${runs.map((r) => r.link).join("+")}]`);
    const rOrder = await db.order.findUniqueOrThrow({ where: { id: renewals[0].orderId! }, include: { items: true, payments: true } });
    ok(rOrder.items[0].unitPrice === Math.round(variant.price * 0.85) && rOrder.items[0].quantity === 2 && rOrder.status === "PENDING" && Boolean(rOrder.reservedUntil), "renewal order: discounted price, quantity, awaiting payment");
    ok((await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).reserved === reservedBefore + 2, "renewal reserves stock");
    ok(rOrder.reservedUntil!.getTime() - now.getTime() >= 3 * 86_400_000 - 1000, "stock held for the pay-link window (3 days)");
    const token = S.payToken(rOrder.id);
    ok(S.orderIdFromPayToken(token) === rOrder.id && S.orderIdFromPayToken(token.slice(0, -2) + "xx") === null, "signed pay link round-trips; tampering is rejected");

    // Skip is refused while a renewal is open.
    let rule = "";
    try {
      await S.changeSubscription(sub.id, { type: "skip" }, "customer");
    } catch (e) {
      rule = (e as Error).message;
    }
    ok(rule.includes("already being processed"), "skip refused while the renewal awaits payment");

    await O.confirmOrder(rOrder.id, { captured: true, raw: { paymentId: "pay_subs_5" } });
    webhookIds.push(`purchase:${rOrder.id}`);
    renewals = await db.subscriptionRenewal.findMany({ where: { subscriptionId: sub.id } });
    let fresh = await db.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    ok(renewals[0].status === "PAID" && fresh.nextRunAt.getTime() === S.addMonths(renewals[0].dueAt, 1).getTime(), "payment settles the renewal and advances the cycle by one interval");
    ok((await db.subscription.count({ where: { originOrderId: rOrder.id } })) === 0, "a renewal never spawns another subscription");
    await S.runSubscriptions(now);
    ok((await db.subscriptionRenewal.count({ where: { subscriptionId: sub.id } })) === 1, "rerun after payment creates nothing new");

    // ── 7. Rules: skip / interval / quantity / pause / resume / cancel ──
    const nextBefore = fresh.nextRunAt;
    fresh = await S.changeSubscription(sub.id, { type: "skip" }, "customer");
    ok(fresh.nextRunAt.getTime() === S.addMonths(nextBefore, 1).getTime(), "skip moves the next renewal by one interval");
    fresh = await S.changeSubscription(sub.id, { type: "interval", months: 3 }, "customer");
    ok(fresh.intervalMonths === 3, "interval changed to every 3 months");
    const err = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        return "";
      } catch (e) {
        return e instanceof S.SubscriptionRuleError ? e.message : `unexpected: ${(e as Error).message}`;
      }
    };
    ok((await err(() => S.changeSubscription(sub.id, { type: "quantity", quantity: 11 }, "customer"))) !== "", "quantity above 10 refused");
    ok((await err(() => S.changeSubscription(sub.id, { type: "resume" }, "customer"))).includes("paused"), "resume refused while active");
    fresh = await S.changeSubscription(sub.id, { type: "pause" }, "customer");
    ok(fresh.status === "PAUSED" && fresh.pauseReason === "customer", "pause");
    ok((await err(() => S.changeSubscription(sub.id, { type: "skip" }, "customer"))) !== "" && (await err(() => S.changeSubscription(sub.id, { type: "pause" }, "customer"))) !== "", "skip / pause refused while paused");
    await db.subscription.update({ where: { id: sub.id }, data: { nextRunAt: new Date(now.getTime() - 60_000) } });
    await S.runSubscriptions(now);
    ok((await db.subscriptionRenewal.count({ where: { subscriptionId: sub.id } })) === 1, "a paused subscription is never renewed");
    fresh = await S.changeSubscription(sub.id, { type: "resume" }, "customer");
    ok(fresh.status === "ACTIVE" && fresh.nextRunAt.getTime() > now.getTime() + 86_000_000, "resume never bills in the past (next ≥ tomorrow)");

    // ── 8. Failures retry, then pause ── (a due date of its own, distinct from section 6)
    await db.subscription.update({ where: { id: sub.id }, data: { nextRunAt: new Date(now.getTime() - 120_000) } });
    await S.runSubscriptions(now);
    let open = await db.subscriptionRenewal.findFirstOrThrow({ where: { subscriptionId: sub.id, status: "PENDING" } });
    await db.order.update({ where: { id: open.orderId! }, data: { reservedUntil: new Date(now.getTime() - 1000) } });
    await O.releaseExpired(); // pay window lapsed → order cancelled, stock released
    const r1 = await S.runSubscriptions(now);
    fresh = await db.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    ok(r1.renewalsFailed === 1 && fresh.failureCount === 1 && fresh.status === "ACTIVE" && Boolean(fresh.retryAt) && fresh.retryAt! > now, "unpaid renewal → failure #1, retry scheduled");
    await S.runSubscriptions(now);
    ok((await db.subscriptionRenewal.count({ where: { subscriptionId: sub.id, status: "PENDING" } })) === 0, "no new attempt before the retry date");
    const later = new Date(now.getTime() + 86_400_000 + 60_000);
    await S.runSubscriptions(later);
    open = await db.subscriptionRenewal.findFirstOrThrow({ where: { subscriptionId: sub.id, status: "PENDING" } });
    ok(open.attempt === 2, `retry is attempt #2 for the same due date (got ${open.attempt})`);
    await O.cancelOrder(open.orderId!, "test: payment failed");
    const r2 = await S.runSubscriptions(later);
    fresh = await db.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    ok(r2.renewalsFailed === 1 && fresh.status === "PAUSED" && fresh.pauseReason === "payment_failed" && fresh.failureCount === 2, "second failure (max 2) → paused automatically");

    // Cancel releases an open renewal.
    fresh = await S.changeSubscription(sub.id, { type: "resume" }, "staff");
    ok(fresh.failureCount === 0, "resume clears the failure count");
    await db.subscription.update({ where: { id: sub.id }, data: { nextRunAt: new Date(later.getTime() - 60_000) } });
    await S.runSubscriptions(later);
    open = await db.subscriptionRenewal.findFirstOrThrow({ where: { subscriptionId: sub.id, status: "PENDING" } });
    fresh = await S.changeSubscription(sub.id, { type: "cancel" }, "customer");
    const released = await db.order.findUniqueOrThrow({ where: { id: open.orderId! } });
    ok(fresh.status === "CANCELLED" && released.status === "CANCELLED" && (await db.subscriptionRenewal.findUniqueOrThrow({ where: { id: open.id } })).status === "SKIPPED", "cancel → unpaid renewal order released");
    ok((await err(() => S.changeSubscription(sub.id, { type: "resume" }, "customer"))).includes("cancelled"), "cancelled is final");

    // Reminder: once per cycle.
    const sub2 = await db.subscription.create({ data: { userId: user.id, variantId: variant.id, nextRunAt: new Date(now.getTime() + 2 * 86_400_000), intervalMonths: 1, discountPercent: 15, email: user.email, provider: "RAZORPAY", shippingAddress: addr } });
    const rem1 = await S.sendUpcomingReminders(now);
    const rem2 = await S.sendUpcomingReminders(now);
    ok(rem1 >= 1 && rem2 === 0 && (await db.subscription.findUniqueOrThrow({ where: { id: sub2.id } })).reminderFor?.getTime() === sub2.nextRunAt.getTime(), "renewal reminder sent once per cycle");

    const stats = await S.subscriptionStats(now);
    ok(stats.active >= 1 && stats.mrr >= Math.round(variant.price * 0.85), `MRR counts active subscriptions (${stats.mrr})`);
  } finally {
    T.setTrackingFetch(null);
    const orders = await db.order.findMany({ where: { OR: [{ userId: { in: userIds } }, { email: { endsWith: `@${DOMAIN}` } }] }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    await db.subscription.deleteMany({ where: { userId: { in: userIds } } });
    await db.inventoryLog.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.whatsAppMessage.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
    await db.order.deleteMany({ where: { id: { in: orderIds } } });
    await db.webhookEvent.deleteMany({ where: { OR: [{ id: { in: webhookIds } }, ...orderIds.map((id) => ({ id: `purchase:${id}` }))] } });
    await db.cart.deleteMany({ where: { OR: [{ id: { in: cartIds } }, { userId: { in: userIds } }] } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.productVariant.update({ where: { id: variant.id }, data: before });
    await db.setting.deleteMany({ where: { key: { in: KEYS } } });
    for (const r of saved) await db.setting.create({ data: { key: r.key, value: r.value as object } });
    I.forgetIntegrations();
    console.log("cleaned up");
    await db.$disconnect();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
