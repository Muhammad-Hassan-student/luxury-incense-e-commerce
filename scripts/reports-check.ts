// Sales analytics + "frequently bought together" checks against the local database.
// Creates its own category/products/users/orders/carts dated in 2001 (so real data never mixes in) and removes them afterwards.
// Run: npm run test:reports
import "dotenv/config";
import type { OrderStatus, PaymentProvider } from "@/generated/prisma/client";
import { db } from "@/server/db";
import {
  bucketKeys,
  getCartFunnel,
  getChannelSplit,
  getCustomerInsights,
  getKpis,
  getPaymentSplit,
  getSalesSeries,
  getTopCategories,
  getTopProducts,
  makeRange,
  pctChange,
  previousRange,
  resolveRange,
  segmentOf,
} from "@/server/analytics";
import { pickAvailable, rankRecommendations } from "@/server/recommendations";

const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};
const near = (a: number | null, b: number) => a != null && Math.abs(a - b) < 1e-9;

const TZ = "Asia/Kolkata";
const tag = `RPTCHK${Date.now().toString(36).toUpperCase()}`;
const ist = (s: string) => new Date(`${s}+05:30`);
const addr = { fullName: "Report Check", phone: "+919999999999", line1: "1 MG Road", city: "Bengaluru", state: "KA", postalCode: "560001", country: "IN" };

