// Courier (Shiprocket) + fulfilment checks against the local database, in Test mode (the offline mock) plus a fake
// Shiprocket over an injected transport: status mapping (incl. RTO), rate fallback at checkout, live-rate parsing and
// token reuse, shipment creation + AWB (idempotent), bulk booking, merged label / manifest PDFs, pick list, pickups,
// webhook auth + idempotency, polling, Test-mode simulation through RTO, cancellation + re-booking, tracking lookup
// rules and lockout, and permission denial (pure + over HTTP when a dev server is running on :3000).
// Creates its own category/product/variants/users/orders and removes them; real stock and settings are untouched.
// Run: npm run test:courier
import "./no-real-email";
import "dotenv/config";

export {};

const DOMAIN = "courier-check.invalid";
const ORIGIN = process.env.COURIER_CHECK_ORIGIN ?? "http://localhost:3000";
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};

async function main() {
  const { randomBytes } = await import("node:crypto");
  const { db } = await import("@/server/db");
  const { cartInclude, cartLines } = await import("@/server/cart-lines");
  const { placeOrder, quote } = await import("@/server/orders");
  const { forceCourier } = await import("@/server/courier");
  const { MockCourier, mockScript } = await import("@/server/courier/mock");
  const { ShiprocketClient, setCourierTransport } = await import("@/server/courier/shiprocket");
  const { mapCourierStatus, shouldApply } = await import("@/server/courier/status");
  const F = await import("@/server/courier/fulfilment");
  const T = await import("@/server/courier/tracking");
  const { trackKey } = await import("@/server/courier/track-key");
  const { deliveryEstimate, forgetCheckoutRates } = await import("@/server/courier/checkout");
  const { CODE128, code128Modules } = await import("@/server/courier/pdf");
  const { boardColumn, buildPickList, slaAge } = await import("@/lib/fulfilment");
  const { resolvePermissions } = await import("@/lib/permissions");

  const tag = `crchk${Date.now().toString(36)}`;
  const email = (who: string) => `${who}-${tag}@${DOMAIN}`;
  const userIds: string[] = [];
  const cartIds: string[] = [];

  const realVariantsBefore = await db.productVariant.findMany({ select: { id: true, stock: true, reserved: true } });
  const countsBefore = await Promise.all([db.order.count(), db.shipment.count(), db.setting.count()]);

  const category = await db.category.create({ data: { slug: tag, name: `${tag} Bakhoor`, tagline: "t", description: "t", ambient: "GLOW" } });
  const product = await db.product.create({ data: { slug: tag, name: `${tag} Oud`, subtitle: "t", story: "t", categoryId: category.id, family: "WOODY", model: "OIL" } });
  const A = await db.productVariant.create({ data: { productId: product.id, sku: `${tag}-A`.toUpperCase(), label: "12 ml", price: 120000, stock: 50, weightGrams: 300, position: 0 } });
  const B = await db.productVariant.create({ data: { productId: product.id, sku: `${tag}-B`.toUpperCase(), label: "3 ml", price: 45000, stock: 50, weightGrams: 120, position: 1 } });

  const newUser = async (who: string, role: "CUSTOMER" | "SUPPORT" | "OWNER" = "CUSTOMER", staffRoleId?: string) => {
    const u = await db.user.create({ data: { email: email(who), name: `CC ${who}`, role, staffRoleId } });
    userIds.push(u.id);
    return u;
  };
  const addr = (postalCode: string, phone = "+91 98000 00001", country = "IN") => ({ fullName: "Courier Tester", phone, line1: "1 Janpath", city: "New Delhi", state: "DL", postalCode, country });
  const makeCart = async (u: { id: string; email: string }, items: { variantId: string; quantity: number }[]) => {
    const c = await db.cart.create({ data: { email: u.email, items: { create: items } } });
    cartIds.push(c.id);
    return db.cart.findUniqueOrThrow({ where: { id: c.id }, include: cartInclude });
  };
  const order = async (u: { id: string; email: string }, items: { variantId: string; quantity: number }[], address = addr("400001"), opts: { prepaid?: boolean } = {}) => {
    const cart = await makeCart(u, items);
    const { order } = await placeOrder({ cart, lines: await cartLines(cart), userId: u.id, email: u.email, address, shippingRateId: "ship-in", provider: "COD", pointsRequested: 0, giftWrap: false });
    if (opts.prepaid) {
      await db.payment.updateMany({ where: { orderId: order.id }, data: { provider: "RAZORPAY", status: "CAPTURED" } });
      await db.order.update({ where: { id: order.id }, data: { status: "PAID" } });
    }
    return db.order.findUniqueOrThrow({ where: { id: order.id } });
  };
  const statusOf = async (id: string) => (await db.order.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
  const activeShipment = (orderId: string) => db.shipment.findFirstOrThrow({ where: { orderId, active: true }, orderBy: { createdAt: "desc" } });

  // Fake Shiprocket: routes by path, counts calls.
  type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;
  const calls: string[] = [];
  const fake = (routes: Record<string, Handler>) => async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const path = url.pathname.replace("/v1/external", "");
    calls.push(`${init?.method ?? "GET"} ${path}`);
    const h = Object.entries(routes).find(([p]) => path.startsWith(p))?.[1];
    return h ? h(url, init) : new Response(JSON.stringify({ message: "not found" }), { status: 404 });
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const creds = { email: "api@test.invalid", password: "pw", pickupLocation: "Primary", pickupPincode: "110001" };

  try {
    forceCourier({ client: new MockCourier() });

    // ── 1. Status mapping ──
    const cases: [string, number | null, string | null][] = [
      ["IN TRANSIT", null, "IN_TRANSIT"],
      ["Picked Up", null, "IN_TRANSIT"],
      ["OUT FOR DELIVERY", null, "OUT_FOR_DELIVERY"],
      ["Delivered", null, "DELIVERED"],
      ["UNDELIVERED", null, "FAILED_DELIVERY"],
      ["RTO INITIATED", null, "RTO"],
      ["RTO_IN_TRANSIT", null, "RTO"],
      ["RTO DELIVERED", null, "RTO_DELIVERED"],
      ["Cancellation Requested", null, null],
      ["CANCELED", null, "CANCELLED"],
      ["Lost", null, "LOST"],
      ["", 17, "OUT_FOR_DELIVERY"],
      ["", 10, "RTO_DELIVERED"],
      ["Some new courier wording", 42, "IN_TRANSIT"],
      ["Mystery", null, null],
    ];
    const wrong = cases.filter(([l, id, want]) => mapCourierStatus(l, id) !== want);
    ok(!wrong.length, `courier statuses map to ours, incl. RTO and id fallback${wrong.length ? ` (wrong: ${wrong.map((w) => w[0] || w[1]).join(", ")})` : ""}`);
    ok(!shouldApply("DELIVERED", "IN_TRANSIT", true) && !shouldApply("RTO", "IN_TRANSIT", true) && shouldApply("IN_TRANSIT", "OUT_FOR_DELIVERY", true) && !shouldApply("OUT_FOR_DELIVERY", "IN_TRANSIT", false), "status never moves backwards; newer scan wins within transit");
    ok(
      boardColumn({ status: "PAID", reservedUntil: null, rtoAt: null, shipment: null }) === "TO_PACK" &&
        boardColumn({ status: "PENDING", reservedUntil: new Date(), rtoAt: null, shipment: null }) === null &&
        boardColumn({ status: "PACKED", reservedUntil: null, rtoAt: null, shipment: { status: "AWB_ASSIGNED", awb: "X" } }) === "READY" &&
        boardColumn({ status: "SHIPPED", reservedUntil: null, rtoAt: new Date(), shipment: { status: "RTO", awb: "X" } }) === "EXCEPTIONS",
      "board columns: paid → To pack, unpaid hidden, labelled → Ready, RTO → Exceptions",
    );
    const age = slaAge(new Date(Date.now() - 26 * 3600_000));
    ok(age.tone === "late" && age.label === "1d 2h" && slaAge(new Date(Date.now() - 4 * 3600_000)).label === "4h", "SLA ageing labels and tones");
    ok(CODE128.length === 107 && CODE128.every((p, i) => [...p].reduce((s, d) => s + Number(d), 0) === (i === 106 ? 13 : 11)) && code128Modules("MO123").length === 7 * 6 + 7, "Code 128 table is well-formed");

    // ── 2. Checkout rates: table fallback, failing courier, live courier ──
    const shopper = await newUser("shopper");
    const cart = await makeCart(shopper, [{ variantId: A.id, quantity: 1 }]);
    const lines = await cartLines(cart);
    const table = await quote({ lines, cart, country: "IN", postalCode: "400001" });
    ok(table.rate?.id === "ship-in" && table.rate.price === 9900, "courier off (test mode): checkout uses the shipping rates table");

    const failing = new ShiprocketClient(creds);
    setCourierTransport(fake({ "/auth/login": () => json({ token: "tok-123456789" }), "/courier/serviceability": () => json({ message: "boom" }, 503) }));
    forceCourier({ client: failing, config: { enabled: true, liveRates: true } });
    forgetCheckoutRates();
    const t0 = Date.now();
    const fallback = await quote({ lines, cart, country: "IN", postalCode: "400001" });
    ok(fallback.rate?.price === 9900 && Date.now() - t0 < 8000, `courier down: checkout falls back to the table without blocking (${Date.now() - t0}ms)`);

    calls.length = 0;
    let logins = 0;
    let firstRateCall = true;
    setCourierTransport(
      fake({
        "/auth/login": () => {
          logins++;
          return json({ token: `tok-${logins}-abcdefgh` });
        },
        "/courier/serviceability": (url) => {
          // First call: token "expired" → 401 → re-login once.
          if (firstRateCall) {
            firstRateCall = false;
            return json({ message: "Token has expired" }, 401);
          }
          if (url.searchParams.get("delivery_postcode") === "999999") return json({ status: 404, message: "not serviceable" }, 404);
          return json({
            status: 200,
            data: {
              available_courier_companies: [
                { courier_company_id: 10, courier_name: "Delhivery", rate: "84.6", etd: "Oct 14, 2026", estimated_delivery_days: "4", cod: 1, rating: 4.2 },
                { courier_company_id: 22, courier_name: "Blue Dart", rate: 151, etd: "Oct 12, 2026", estimated_delivery_days: 2, cod: 1, rating: "4.8" },
              ],
              shiprocket_recommended_courier_id: 10,
            },
          });
        },
      }),
    );
    forceCourier({ client: new ShiprocketClient(creds), config: { enabled: true, liveRates: true } });
    forgetCheckoutRates();
    const live = await quote({ lines, cart, country: "IN", postalCode: "400001" });
    ok(live.rate?.id === "ship-in" && live.rate.price === 9000 && live.rates.find((r) => r.id === "ship-in-express")?.price === 24900, "live rates: standard priced from the recommended courier (₹84.60 → ₹90), express untouched");
    ok(logins === 2, `expired token: logged in again once (logins=${logins})`);
    const placeQuote = await quote({ lines, cart, country: "IN", postalCode: "400001" });
    ok(placeQuote.rate?.price === 9000 && logins === 2, "placement re-quotes the same live price from cache (no extra calls)");
    const est = await deliveryEstimate("400001", "IN", new Date("2026-10-09T05:00:00Z"));
    ok(Boolean(est?.serviceable && est.source === "courier"), `live delivery estimate: ${est?.label}`);
    const nope = await deliveryEstimate("999999", "IN");
    ok(nope?.serviceable === false, "unserviceable pincode is reported (not silently dropped)");
    const rates = await new ShiprocketClient(creds).serviceability({ deliveryPincode: "400001", weightGrams: 500, cod: true, declaredValue: 100000 });
    ok(rates.length === 2 && rates[0].rate === 8460 && rates[0].recommended && rates[1].etdDays === 2 && rates[1].rating === 4.8, "Shiprocket serviceability parsed (string/number fields, recommended, ETD)");

    setCourierTransport(null);
    forceCourier({ client: new MockCourier() });
    forgetCheckoutRates();
    const tableEst = await deliveryEstimate("400001", "IN");
    ok(tableEst?.serviceable === true && tableEst.source === "table", `test mode: estimate from the rates table (${tableEst?.label})`);

    // ── 3. Shipment creation + AWB ──
    const alice = await newUser("alice");
    const o1 = await order(alice, [{ variantId: A.id, quantity: 2 }, { variantId: B.id, quantity: 1 }]);
    const o2 = await order(alice, [{ variantId: A.id, quantity: 1 }], addr("400001"), { prepaid: true });
    const o3 = await order(alice, [{ variantId: B.id, quantity: 3 }], addr("560013")); // RTO script
    const o4 = await order(alice, [{ variantId: B.id, quantity: 1 }], addr("110002"));
    const intl = await order(alice, [{ variantId: B.id, quantity: 1 }], addr("SW1A1AA", "+447700900000", "GB"));
    const awaiting = await order(alice, [{ variantId: B.id, quantity: 1 }], addr("400001"));
    await db.order.update({ where: { id: awaiting.id }, data: { codStatus: "AWAITING" } });

    const r1 = await F.ratesForOrder(o1.id);
    ok(r1.mode === "test" && r1.cod && r1.rates.length === 3 && r1.rates.some((r) => r.cheapest) && r1.rates.some((r) => r.fastest) && !r1.rates.some((r) => r.courierName.startsWith("Ekart")), "rates compared with cheapest/fastest badges; COD excludes non-COD couriers");
    ok(r1.weightGrams === 2 * 300 + 120 + 150, `parcel weight from variants + packaging (${r1.weightGrams} g)`);

    const s1 = await F.createShipmentForOrder(o1.id, { courierId: "mock-bd" });
    const o1After = await db.order.findUniqueOrThrow({ where: { id: o1.id } });
    ok(s1.created && /^MOT\d{10}$/.test(s1.shipment.awb ?? "") && s1.shipment.courierName === "Blue Dart Air" && s1.shipment.cod && s1.shipment.codAmount === o1.total, `AWB ${s1.shipment.awb} with the chosen courier, COD amount recorded`);
    ok(o1After.status === "PACKED" && o1After.trackingNumber === s1.shipment.awb && o1After.carrier === "Blue Dart Air", "labelled order is marked packed and carries the AWB");
    const again = await F.createShipmentForOrder(o1.id);
    ok(!again.created && again.shipment.awb === s1.shipment.awb && (await db.shipment.count({ where: { orderId: o1.id } })) === 1, "booking again is idempotent (same AWB, one shipment)");
    const err = async (fn: () => Promise<unknown>) => fn().then(() => null, (e: Error) => e.message);
    ok(/international/i.test((await err(() => F.createShipmentForOrder(intl.id))) ?? ""), "international orders are refused with a clear message");
    ok(/confirmation/i.test((await err(() => F.createShipmentForOrder(awaiting.id))) ?? ""), "COD awaiting confirmation can’t be booked");

    const bulk = await F.bulkCreateShipments([o2.id, o3.id, intl.id], userIds[0]);
    ok(bulk.filter((b) => b.ok).length === 2 && bulk.find((b) => b.orderId === intl.id)?.ok === false, "bulk booking: per-order outcomes, one failure doesn’t stop the rest");
    const s2 = await activeShipment(o2.id);
    ok(!s2.cod && s2.codAmount === 0 && s2.courierName === "Delhivery Surface", "prepaid: no COD; recommended courier by default");

    // ── 4. Documents ──
    const labels = await F.labelsFor([o1.id, o2.id, o3.id]);
    const pdfText = labels.kind === "pdf" ? labels.bytes.toString("latin1") : "";
    ok(labels.kind === "pdf" && pdfText.startsWith("%PDF-1.4") && (pdfText.match(/\/Type \/Page /g) ?? []).length === 3 && pdfText.includes(s1.shipment.awb!) && pdfText.includes("TEST MODE") && pdfText.trimEnd().endsWith("%%EOF"), "bulk labels: one merged 3-page PDF with AWBs, marked test mode");
    const xref = Number(/startxref\n(\d+)/.exec(pdfText)?.[1]);
    ok(pdfText.slice(xref, xref + 4) === "xref", "PDF cross-reference offset is exact");
    const manifest = await F.manifestFor([o1.id, o2.id]);
    ok(manifest.kind === "pdf" && manifest.bytes.toString("latin1").includes("Pickup manifest"), "manifest PDF");
    const { pickList, orders: packOrders } = await F.packingData([o1.id, o2.id, o3.id]);
    const rowA = pickList.find((r) => r.sku === A.sku);
    const rowB = pickList.find((r) => r.sku === B.sku);
    ok(rowA?.quantity === 3 && rowB?.quantity === 4 && rowA.orders.length === 2 && packOrders.length === 3, "pick list aggregates SKUs across orders (A×3, B×4)");
    ok(
      JSON.stringify(buildPickList([{ number: "X1", items: [{ sku: "SET", name: "Coffret", label: "", quantity: 2, components: [{ sku: "P1", name: "a", label: "" }, { sku: "P2", name: "b", label: "" }] }, { sku: "GC", name: "Gift card", label: "", quantity: 1, digital: true }] }]).map((r) => `${r.sku}:${r.quantity}`)) === '["P1:2","P2:2"]',
      "pick list expands coffrets into pieces and skips gift cards",
    );

    // ── 5. Pickup ──
    const pick = await F.schedulePickups([o1.id, o2.id, o3.id, o4.id]);
    const sch = await activeShipment(o1.id);
    ok(pick.filter((p) => p.ok).length === 3 && pick.find((p) => p.orderId === o4.id)?.ok === false && sch.status === "PICKUP_SCHEDULED" && Boolean(sch.pickupScheduledAt), "pickup scheduled for labelled orders; unlabelled one reported");
    const pick2 = await F.schedulePickups([o1.id]);
    ok(pick2[0]?.detail === "already scheduled", "scheduling twice is harmless");

    // ── 6. Webhook ──
    const TOKEN = `whk-${randomBytes(12).toString("hex")}`;
    // Courier timestamps ("DD MM YYYY HH:mm:ss", IST) relative to now, so ordering never depends on the clock.
    const ist = (h: number) => {
      const d = new Date(Date.now() + h * 3600_000 + 330 * 60_000).toISOString();
      return `${d.slice(8, 10)} ${d.slice(5, 7)} ${d.slice(0, 4)} ${d.slice(11, 19)}`;
    };
    const [H0, H1, H2, H3, H4] = [0.5, 1, 2, 3, 4].map(ist);
    const hook = (awb: string, status: string, ts: string, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ awb, current_status: status, current_timestamp: ts, order_id: o1.number, scans: [{ date: H0.replace(/^(\d{2}) (\d{2}) (\d{4})/, "$3-$2-$1"), activity: "Shipment picked up", location: "Delhi", "sr-status": "42", "sr-status-label": "PICKED UP" }], ...extra });
    ok((await F.handleCourierWebhook(hook(sch.awb!, "IN TRANSIT", H1), "wrong", TOKEN)).status === 401, "webhook: wrong x-api-key → 401");
    ok((await F.handleCourierWebhook(hook(sch.awb!, "IN TRANSIT", H1), TOKEN, "")).status === 401, "webhook: no token configured → 401 (never open)");
    ok(F.webhookTokenValid(TOKEN, TOKEN) && !F.webhookTokenValid(TOKEN.slice(0, -1), TOKEN), "token check (constant-time, any length)");
    const w1 = await F.handleCourierWebhook(hook(sch.awb!, "IN TRANSIT", H1), TOKEN, TOKEN);
    ok(w1.status === 200 && w1.body.added === 2 && (await statusOf(o1.id)) === "SHIPPED", "webhook: scans stored, order moves to SHIPPED");
    const eventsBefore = await db.shipmentEvent.count({ where: { shipmentId: sch.id } });
    const orderEventsBefore = await db.orderEvent.count({ where: { orderId: o1.id } });
    const w2 = await F.handleCourierWebhook(hook(sch.awb!, "IN TRANSIT", H1), TOKEN, TOKEN);
    ok(w2.body.duplicate === true && (await db.shipmentEvent.count({ where: { shipmentId: sch.id } })) === eventsBefore && (await db.orderEvent.count({ where: { orderId: o1.id } })) === orderEventsBefore, "webhook replay is a no-op (idempotent)");
    await F.handleCourierWebhook(hook(sch.awb!, "OUT FOR DELIVERY", H2, { shipment_status_id: 17 }), TOKEN, TOKEN);
    const ofd = await activeShipment(o1.id);
    ok(ofd.status === "OUT_FOR_DELIVERY" && Boolean(ofd.ofdNotifiedAt), "out for delivery recorded and customer notified once");
    await F.handleCourierWebhook(hook(sch.awb!, "DELIVERED", H3), TOKEN, TOKEN);
    await F.handleCourierWebhook(hook(sch.awb!, "IN TRANSIT", H4), TOKEN, TOKEN); // late, out of order
    const delivered = await activeShipment(o1.id);
    const codPay = await db.payment.findFirstOrThrow({ where: { orderId: o1.id } });
    ok(delivered.status === "DELIVERED" && (await statusOf(o1.id)) === "DELIVERED" && codPay.status === "CAPTURED" && Boolean(delivered.deliveredAt), "delivered: order DELIVERED, COD captured; a late scan doesn’t move it back");
    ok((await F.handleCourierWebhook(JSON.stringify({ awb: "NOPE123", current_status: "DELIVERED" }), TOKEN, TOKEN)).body.ignored === "unknown awb", "unknown AWB acknowledged (200) and ignored");
    ok((await F.handleCourierWebhook("{not json", TOKEN, TOKEN)).status === 400, "malformed body → 400");

    // ── 7. Test-mode simulation through RTO ──
    const steps: string[] = [];
    for (let i = 0; i < mockScript("560013").length + 2; i++) {
      const r = await F.simulateNextScan(o3.id).catch((e: Error) => ({ status: null, label: e.message }));
      steps.push(r.status ? String(r.status) : `stop:${r.label}`);
      if (!r.status) break;
    }
    const o3After = await db.order.findUniqueOrThrow({ where: { id: o3.id }, include: { shipments: true } });
    ok(steps.includes("FAILED_DELIVERY") && steps.includes("RTO") && steps.at(-2) === "RTO_DELIVERED" && steps.at(-1)!.startsWith("stop"), `simulated RTO journey: ${steps.join(" → ")}`);
    ok(o3After.status === "SHIPPED" && Boolean(o3After.rtoAt) && boardColumn({ status: o3After.status, reservedUntil: null, rtoAt: o3After.rtoAt, shipment: { status: o3After.shipments[0].status, awb: o3After.shipments[0].awb } }) === "EXCEPTIONS", "RTO flags the order (Exceptions), never marks it delivered");

    // ── 8. Polling (cron fallback) ──
    const poll = await F.syncActiveShipments({ now: new Date(Date.now() + 200 * 3600_000), orderIds: [o2.id] });
    const s2After = await activeShipment(o2.id);
    ok(poll.errors.length === 0 && s2After.status === "DELIVERED" && (await statusOf(o2.id)) === "DELIVERED", `poller advances test-mode parcels (checked ${poll.checked}, updated ${poll.updated})`);
    const n2 = await db.shipmentEvent.count({ where: { shipmentId: s2After.id } });
    await db.shipment.update({ where: { id: s2After.id }, data: { status: "IN_TRANSIT", lastSyncedAt: null } });
    await F.syncActiveShipments({ now: new Date(Date.now() + 200 * 3600_000), orderIds: [o2.id] });
    ok((await db.shipmentEvent.count({ where: { shipmentId: s2After.id } })) === n2, "polling again adds no duplicate scans");
    await db.shipment.update({ where: { id: s2After.id }, data: { status: "DELIVERED" } });

    // ── 9. Cancel + re-book ──
    const s4 = await F.createShipmentForOrder(o4.id);
    await F.cancelShipment(o4.id);
    const o4c = await db.order.findUniqueOrThrow({ where: { id: o4.id } });
    ok(o4c.status === "PACKED" && o4c.trackingNumber === null && (await db.shipment.count({ where: { orderId: o4.id, active: true } })) === 0, "cancelled AWB: order back to Packed, no active shipment");
    const s4b = await F.createShipmentForOrder(o4.id);
    ok(s4b.created && s4b.shipment.reference === `${o4.number}-R1` && s4b.shipment.awb !== s4.shipment.awb, "re-booking uses a new reference and AWB");
    ok(/courier already has/i.test((await err(() => F.cancelShipment(o1.id))) ?? "") || /No active/i.test((await err(() => F.cancelShipment(o1.id))) ?? ""), "can’t cancel a parcel the courier already has");

    // ── 10. Board data ──
    const board = await F.boardData();
    const mine = board.cards.filter((c) => c.email.endsWith(`@${DOMAIN}`));
    const col = (id: string) => mine.find((c) => c.id === id)?.column;
    ok(col(o1.id) === "DELIVERED" && col(o3.id) === "EXCEPTIONS" && col(o4.id) === "READY" && col(intl.id) === "TO_PACK" && !mine.some((c) => c.id === awaiting.id), "board places each order in the right column; unconfirmed COD hidden");
    ok(mine.find((c) => c.id === intl.id)?.problem?.includes("International") === true, "board explains why an order can’t be booked");

    // ── 11. Tracking lookup rules ──
    T.resetTrackingLimits();
    const byEmail = await T.lookupTracking({ number: o1.number.toLowerCase(), contact: alice.email.toUpperCase() });
    ok(byEmail.ok && byEmail.view.progress === 4 && byEmail.view.awb === s1.shipment.awb && byEmail.view.steps.length > 3, "track by order number + email (any case)");
    const byPhone = await T.lookupTracking({ number: o3.number, contact: "098000-00001" });
    ok(byPhone.ok && /returned/i.test(byPhone.view.headline), `track by phone (last 10 digits): “${byPhone.ok ? byPhone.view.headline : ""}”`);
    const wrongEmail = await T.lookupTracking({ number: o1.number, contact: "someone@else.invalid" });
    const unknown = await T.lookupTracking({ number: "MO-00000000", contact: alice.email });
    ok(!wrongEmail.ok && !unknown.ok && wrongEmail.error === unknown.error, "wrong contact and unknown order get the same answer");
    ok((await T.lookupTracking({ number: o1.number, key: trackKey(o1.number) })).ok && !(await T.lookupTracking({ number: o2.number, key: trackKey(o1.number) })).ok, "signed link works only for its own order");
    const view = byEmail.ok ? JSON.stringify(byEmail.view) : "";
    ok(!view.includes("Janpath") && !view.includes(alice.email) && !view.includes("98000"), "tracking view leaks no address, email or phone");
    T.resetTrackingLimits();
    for (let i = 0; i < 8; i++) await T.lookupTracking({ number: o2.number, contact: `guess${i}@x.invalid` });
    const lockedOut = await T.lookupTracking({ number: o2.number, contact: alice.email });
    ok(!lockedOut.ok && lockedOut.error === T.LOCKED, "8 wrong guesses lock the order number (even the right answer waits)");
    T.resetTrackingLimits();

    // ── 12. Permissions ──
    const noFulfil = await db.staffRole.create({ data: { name: `${tag} viewer`, permissions: ["orders.view"] } });
    ok(resolvePermissions("SUPPORT", null).includes("orders.fulfil") && !resolvePermissions("SUPPORT", noFulfil.permissions).includes("orders.fulfil") && resolvePermissions("CUSTOMER", null).length === 0, "orders.fulfil: support yes, view-only role and customers no");

    let serverUp = false;
    try {
      serverUp = (await fetch(`${ORIGIN}/api/auth/csrf`, { signal: AbortSignal.timeout(90_000) })).ok;
    } catch {
      serverUp = false;
    }
    if (!serverUp) console.log(`SKIP  HTTP permission checks (no server at ${ORIGIN})`);
    else {
      const session = async (userId: string) => {
        const token = randomBytes(32).toString("hex");
        await db.session.create({ data: { sessionToken: token, userId, expires: new Date(Date.now() + 3600_000) } });
        await db.sessionSecondStep.create({ data: { sessionToken: token, userId, mode: "verify", verifiedAt: new Date() } });
        return token;
      };
      const owner = await newUser("owner", "OWNER");
      const viewer = await newUser("viewer", "SUPPORT", noFulfil.id);
      const [ownerTok, viewerTok] = await Promise.all([session(owner.id), session(viewer.id)]);
      const get = (path: string, token?: string) => fetch(`${ORIGIN}${path}`, { headers: token ? { cookie: `authjs.session-token=${token}` } : {}, redirect: "manual", signal: AbortSignal.timeout(180_000) });
      const docPath = `/api/admin/fulfilment/documents?doc=labels&orders=${o1.id},${o2.id}`;
      const anon = await get(docPath);
      const denied = await get(docPath, viewerTok);
      const allowed = await get(docPath, ownerTok);
      ok(anon.status === 401 && denied.status === 403, `labels route: signed out 401, no orders.fulfil 403 (${anon.status}/${denied.status})`);
      ok(allowed.status === 200 && allowed.headers.get("content-type") === "application/pdf" && (await allowed.arrayBuffer()).byteLength > 1000, "labels route: fulfilment staff get the merged PDF");
      // The admin shell streams (loading.tsx), so a forbidden page can arrive as 200 with the 403 view inside.
      const boardDenied = await get("/admin/fulfilment", viewerTok);
      const deniedHtml = await boardDenied.text();
      ok((boardDenied.status === 403 || deniedHtml.includes("This room is for staff")) && !deniedHtml.includes("Dispatch board"), `fulfilment board forbidden without orders.fulfil (${boardDenied.status})`);
      const boardOwner = await get("/admin/fulfilment", ownerTok);
      const ownerHtml = await boardOwner.text();
      ok(boardOwner.status === 200 && ownerHtml.includes("Dispatch board") && ownerHtml.includes(o4.number), "fulfilment board renders for fulfilment staff with the test orders");
      const hookRes = await fetch(`${ORIGIN}/api/webhooks/courier`, { method: "POST", headers: { "x-api-key": "nope", "Content-Type": "application/json" }, body: "{}" });
      ok(hookRes.status === 401, "webhook route rejects a bad x-api-key");
      ok(await db.auditLog.count({ where: { actorId: owner.id, action: "fulfilment.print_labels" } }).then((n) => n === 1), "printing labels is audited");
    }
  } finally {
    forceCourier(null);
    setCourierTransport(null);
    forgetCheckoutRates();
    const orders = await db.order.findMany({ where: { OR: [{ email: { endsWith: `@${DOMAIN}` } }, { userId: { in: userIds } }] }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: orderIds } }] } });
    await db.inventoryLog.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.whatsAppMessage.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
    await db.order.deleteMany({ where: { id: { in: orderIds } } }); // shipments, events, items, payments cascade
    await db.cart.deleteMany({ where: { OR: [{ id: { in: cartIds } }, { userId: { in: userIds } }] } });
    await db.user.deleteMany({ where: { id: { in: userIds } } }); // sessions cascade
    await db.staffRole.deleteMany({ where: { name: { startsWith: tag } } });
    await db.product.delete({ where: { id: product.id } });
    await db.category.delete({ where: { id: category.id } });

    const realAfter = await db.productVariant.findMany({ select: { id: true, stock: true, reserved: true } });
    const key = (v: { id: string; stock: number; reserved: number }) => `${v.id}:${v.stock}:${v.reserved}`;
    ok(JSON.stringify(realAfter.map(key).sort()) === JSON.stringify(realVariantsBefore.map(key).sort()), "real catalogue stock unchanged; test variants removed");
    const countsAfter = await Promise.all([db.order.count(), db.shipment.count(), db.setting.count()]);
    ok(countsAfter.join() === countsBefore.join(), `no orders, shipments or settings left behind (${countsAfter.join("/")})`);
    console.log("cleaned up");
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
