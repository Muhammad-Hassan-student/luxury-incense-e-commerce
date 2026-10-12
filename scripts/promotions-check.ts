// Promotions engine (flash sales, bundles, tiers, stacking + guard), pre-orders and the affiliate programme, against the
// local database. Creates its own category/products/users/orders/promotions; restores settings and removes everything.
// Run: npm run test:promotions
import "./no-real-email";
import "dotenv/config";

export {};

const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};
const DOMAIN = "promo-check.invalid";

async function main() {
  const { db } = await import("@/server/db");
  const L = await import("@/lib/promotions");
  const { price } = await import("@/lib/pricing");
  const P = await import("@/server/promotions");
  const PO = await import("@/server/preorders");
  const A = await import("@/server/affiliates");
  const O = await import("@/server/orders");
  const { adjustStock } = await import("@/server/inventory");
  const { cartInclude, cartLines } = await import("@/server/cart-lines");
  const { bookingProblem } = await import("@/server/courier/fulfilment");
  const { orderPreorderHold } = await import("@/lib/preorder");
  type PromoDef = import("@/lib/promotions").PromoDef;

  // ───────────── 1. Engine maths (pure) ─────────────
  const now = new Date("2026-10-09T10:00:00Z");
  const base = { badge: null, productIds: [] as string[], categoryIds: [] as string[], startsAt: null as Date | null, endsAt: null as Date | null, isActive: true, priority: 100, stackable: true, allowCoupon: true, includeTrade: false, includeSubscriptions: false };
  const def = (id: string, type: string, config: unknown, extra: Partial<typeof base> = {}) => ({ ...base, id, name: id, type, config, ...extra }) as unknown as PromoDef;
  const line = (id: string, productId: string, listPrice: number, quantity: number, extra: Record<string, unknown> = {}) => ({ id, productId, categoryId: "catA", listPrice, quantity, ...extra });
  const run = (lines: ReturnType<typeof line>[], promotions: PromoDef[], ctx: { trade?: boolean; maxDiscountPercent?: number; now?: Date } = {}) =>
    L.evaluatePromotions({ lines, promotions, ctx: { now, maxDiscountPercent: 100, ...ctx } });
  const sale20 = def("s20", "FLASH_SALE", { kind: "PERCENT", value: 20 });

  let r = run([line("a", "P1", 100000, 2)], [sale20]);
  ok(r.lines[0].unitPrice === 80000 && r.saleSavings === 40000 && r.applied[0]?.discount === 40000, "flash sale 20%: ₹1,000 → ₹800, savings recorded");
  r = run([line("a", "P2", 60000, 1)], [def("f", "FLASH_SALE", { kind: "FIXED", value: 15000 })]);
  ok(r.lines[0].unitPrice === 45000, "flash sale fixed ₹150 off");
  r = run([line("a", "P1", 100000, 1)], [sale20, def("s30", "FLASH_SALE", { kind: "PERCENT", value: 30 })]);
  ok(r.lines[0].unitPrice === 70000, "two sales, same priority → bigger saving wins");
  r = run([line("a", "P1", 100000, 1)], [{ ...sale20, priority: 10 }, def("s30", "FLASH_SALE", { kind: "PERCENT", value: 30 })]);
  ok(r.lines[0].unitPrice === 80000, "lower priority number wins over a bigger saving");
  ok(run([line("a", "P1", 100000, 1)], [{ ...sale20, productIds: ["P9"] }]).lines[0].unitPrice === 100000 && run([line("a", "P1", 100000, 1)], [{ ...sale20, categoryIds: ["catA"] }]).lines[0].unitPrice === 80000, "targeting by product / category");

  // Schedule boundaries (end is exclusive, start inclusive)
  const at = (ms: number) => new Date(now.getTime() + ms);
  ok(run([line("a", "P1", 100000, 1)], [{ ...sale20, startsAt: at(1) }]).saleSavings === 0, "starts 1 ms from now → not live yet");
  ok(run([line("a", "P1", 100000, 1)], [{ ...sale20, startsAt: now }]).saleSavings === 20000, "starts exactly now → live");
  ok(run([line("a", "P1", 100000, 1)], [{ ...sale20, endsAt: now }]).saleSavings === 0, "ends exactly now → over (on time)");
  ok(run([line("a", "P1", 100000, 1)], [{ ...sale20, endsAt: at(1) }]).saleSavings === 20000, "ends 1 ms from now → still live");
  ok(run([line("a", "P1", 100000, 1)], [{ ...sale20, isActive: false }]).saleSavings === 0, "paused promotion never applies");

  // Bundles
  const three = [line("a", "P1", 100000, 1), line("b", "P2", 60000, 1), line("c", "P3", 40000, 1)];
  r = run(three, [def("b21", "BUY_X_GET_Y", { buyQty: 2, getQty: 1, getProductIds: [], getPercentOff: 100, maxApplications: null })]);
  ok(r.promoDiscount === 40000, "buy 2 get 1 free: cheapest piece free (₹400)");
  r = run(three.slice(0, 2), [def("b21", "BUY_X_GET_Y", { buyQty: 2, getQty: 1, getProductIds: [], getPercentOff: 100, maxApplications: null })]);
  ok(r.promoDiscount === 0 && r.nudges.some((n) => n.kind === "BUY_X_GET_Y" && n.addQty === 1), "two pieces → nudge “add 1 more to get 1 free”");
  r = run(three.slice(0, 2), [def("b11", "BUY_X_GET_Y", { buyQty: 1, getQty: 1, getProductIds: [], getPercentOff: 50, maxApplications: null })]);
  ok(r.promoDiscount === 30000, "buy 1 get 1 at 50%: half off the cheaper piece");
  r = run([three[0], three[2]], [def("gift", "BUY_X_GET_Y", { buyQty: 1, getQty: 1, getProductIds: ["P3"], getPercentOff: 100, maxApplications: null }, { productIds: ["P1"] })]);
  ok(r.promoDiscount === 40000, "buy P1 get P3 free (different products)");
  r = run([three[0]], [def("gift", "BUY_X_GET_Y", { buyQty: 1, getQty: 1, getProductIds: ["P3"], getPercentOff: 100, maxApplications: null }, { productIds: ["P1"] })]);
  ok(r.nudges.some((n) => n.kind === "BUY_X_GET_Y" && n.getProductIds.includes("P3")), "…without P3 → nudge to add it");
  r = run(three, [def("m3", "MULTI_BUY", { quantity: 3, price: 150000, maxApplications: null })]);
  ok(r.promoDiscount === 50000, "any 3 for ₹1,500 (₹2,000 of pieces → ₹500 off)");
  ok(run(three.slice(0, 2), [def("m3", "MULTI_BUY", { quantity: 3, price: 150000, maxApplications: null })]).nudges.some((n) => n.kind === "MULTI_BUY" && n.addQty === 1), "any-3 with two pieces → nudge add 1");
  ok(run([line("c", "P3", 40000, 3)], [def("m3", "MULTI_BUY", { quantity: 3, price: 150000, maxApplications: null })]).promoDiscount === 0, "any-3 never raises the price (₹1,200 < ₹1,500)");
  r = run(three, [def("fb", "FIXED_BUNDLE", { items: [{ productId: "P1", quantity: 1 }, { productId: "P2", quantity: 1 }], price: 140000 })]);
  ok(r.promoDiscount === 20000, "curated bundle P1+P2 for ₹1,400");
  ok(run([three[0]], [def("fb", "FIXED_BUNDLE", { items: [{ productId: "P1", quantity: 1 }, { productId: "P2", quantity: 1 }], price: 140000 })]).nudges.some((n) => n.kind === "FIXED_BUNDLE" && n.missing[0]?.productId === "P2"), "incomplete bundle → nudge names the missing piece");

  // Tiered
  const tier = def("t", "TIERED", { tiers: [{ threshold: 200000, percent: 10 }, { threshold: 400000, percent: 15 }] });
  r = run([line("a", "P1", 250000, 1)], [tier]);
  ok(r.promoDiscount === 25000 && r.tier?.next?.remaining === 150000, "tier ₹2,000→10%: ₹2,500 bag gets ₹250 off, ₹1,500 to the next tier");
  ok(run([line("a", "P1", 450000, 1)], [tier]).promoDiscount === 67500, "tier ₹4,000→15%");
  ok(run([line("a", "P1", 150000, 1)], [tier]).nudges.some((n) => n.kind === "TIERED" && n.remaining === 50000), "below the first tier → progress nudge");

  // Stacking order: sale → bundle → tier → coupon
  const stackLines = [line("a", "P1", 100000, 2), line("b", "P2", 60000, 1)];
  const bogo = def("b21", "BUY_X_GET_Y", { buyQty: 2, getQty: 1, getProductIds: [], getPercentOff: 100, maxApplications: null });
  const t10 = def("t10", "TIERED", { tiers: [{ threshold: 100000, percent: 10 }] });
  const sP1 = { ...sale20, productIds: ["P1"] };
  r = run(stackLines, [sP1, bogo, t10]);
  ok(r.saleSavings === 40000 && r.promoDiscount === 76000, `stacking: sale ₹400 + free piece ₹600 + 10% tier on ₹1,600 = ₹760 (got ${r.promoDiscount})`);
  const coupon = { code: "X", type: "PERCENT" as const, value: 10, minSubtotal: 0, maxUses: null, usedCount: 0, startsAt: null, endsAt: null, isActive: true };
  const pr = price({ lines: r.lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })), coupon, pointValue: 100, taxRatePercent: 18, taxInclusive: true, promo: { discount: r.promoDiscount, couponCap: r.couponCap, couponBlockedBy: r.couponBlockedBy } });
  ok(pr.discount === 90400 && pr.promoDiscount === 76000, `coupon applies last on what's left: 10% of ₹1,440 = ₹144 (total discount ${pr.discount})`);
  r = run(stackLines, [{ ...sP1, stackable: false }, bogo, t10]);
  ok(r.promoDiscount === 0, "non-stacking sale locks its pieces: no bundle, no tier on them");
  r = run(stackLines, [sP1, { ...t10, stackable: false }]);
  ok(!r.applied.some((a) => a.promotionId === "t10"), "non-stacking tier skipped when another promotion applied");
  r = run(stackLines, [{ ...sP1, allowCoupon: false }]);
  const blocked = price({ lines: r.lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })), coupon, pointValue: 100, taxRatePercent: 18, taxInclusive: true, promo: { discount: r.promoDiscount, couponCap: r.couponCap, couponBlockedBy: r.couponBlockedBy } });
  ok(Boolean(blocked.couponError?.includes("can’t be combined")) && blocked.discount === 0, "“no coupons” promotion refuses the coupon");

  // Max-discount guard
  r = run([line("a", "P1", 100000, 1)], [sale20, def("t50", "TIERED", { tiers: [{ threshold: 50000, percent: 50 }] })], { maxDiscountPercent: 30 });
  ok(r.saleSavings + r.promoDiscount === 30000 && r.couponCap === 0, `guard 30%: sale ₹200 + tier trimmed to ₹100 (promo ${r.promoDiscount}, cap ${r.couponCap})`);
  const guarded = price({ lines: r.lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })), coupon, pointValue: 100, taxRatePercent: 18, taxInclusive: true, promo: { discount: r.promoDiscount, couponCap: r.couponCap } });
  ok(guarded.discount + r.saleSavings <= 30000, "guard also caps the coupon");
  ok(run([line("a", "P1", 100000, 1)], [def("s80", "FLASH_SALE", { kind: "PERCENT", value: 80 })], { maxDiscountPercent: 30 }).lines[0].unitPrice === 70000, "a sale can't go below the guard floor");

  // Exclusions
  ok(run([line("a", "P1", 100000, 1, { subscription: true })], [sale20]).saleSavings === 0 && run([line("a", "P1", 100000, 1, { subscription: true })], [{ ...sale20, includeSubscriptions: true }]).saleSavings === 20000, "Subscribe & Save lines excluded unless enabled");
  ok(run([line("a", "P1", 100000, 1)], [sale20], { trade: true }).saleSavings === 0 && run([line("a", "P1", 100000, 1)], [{ ...sale20, includeTrade: true }], { trade: true }).saleSavings === 20000, "trade accounts excluded unless enabled");
  ok(run([line("a", "P1", 100000, 1, { excluded: true })], [sale20, t10]).saleSavings === 0, "gift cards / coffrets never discounted");

  // ───────────── 2. Database: server-side enforcement, pre-orders, affiliates ─────────────
  const tag = `prchk${Date.now().toString(36)}`;
  const email = (who: string) => `${who}-${tag}@${DOMAIN}`;
  const SETTING_KEYS = ["promotions", "affiliates"];
  const savedSettings = await db.setting.findMany({ where: { key: { in: SETTING_KEYS } } });
  const realVariantsBefore = await db.productVariant.findMany({ select: { id: true, stock: true, reserved: true } });
  const counts = () => Promise.all([db.order.count(), db.promotion.count(), db.affiliate.count(), db.coupon.count(), db.setting.count(), db.preorderVariant.count(), db.orderPromotion.count(), db.affiliateCommission.count()]);
  const countsBefore = await counts();
  const realLive = await P.livePromotions();
  if (realLive.length) console.log(`note: ${realLive.length} real promotion(s) live — the test targets its own category only`);

  const userIds: string[] = [];
  const cartIds: string[] = [];
  const promoIds: string[] = [];
  let affiliateId: string | null = null;
  const category = await db.category.create({ data: { slug: tag, name: `${tag} Cat`, tagline: "t", description: "t", ambient: "GLOW" } });
  const mk = async (n: number, priceMinor: number, stock: number) => {
    const p = await db.product.create({ data: { slug: `${tag}-${n}`, name: `${tag} P${n}`, subtitle: "t", story: "t", categoryId: category.id, family: "WOODY", model: "OIL" } });
    const v = await db.productVariant.create({ data: { productId: p.id, sku: `${tag}-${n}`.toUpperCase(), label: "10 ml", price: priceMinor, stock, weightGrams: 200 } });
    return { p, v };
  };
  const P1 = await mk(1, 100000, 50);
  const P2 = await mk(2, 60000, 50);
  const P4 = await mk(4, 50000, 0); // pre-order piece, no stock
  const user = async (who: string, extra: { referredById?: string } = {}) => {
    const u = await db.user.create({ data: { email: email(who), name: `PC ${who}`, ...extra } });
    userIds.push(u.id);
    return u;
  };
  const addr = { fullName: "Promo Tester", phone: "+91 98000 00002", line1: "1 MG Road", city: "Bengaluru", state: "KA", postalCode: "560001", country: "IN" };
  const makeCart = async (u: { id: string; email: string }, items: { variantId: string; quantity: number }[], couponId?: string) => {
    const c = await db.cart.create({ data: { email: u.email, couponId, items: { create: items } } });
    cartIds.push(c.id);
    return db.cart.findUniqueOrThrow({ where: { id: c.id }, include: cartInclude });
  };
  const place = async (u: { id: string; email: string }, items: { variantId: string; quantity: number }[], opts: { touch?: import("@/server/affiliates").AffiliateTouch; tamper?: boolean; couponId?: string } = {}) => {
    const cart = await makeCart(u, items, opts.couponId);
    let lines = await cartLines(cart);
    if (opts.tamper) lines = lines.map((l) => ({ ...l, unitPrice: 1, compareAtPrice: null }));
    const { order } = await O.placeOrder({ cart, lines, userId: u.id, email: u.email, address: addr, shippingRateId: "ship-in", provider: "COD", pointsRequested: 0, giftWrap: false, affiliate: opts.touch ?? null });
    return db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
  };

  try {
    await db.setting.upsert({ where: { key: "promotions" }, update: { value: { maxDiscountPercent: 60 } }, create: { key: "promotions", value: { maxDiscountPercent: 60 } } });
    const sale = await db.promotion.create({ data: { name: `${tag} sale`, type: "FLASH_SALE", config: { kind: "PERCENT", value: 20 }, productIds: [P1.p.id], endsAt: new Date(Date.now() + 3600_000) } });
    const tierPromo = await db.promotion.create({ data: { name: `${tag} tier`, type: "TIERED", config: { tiers: [{ threshold: 120000, percent: 10 }] }, categoryIds: [category.id] } });
    promoIds.push(sale.id, tierPromo.id);

    const C = await user("cust");
    const cart = await makeCart(C, [{ variantId: P1.v.id, quantity: 1 }, { variantId: P2.v.id, quantity: 1 }]);
    const lines = await cartLines(cart);
    const l1 = lines.find((l) => l.variantId === P1.v.id)!;
    ok(l1.unitPrice === 80000 && l1.compareAtPrice === 100000 && Boolean(l1.sale), "bag line shows the sale price with the list price struck through");
    const q = await O.quote({ lines: lines.map((l) => ({ ...l, unitPrice: 1 })), cart, userId: C.id });
    ok(q.pricing.subtotal === 140000 && q.pricing.promoDiscount === 14000, `tampered client price ignored: quote re-prices from the database (subtotal ${q.pricing.subtotal}, offers ${q.pricing.promoDiscount})`);

    const o1 = await place(C, [{ variantId: P1.v.id, quantity: 1 }, { variantId: P2.v.id, quantity: 1 }], { tamper: true });
    ok(o1.subtotal === 140000 && o1.discount === 14000 && o1.items.some((i) => i.unitPrice === 80000), "placed order uses server prices: ₹1,400 subtotal, ₹140 tier discount");
    const ops = await db.orderPromotion.findMany({ where: { orderId: o1.id } });
    ok(ops.length === 2 && ops.some((x) => x.promotionId === sale.id && x.discount === 20000), "order records which promotions applied (usage)");
    const stats = await P.promotionStats();
    ok(stats.get(sale.id)?.uses === 1 && (stats.get(tierPromo.id)?.revenue ?? 0) > 0, "admin stats: uses + attributed revenue");

    await db.promotion.update({ where: { id: sale.id }, data: { endsAt: new Date(Date.now() - 1) } });
    const after = await cartLines(await db.cart.findUniqueOrThrow({ where: { id: cart.id }, include: cartInclude }));
    ok(after.find((l) => l.variantId === P1.v.id)?.unitPrice === 100000, "sale over (server time) → list price again");
    const sf = await P.storefrontPromos();
    ok(!sf.sales.some((s) => s.id === sale.id), "storefront no longer shows the ended sale");

    // ── Pre-orders ──
    await db.preorderVariant.create({ data: { variantId: P4.v.id, shipDate: new Date(Date.now() + 20 * 86400_000), cap: 3 } });
    const C2 = await user("pre");
    const preCart = await makeCart(C2, [{ variantId: P4.v.id, quantity: 2 }]);
    const preLines = await cartLines(preCart);
    ok(preLines[0]?.available === 3 && Boolean(preLines[0]?.preorder), "pre-order line: availability from the allocation (3), not stock (0)");
    const p1 = await place(C2, [{ variantId: P4.v.id, quantity: 2 }]);
    let v4 = await db.productVariant.findUniqueOrThrow({ where: { id: P4.v.id } });
    let pv = await db.preorderVariant.findUniqueOrThrow({ where: { variantId: P4.v.id } });
    ok(v4.stock === 0 && v4.reserved === 0 && pv.sold === 2, "pre-ordered units don't touch on-hand stock; allocation counts 2");
    ok(Boolean(orderPreorderHold(p1.items)) && Boolean(bookingProblem({ ...p1, items: p1.items })?.includes("Pre-order")), "order held for fulfilment (courier booking refused)");
    let threw = false;
    try {
      await O.advanceOrder(p1.id, "PACKED");
    } catch {
      threw = true;
    }
    ok(threw, "can't pack a held pre-order");
    threw = false;
    try {
      await place(C2, [{ variantId: P4.v.id, quantity: 2 }]);
    } catch (e) {
      threw = e instanceof O.CheckoutError;
    }
    ok(threw, "cap 3: a second 2-unit pre-order is refused");
    threw = false;
    try {
      await db.$transaction((tx) => PO.allocatePreorder(tx, P4.v.id, 2));
    } catch (e) {
      threw = e instanceof PO.PreorderFullError;
    }
    ok(threw, "allocation is atomic against the cap");
    await O.cancelOrder(p1.id, "test");
    pv = await db.preorderVariant.findUniqueOrThrow({ where: { variantId: P4.v.id } });
    ok(pv.sold === 0, "cancelling gives the allocation back");
    const p2 = await place(C2, [{ variantId: P4.v.id, quantity: 2 }]);
    await db.$transaction((tx) => adjustStock(tx, P4.v.id, 5, "RESTOCK"));
    const rel = await PO.releasePreorders(P4.v.id, null);
    v4 = await db.productVariant.findUniqueOrThrow({ where: { id: P4.v.id } });
    const p2items = await db.orderItem.findMany({ where: { orderId: p2.id } });
    ok(rel.released.length === 1 && v4.stock === 3 && !orderPreorderHold(p2items), "stock arrives → release takes 2 from stock and lifts the hold");
    await O.cancelOrder(p2.id, "test");
    v4 = await db.productVariant.findUniqueOrThrow({ where: { id: P4.v.id } });
    ok(v4.stock === 5, "cancelling a released pre-order returns its stock");

    // ── Affiliates ──
    await A.saveAffiliateSettings({ enabled: true, defaultCommissionPercent: 10, cookieDays: 30, holdDays: 0, minPayout: 0 });
    const AF = await user("aff");
    const aff = await A.inviteAffiliate({ email: AF.email });
    affiliateId = aff.id;
    ok(aff.status === "APPROVED" && aff.userId === AF.id, "inviting an existing customer approves and links them");
    const c1 = await A.recordClick({ code: aff.code, ip: "203.0.113.5", deviceId: "dev-visitor" });
    await A.noteAffiliateDevice(aff.id, "198.51.100.7", "dev-aff");
    const c2 = await A.recordClick({ code: aff.code, ip: "198.51.100.7", deviceId: "dev-aff" });
    ok(c1.ok && c1.counted === true && c2.counted === false, "clicks counted; the affiliate's own device ignored");

    const old = await place(C, [{ variantId: P2.v.id, quantity: 1 }], { touch: { cookie: A.affCookieValue(aff.code, Date.now() - 31 * 86400_000) } });
    ok(!(await db.affiliateCommission.findUnique({ where: { orderId: old.id } })), "click 31 days ago (window 30) → no attribution");
    const won = await place(C, [{ variantId: P2.v.id, quantity: 1 }], { touch: { cookie: A.affCookieValue(aff.code, Date.now() - 86400_000), ip: "203.0.113.5" } });
    let com = await db.affiliateCommission.findUniqueOrThrow({ where: { orderId: won.id } });
    ok(com.status === "PENDING" && com.source === "link" && com.base > 0 && com.base < 60000 && com.amount === Math.round(com.base / 10) && !com.flags.length, `last click within window → PENDING ₹${com.amount / 100} (10% of ₹${com.base / 100} net of tax)`);
    await O.refundOrder(won.id, "test refund");
    com = await db.affiliateCommission.findUniqueOrThrow({ where: { orderId: won.id } });
    ok(com.status === "REVERSED" && com.amount === 0, "refund reverses the commission");

    const self = await place(AF, [{ variantId: P2.v.id, quantity: 1 }], { touch: { cookie: A.affCookieValue(aff.code) } });
    com = await db.affiliateCommission.findUniqueOrThrow({ where: { orderId: self.id } });
    ok(com.status === "REJECTED" && com.flags.includes("self_referral"), "self-referral blocked");
    const flagged = await place(C2, [{ variantId: P2.v.id, quantity: 1 }], { touch: { cookie: A.affCookieValue(aff.code), ip: "198.51.100.7", deviceId: "dev-aff" } });
    com = await db.affiliateCommission.findUniqueOrThrow({ where: { orderId: flagged.id } });
    ok(com.flags.includes("same_ip") && com.flags.includes("same_device"), "order from the affiliate's IP/device flagged");

    const X = await user("referrer");
    const R = await user("referred", { referredById: X.id });
    const refOrder = await place(R, [{ variantId: P2.v.id, quantity: 1 }], { touch: { cookie: A.affCookieValue(aff.code) } });
    com = await db.affiliateCommission.findUniqueOrThrow({ where: { orderId: refOrder.id } });
    const xPoints = (await db.user.findUniqueOrThrow({ where: { id: X.id } })).loyaltyPoints;
    ok(com.status === "REJECTED" && com.flags.includes("referral_precedence") && xPoints === O.REFERRAL_BONUS, "referral bonus paid → no affiliate commission on the same order");

    const cp = await db.coupon.create({ data: { code: `${tag}AFF`.toUpperCase(), type: "PERCENT", value: 5 } });
    await db.affiliate.update({ where: { id: aff.id }, data: { couponCode: cp.code } });
    const byCode = await place(C2, [{ variantId: P2.v.id, quantity: 1 }], { couponId: cp.id });
    com = await db.affiliateCommission.findUniqueOrThrow({ where: { orderId: byCode.id } });
    ok(com.source === "code" && com.status === "PENDING", "personal discount code attributes without a cookie");

    // Approve after delivery + hold, pay out, then claw back on a late refund.
    for (const s of ["PACKED", "SHIPPED", "DELIVERED"] as const) await O.advanceOrder(byCode.id, s);
    const sweep = await A.runAffiliateSweep();
    com = await db.affiliateCommission.findUniqueOrThrow({ where: { orderId: byCode.id } });
    ok(sweep.approved >= 1 && com.status === "APPROVED", "delivered + past the hold → approved by the daily sweep");
    const flaggedNow = await db.affiliateCommission.findUniqueOrThrow({ where: { orderId: flagged.id } });
    ok(flaggedNow.status === "PENDING", "flagged commissions are never auto-approved");
    const batch = await A.createPayoutBatch(AF.id, { affiliateIds: [aff.id], reference: "TEST" });
    com = await db.affiliateCommission.findUniqueOrThrow({ where: { orderId: byCode.id } });
    const csv = await A.payoutCsv(batch.batch);
    ok(batch.paid.length === 1 && com.status === "PAID" && csv.includes(aff.code), "payout batch marks it paid; CSV export lists the affiliate");
    await O.refundOrder(byCode.id, "late refund");
    com = await db.affiliateCommission.findUniqueOrThrow({ where: { orderId: byCode.id } });
    ok(com.status === "REVERSED" && com.clawback === com.amount && com.amount > 0, "refund after payout → clawback for the next payout");
    const statsA = await A.affiliateStats(aff.id);
    ok(statsA.clicks === 1 && statsA.clawback === com.clawback, "dashboard stats: clicks + outstanding clawback");
  } finally {
    const orders = await db.order.findMany({ where: { OR: [{ email: { endsWith: `@${DOMAIN}` } }, { userId: { in: userIds } }] }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    await db.orderPromotion.deleteMany({ where: { OR: [{ orderId: { in: orderIds } }, { promotionId: { in: promoIds } }] } });
    if (affiliateId) {
      await db.affiliateCommission.deleteMany({ where: { affiliateId } });
      await db.affiliateClick.deleteMany({ where: { affiliateId } });
      await db.affiliatePayout.deleteMany({ where: { affiliateId } });
    }
    await db.affiliateCommission.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.affiliate.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await db.promotion.deleteMany({ where: { id: { in: promoIds } } });
    await db.preorderVariant.deleteMany({ where: { variantId: P4.v.id } });
    await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: orderIds } }] } });
    await db.inventoryLog.deleteMany({ where: { OR: [{ orderId: { in: orderIds } }, { variantId: { in: [P1.v.id, P2.v.id, P4.v.id] } }] } });
    await db.whatsAppMessage.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
    await db.order.deleteMany({ where: { id: { in: orderIds } } });
    await db.cart.deleteMany({ where: { OR: [{ id: { in: cartIds } }, { userId: { in: userIds } }] } });
    await db.coupon.deleteMany({ where: { code: `${tag}AFF`.toUpperCase() } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.product.deleteMany({ where: { categoryId: category.id } });
    await db.category.delete({ where: { id: category.id } });
    await db.setting.deleteMany({ where: { key: { in: SETTING_KEYS } } });
    for (const s of savedSettings) await db.setting.create({ data: { key: s.key, value: s.value as object } });

    const realAfter = await db.productVariant.findMany({ select: { id: true, stock: true, reserved: true } });
    const key = (v: { id: string; stock: number; reserved: number }) => `${v.id}:${v.stock}:${v.reserved}`;
    ok(JSON.stringify(realAfter.map(key).sort()) === JSON.stringify(realVariantsBefore.map(key).sort()), "real catalogue stock unchanged; test variants removed");
    const countsAfter = await counts();
    ok(countsAfter.join() === countsBefore.join(), `no orders, promotions, affiliates, coupons or settings left behind (${countsAfter.join("/")})`);
    console.log("cleaned up");
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