async function main() {
  const earlyOrders = await db.order.count({ where: { placedAt: { lt: new Date("2002-07-01T00:00:00Z") }, NOT: { number: { startsWith: "RPTCHK" } } } });
  ok(earlyOrders === 0, `no real orders before mid-2002 to interfere (${earlyOrders})`);

  // ── Fixtures ──
  const category = await db.category.create({ data: { slug: tag.toLowerCase(), name: `${tag} Category`, tagline: "t", description: "t", ambient: "SMOKE" } });
  const mkProduct = async (n: number, opts: { price: number; cost: number | null; stock?: number; isActive?: boolean; isBestseller?: boolean }) => {
    const p = await db.product.create({
      data: {
        slug: `${tag.toLowerCase()}-${n}`,
        name: `${tag} P${n}`,
        subtitle: "t",
        story: "t",
        categoryId: category.id,
        family: "RESINOUS",
        model: "INCENSE",
        isActive: opts.isActive ?? true,
        isBestseller: opts.isBestseller ?? false,
        variants: { create: { sku: `${tag}-V${n}`, label: `L${n}`, price: opts.price, costPrice: opts.cost, stock: opts.stock ?? 50 } },
      },
      include: { variants: true },
    });
    return { id: p.id, v: p.variants[0]!, price: opts.price };
  };
  const P1 = await mkProduct(1, { price: 50000, cost: 10000 });
  const P2 = await mkProduct(2, { price: 30000, cost: null });
  const P3 = await mkProduct(3, { price: 20000, cost: 5000 });
  const P4 = await mkProduct(4, { price: 15000, cost: 5000 });
  const P5 = await mkProduct(5, { price: 10000, cost: 1000, isActive: false });
  const P6 = await mkProduct(6, { price: 10000, cost: 1000, stock: 0 });
  const P7 = await mkProduct(7, { price: 25000, cost: 9000, isBestseller: true });

  const U1 = await db.user.create({ data: { email: `${tag.toLowerCase()}-u1@test.local`, name: "Champion Buyer" } });
  const U2 = await db.user.create({ data: { email: `${tag.toLowerCase()}-u2@test.local`, name: "New Buyer" } });
  const U3 = await db.user.create({ data: { email: `${tag.toLowerCase()}-u3@test.local`, name: "Trade Buyer" } });
  const trade = await db.tradeAccount.create({
    data: { userId: U3.id, status: "APPROVED", businessName: `${tag} Traders`, businessType: "RETAILER", contactName: "T", phone: "+910000000000", address: addr },
  });

  let seq = 0;
  const order = async (o: {
    user: { id: string; email: string };
    status: OrderStatus;
    at: string;
    items: { p: { v: { id: string; sku: string }; price: number }; qty: number; price?: number }[];
    discount?: number;
    coupon?: string;
    hold?: boolean;
    provider?: PaymentProvider;
    trade?: boolean;
  }) => {
    const subtotal = o.items.reduce((s, i) => s + (i.price ?? i.p.price) * i.qty, 0);
    const total = subtotal - (o.discount ?? 0);
    return db.order.create({
      data: {
        number: `${tag}-${++seq}`,
        userId: o.user.id,
        email: o.user.email,
        status: o.status,
        currency: "INR",
        subtotal,
        discount: o.discount ?? 0,
        couponCode: o.coupon,
        shipping: 0,
        tax: 0,
        total,
        shippingAddress: addr,
        reservedUntil: o.hold ? new Date("2001-03-04T12:00:00Z") : null,
        tradeAccountId: o.trade ? trade.id : null,
        placedAt: ist(o.at),
        items: { create: o.items.map((i) => ({ variantId: i.p.v.id, name: "snapshot", label: "l", sku: i.p.v.sku, unitPrice: i.price ?? i.p.price, quantity: i.qty })) },
        ...(o.provider && { payments: { create: { provider: o.provider, status: o.status === "PENDING" ? "CREATED" : "CAPTURED", amount: total, currency: "INR" } } }),
      },
    });
  };

  const carts: string[] = [];
  try {
    // Current period: 1–10 Mar 2001 (IST). Previous: 19–28 Feb 2001.
    const o1 = await order({ user: U1, status: "PAID", at: "2001-03-02T10:00:00", items: [{ p: P1, qty: 2 }, { p: P2, qty: 1 }], discount: 10000, coupon: "TEST10", provider: "STRIPE" }); // 120000
    const o2 = await order({ user: U2, status: "DELIVERED", at: "2001-03-05T12:00:00", items: [{ p: P1, qty: 1 }, { p: P3, qty: 2 }], provider: "RAZORPAY" }); // 90000
    await order({ user: U1, status: "PENDING", at: "2001-03-06T01:00:00", items: [{ p: P2, qty: 1 }], provider: "COD" }); // 30000, confirmed COD; 5 Mar in UTC
    await order({ user: U3, status: "PENDING", at: "2001-03-08T11:00:00", items: [{ p: P1, qty: 4, price: 40000 }], provider: "INVOICE", trade: true }); // 160000 trade
    await order({ user: U2, status: "CANCELLED", at: "2001-03-03T09:00:00", items: [{ p: P1, qty: 1 }, { p: P3, qty: 1 }], provider: "STRIPE" }); // excluded
    await order({ user: U2, status: "PENDING", hold: true, at: "2001-03-04T09:00:00", items: [{ p: P1, qty: 1 }, { p: P2, qty: 1 }], provider: "STRIPE" }); // awaiting payment: excluded
    await order({ user: U2, status: "REFUNDED", at: "2001-03-07T09:00:00", items: [{ p: P3, qty: 1 }], provider: "STRIPE" }); // 20000 refunded
    await order({ user: U1, status: "PAID", at: "2001-02-20T09:00:00", items: [{ p: P1, qty: 1 }], provider: "STRIPE" }); // previous period 50000
    // Later in April (outside both periods) — co-occurrence data only.
    await order({ user: U2, status: "SHIPPED", at: "2001-04-15T09:00:00", items: [{ p: P1, qty: 1 }, { p: P2, qty: 1 }, { p: P5, qty: 1 }, { p: P6, qty: 1 }], provider: "STRIPE" }); // 100000
    await order({ user: U2, status: "PAID", at: "2001-04-20T09:00:00", items: [{ p: P1, qty: 1 }, { p: P5, qty: 1 }, { p: P6, qty: 1 }], provider: "STRIPE" }); // 70000

    // Returns (order stays DELIVERED/PAID): refunded and store credit resolved on 9 Mar, one resolved after the range,
    // one still open, and an exchange whose zero-value replacement order must not count as a sale.
    const ret = (n: number, orderId: string, data: Record<string, unknown>) => db.returnRequest.create({ data: { number: `${tag}-R${n}`, orderId, reason: "test", ...data } });
    await ret(1, o2.id, { status: "REFUNDED", resolution: "REFUND", refundAmount: 15000, resolvedAt: ist("2001-03-09T15:00:00") });
    await ret(2, o1.id, { status: "REFUNDED", resolution: "STORE_CREDIT", refundAmount: 5000, resolvedAt: ist("2001-03-09T16:00:00") });
    await ret(3, o1.id, { status: "REFUNDED", resolution: "REFUND", refundAmount: 7000, resolvedAt: ist("2001-03-15T10:00:00") });
    await ret(4, o2.id, { status: "REQUESTED", preferred: "REFUND" });
    const replacement = await order({ user: U2, status: "PAID", at: "2001-03-09T17:00:00", items: [{ p: P1, qty: 1, price: 0 }, { p: P3, qty: 1, price: 0 }] });
    await ret(5, o2.id, { status: "EXCHANGED", resolution: "EXCHANGE", resolvedAt: ist("2001-03-09T17:00:00"), exchangeOrderId: replacement.id });

    const c1 = await db.cart.create({ data: { createdAt: ist("2001-03-03T10:00:00"), items: { create: { variantId: P1.v.id, quantity: 1 } } } });
    const c2 = await db.cart.create({ data: { createdAt: ist("2001-03-04T10:00:00") } });
    carts.push(c1.id, c2.id);

    // ── 1. Ranges ──
    const r = makeRange("custom", "2001-03-01", "2001-03-10", TZ);
    const prev = previousRange(r);
    ok(r.days === 10 && r.granularity === "day" && r.start.toISOString() === "2001-02-28T18:30:00.000Z" && r.end.toISOString() === "2001-03-10T18:30:00.000Z", "range: 10 days, IST midnight boundaries");
    ok(prev.from === "2001-02-19" && prev.to === "2001-02-28" && prev.days === 10, `previous period is the equal span before (${prev.from}…${prev.to})`);
    const now = new Date("2026-10-07T06:00:00Z");
    const d30 = resolveRange({ range: "bogus" }, TZ, now);
    ok(d30.key === "30d" && d30.from === "2026-09-08" && d30.to === "2026-10-07", "invalid range falls back to 30 days ending today");
    const y = resolveRange({ range: "12m" }, TZ, now);
    ok(y.days === 365 && y.granularity === "week", "12 months → 365 days, weekly buckets");
    const sw = resolveRange({ range: "custom", from: "2026-10-01", to: "2026-09-01" }, TZ, now);
    ok(sw.from === "2026-09-01" && sw.to === "2026-10-01", "custom range with swapped dates is put in order");
    const fut = resolveRange({ range: "custom", from: "2026-10-01", to: "2027-01-01" }, TZ, now);
    ok(fut.to === "2026-10-07", "custom range end is clamped to today");
    ok(resolveRange({ range: "custom", from: "2026-02-30", to: "2026-03-01" }, TZ, now).key === "30d", "impossible date is rejected");

    // ── 2. KPIs ──
    const k = await getKpis(r);
    ok(k.grossRevenue === 420000 && k.orderRefunds === 20000 && k.returnRefunds === 15000 && k.storeCredit === 5000 && k.returnsRefunded === 2, `money back: order refund 200 + return refund 150 + store credit 50 (${k.orderRefunds}/${k.returnRefunds}/${k.storeCredit})`);
    ok(k.refunds === 40000 && k.netRevenue === 380000, `net = gross 4200 − 400 back = 3800 (${k.netRevenue}); open and later returns ignored`);
    ok(k.orders === 4 && k.refundedOrders === 1 && near(k.refundRate, 40000 / 420000), `orders 4 kept (exchange replacement excluded); refund share 9.5% (${k.orders}, ${k.refundRate})`);
    ok(k.aov === 95000, `AOV = net ÷ kept orders = ₹950 (${k.aov})`);
    ok(k.units === 11, `units 11, cancelled/pending/refunded/replacement excluded (${k.units})`);
    ok(k.merchandise === 410000 && k.costedMerchandise === 350000 && k.cost === 80000 && k.grossMargin === 270000, `margin: 3500 costed − 800 cost = 2700 (${k.costedMerchandise}/${k.cost}/${k.grossMargin})`);
    ok(near(k.marginRate, 270000 / 350000) && near(k.costCoverage, 350000 / 410000), "margin % on costed sales; cost coverage 85.4%");
    ok(k.customers === 3 && k.newCustomers === 2 && k.returningCustomers === 1, `customers 3: 2 new, 1 returning (${k.customers}/${k.newCustomers}/${k.returningCustomers})`);
    ok(k.couponDiscount === 10000 && k.couponOrders === 1, "coupon discount ₹100 on 1 order");
    const pk = await getKpis(prev);
    ok(pk.netRevenue === 50000 && pk.orders === 1 && pk.newCustomers === 1, "previous period: ₹500, 1 order, 1 new customer");
    ok(near(pctChange(k.netRevenue, pk.netRevenue), 6.6) && pctChange(5, 0) === null && pctChange(0, 0) === 0, "period change: +660%; from zero → null");

    // ── 3. Series ──
    const s = await getSalesSeries(r);
    const at = (d: string) => s.find((p) => p.date === d);
    ok(s.length === 10 && s[0]!.date === "2001-03-01" && s[9]!.date === "2001-03-10", "daily series has 10 zero-filled days");
    ok(at("2001-03-02")?.revenue === 120000 && at("2001-03-05")?.revenue === 90000 && at("2001-03-08")?.revenue === 160000, "daily revenue lands on the right days");
    ok(at("2001-03-06")?.revenue === 30000 && at("2001-03-06")?.orders === 1, "01:00 IST order buckets on the IST day, not the UTC one");
    ok(s.filter((p) => p.revenue === 0).length === 5 && at("2001-03-07")?.revenue === 0, "refunded/cancelled/empty days are zero");
    ok(at("2001-03-09")?.revenue === -20000 && at("2001-03-09")?.orders === 0, "return refunds come off the day they were resolved; replacement not an order");
    ok(s.reduce((a, p) => a + p.revenue, 0) === k.netRevenue, "series total equals net revenue");
    const wr = makeRange("custom", "2001-01-01", "2001-04-30", TZ);
    const ws = await getSalesSeries(wr);
    ok(wr.granularity === "week" && ws.length === bucketKeys(wr).length && ws.length === 18, `120 days → 18 weekly buckets (${ws.length})`);
    ok(ws.every((p) => new Date(`${p.date}T00:00:00Z`).getUTCDay() === 1), "weekly buckets start on Mondays");
    ok(ws.reduce((a, p) => a + p.revenue, 0) === 593000, "weekly total: every kept order minus returns resolved in range");

    // ── 4. Products, categories, channels, payments ──
    const tp = await getTopProducts(r);
    ok(tp.map((p) => p.productId).join() === [P1.id, P2.id, P3.id].join(), "top products ranked by revenue: P1, P2, P3");
    ok(tp[0]!.revenue === 310000 && tp[0]!.units === 7 && tp[0]!.orders === 3 && near(tp[0]!.marginRate, 240000 / 310000), "P1: ₹3100, 7 units, margin with cost");
    ok(tp[1]!.marginRate === null && tp[1]!.margin === null && tp[1]!.revenue === 60000, "P2 without a cost price: margin unknown");
    ok(near(tp[2]!.marginRate, 0.75) && tp[2]!.units === 2, "P3: refunded unit excluded, 75% margin");
    const cats = await getTopCategories(r);
    ok(cats.length === 1 && cats[0]!.revenue === 410000 && near(cats[0]!.share, 1), "category totals merchandise value");
    const ch = await getChannelSplit(r);
    const retail = ch.find((c) => c.key === "retail")!;
    const tr = ch.find((c) => c.key === "trade")!;
    ok(retail.orders === 3 && retail.revenue === 240000 && tr.orders === 1 && tr.revenue === 160000 && near(tr.share, 0.4), "channel: retail ₹2400 / trade ₹1600 (40%)");
    const pay = Object.fromEntries((await getPaymentSplit(r)).map((p) => [p.key, p.revenue]));
    ok(pay.STRIPE === 120000 && pay.RAZORPAY === 90000 && pay.COD === 30000 && pay.INVOICE === 160000 && Object.keys(pay).length === 4, "payment split by provider");

    // ── 5. Customers ──
    ok(segmentOf(5, 3) === "Champions" && segmentOf(40, 2) === "Loyal" && segmentOf(10, 1) === "New" && segmentOf(100, 1) === "At risk" && segmentOf(200, 5) === "Lost", "segment rules");
    const ci = await getCustomerInsights(r);
    ok(ci.customers === 3 && ci.repeatCustomers === 1 && near(ci.repeatRate, 1 / 3), "repeat purchase rate 1 of 3");
    ok(ci.top.map((c) => c.userId).join() === [U1.id, U3.id, U2.id].join() && ci.top[0]!.lifetimeValue === 200000 && ci.top[0]!.rangeRevenue === 150000, "top customers by lifetime value (April orders not yet counted)");
    ok(ci.top[0]!.segment === "Champions" && ci.top[2]!.segment === "New", "U1 Champion, U2 New");
    const seg = Object.fromEntries(ci.segments.map((x) => [x.segment, x.customers]));
    ok(seg.Champions === 1 && seg.New === 2 && seg.Loyal === 0 && seg["At risk"] === 0 && seg.Lost === 0, `segments as of the range end (${JSON.stringify(seg)})`);

    // ── 6. Funnel ──
    const f = Object.fromEntries((await getCartFunnel(r)).map((x) => [x.key, x.count]));
    ok(f.carts === 2 && f.items === 1 && f.placed === 7 && f.paid === 5, `funnel 2 → 1 → 7 placed → 5 confirmed (${JSON.stringify(f)})`);

    // ── 7. Recommendations ──
    const ranked = await rankRecommendations(P1.id, new Date("2001-06-01T00:00:00Z"));
    const pairs = ranked.filter((x) => x.reason === "pair");
    ok(pairs.map((x) => x.id).sort().join() === [P2.id, P5.id, P6.id].sort().join(), "pairs: P2, P5, P6 (2 shared orders each); P3 below threshold");
    ok(pairs.find((x) => x.id === P2.id)?.score === 2, "awaiting-payment order not counted (P2 shared = 2)");
    ok(!pairs.some((x) => x.id === P3.id), "cancelled, refunded and exchange-replacement orders don't create pairings");
    ok(!ranked.some((x) => x.id === P1.id), "never recommends the product itself");
    const shown = await pickAvailable(ranked, 4, [P1.id]);
    ok(shown.map((p) => p.id).join() === [P2.id, P3.id, P7.id, P4.id].join(), `shown: pairing first, then category best-sellers; inactive & sold-out skipped (${shown.map((p) => p.name).join(", ")})`);
    const old = await rankRecommendations(P1.id, new Date("2002-06-01T00:00:00Z"));
    ok(old.every((x) => x.reason === "bestseller") && old[0]?.id === P7.id, "outside the 365-day window → best-seller fallback only");
  } catch (e) {
    console.error("FAIL  unexpected error:", e);
    process.exitCode = 1;
  } finally {
    // ── Clean up ── (runs even after a failure)
    await db.order.deleteMany({ where: { number: { startsWith: tag } } }); // items, payments, returns cascade
    await db.cart.deleteMany({ where: { id: { in: carts } } });
    await db.user.deleteMany({ where: { email: { startsWith: tag.toLowerCase() } } }); // trade account cascades
    await db.product.deleteMany({ where: { categoryId: category.id } }); // variants cascade
    await db.category.delete({ where: { id: category.id } });
    const left =
      (await db.order.count({ where: { number: { startsWith: tag } } })) +
      (await db.user.count({ where: { email: { startsWith: tag.toLowerCase() } } })) +
      (await db.product.count({ where: { slug: { startsWith: tag.toLowerCase() } } })) +
      (await db.productVariant.count({ where: { sku: { startsWith: tag } } })) +
      (await db.cart.count({ where: { id: { in: carts } } })) +
      (await db.returnRequest.count({ where: { number: { startsWith: tag } } })) +
      (await db.tradeAccount.count({ where: { businessName: { startsWith: tag } } }));
    ok(left === 0, "test data removed");
    console.log("cleaned up");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
