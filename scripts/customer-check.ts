// Customer-account checks against the local database: invoices, self-cancel, account deletion,
// data export and the staff CSV. Creates and cleans up its own data.
// Run: npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/customer-check.ts
//
// Emails go to the console: the Resend key is blanked before any module reads the environment.
process.env.RESEND_API_KEY = "";

// A module (not a global script), so helpers don't clash with other check scripts.
export {};

const DOMAIN = "customer-check.invalid";
const addr = { fullName: "Check Buyer", phone: "+919800000000", line1: "7 Lodhi Road", line2: "Flat 2", city: "New Delhi", state: "DL", postalCode: "110003", country: "IN" };
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};

async function main() {
  await import("dotenv/config");
  const { db } = await import("@/server/db");
  const { cartInclude, cartLines } = await import("@/server/cart-lines");
  const { placeOrder } = await import("@/server/orders");
  const inv = await import("@/server/invoices");
  const privacy = await import("@/server/privacy");
  const { brand } = await import("@/config/brand");

  const tag = Date.now().toString(36);
  const email = (who: string) => `${who}-${tag}@${DOMAIN}`;
  const userIds: string[] = [];
  const cartIds: string[] = [];

  // A plain physical variant with stock that the order-lifecycle script doesn't touch.
  const v = await db.productVariant.findFirstOrThrow({
    where: {
      stock: { gte: 20 },
      sku: { notIn: ["NAG-CHAMPA-NOIR-20-STICKS", "JASMINE-MAJLIS-CANDLE-CLASSIC-220-G"] },
      price: { gt: 0 },
      product: { isActive: true, isGiftCard: false, slug: { not: "build-your-coffret" } },
    },
    include: { product: { select: { id: true, ratingAvg: true, ratingCount: true } } },
    orderBy: { stock: "desc" },
  });
  const stock = async () => (await db.productVariant.findUniqueOrThrow({ where: { id: v.id } })).stock;

  const newUser = async (who: string, extra: { role?: "CUSTOMER" | "SUPPORT" } = {}) => {
    const u = await db.user.create({ data: { email: email(who), name: `CC ${who}`, phone: "+919811111111", ...extra } });
    userIds.push(u.id);
    return u;
  };
  const codOrder = async (user: { id: string; email: string }, quantity = 2) => {
    const c = await db.cart.create({ data: { email: user.email, items: { create: [{ variantId: v.id, quantity }] } } });
    cartIds.push(c.id);
    const cart = await db.cart.findUniqueOrThrow({ where: { id: c.id }, include: cartInclude });
    const { order } = await placeOrder({ cart, lines: await cartLines(cart), userId: user.id, email: user.email, address: addr, shippingRateId: "ship-in", provider: "COD", pointsRequested: 0, giftWrap: false });
    return order;
  };
  const loadForInvoice = (id: string) =>
    db.order.findUniqueOrThrow({
      where: { id },
      include: { items: { orderBy: { id: "asc" } }, payments: { orderBy: { createdAt: "asc" } }, events: { orderBy: { createdAt: "asc" } }, user: { select: { name: true, phone: true } } },
    });

  try {
    const alice = await newUser("alice");
    const bob = await newUser("bob");

    // ── 1. Invoice maths ──
    const stockBefore = await stock();
    const o1 = await codOrder(alice, 2);
    const full = await loadForInvoice(o1.id);
    const incl = inv.buildInvoice(full, { taxRatePercent: 18, taxInclusive: true });
    const goods = v.price * 2 - full.discount - full.pointsRedeemed * brand.loyalty.pointValue;
    ok(incl.invoiceNumber === `INV-${full.number}`, `invoice number ${incl.invoiceNumber}`);
    ok(incl.tax.label === "GST (included)" && incl.tax.inclusive, "inclusive tax labelled GST (included)");
    ok(incl.tax.amount === Math.round(goods - goods / 1.18), `GST included = ${incl.tax.amount} (goods ${goods} @18%)`);
    ok(incl.tax.taxableValue + incl.tax.amount === goods, `taxable value ${incl.tax.taxableValue} + GST ${incl.tax.amount} = goods ${goods}`);
    ok(incl.total === full.total && incl.amountPaid === full.total - full.giftCardAmount && incl.shippingAndWrap === full.shipping, "totals carried from order");
    ok(incl.paymentMethod === "Cash on delivery" && !incl.paid, `payment: ${incl.paymentMethod}, due on delivery`);
    ok(incl.lines.length === 1 && incl.lines[0].amount === v.price * 2, "line amounts");
    const excl = inv.buildInvoice({ ...full, tax: Math.round(goods * 0.18) }, { taxRatePercent: 18, taxInclusive: false });
    ok(excl.tax.label === "GST" && excl.tax.taxableValue === goods && excl.tax.amount === Math.round(goods * 0.18), "exclusive tax: taxable value = goods");
    ok(inv.invoiceAvailable(full), "invoice available for confirmed COD order");
    ok((await inv.getCustomerInvoice(alice.id, full.number))?.orderNumber === full.number, "customer can load own invoice");
    ok((await inv.getCustomerInvoice(bob.id, full.number)) === null, "another customer cannot load it");
    ok(!inv.invoiceAvailable({ status: "PENDING", reservedUntil: new Date(Date.now() + 60_000), events: [{ status: "PENDING", message: "Order placed — awaiting payment" }] }), "no invoice while awaiting payment");
    ok(
      !inv.invoiceAvailable({ status: "CANCELLED", reservedUntil: null, events: [{ status: "PENDING", message: "Order placed — awaiting payment" }, { status: "CANCELLED", message: "Payment window expired — items released" }] }),
      "no invoice for an order cancelled before payment",
    );

    // ── 2. Self-cancel rules ──
    const mode = (status: Parameters<typeof inv.selfCancelMode>[0]["status"], held = false) => inv.selfCancelMode({ status, reservedUntil: held ? new Date() : null });
    ok(mode("PENDING") === "cancel", "confirmed COD → cancel");
    ok(mode("PAID") === "refund", "paid online → refund");
    ok(mode("PENDING", true) === null, "awaiting payment → not allowed");
    for (const s of ["PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"] as const) ok(mode(s) === null, `${s} → not allowed`);

    let err: unknown = null;
    try {
      await inv.selfCancelOrder({ userId: bob.id, orderNumber: full.number });
    } catch (e) {
      err = e;
    }
    ok(err instanceof inv.SelfCancelError && (await db.order.findUniqueOrThrow({ where: { id: o1.id } })).status === "PENDING", "cannot cancel someone else’s order");

    // ── 3. COD self-cancel restores stock ──
    ok((await stock()) === stockBefore - 2, `COD order committed stock (${stockBefore} → ${stockBefore - 2})`);
    const res = await inv.selfCancelOrder({ userId: alice.id, orderNumber: full.number, reason: "Ordered by mistake" });
    const cancelled = await db.order.findUniqueOrThrow({ where: { id: o1.id }, include: { events: { orderBy: { createdAt: "asc" } } } });
    ok(res.mode === "cancel" && cancelled.status === "CANCELLED", `self-cancel → ${cancelled.status}`);
    ok((await stock()) === stockBefore, `stock restored (${await stock()})`);
    ok(cancelled.events.some((e) => e.status === "CANCELLED" && e.message.startsWith("Cancelled by customer")), "cancellation event recorded");
    ok((await db.user.findUniqueOrThrow({ where: { id: alice.id } })).loyaltyPoints === 0, "points reversed");
    ok(inv.invoiceAvailable(cancelled), "confirmed-then-cancelled order keeps its (void) invoice");
    err = null;
    try {
      await inv.selfCancelOrder({ userId: alice.id, orderNumber: full.number });
    } catch (e) {
      err = e;
    }
    ok(err instanceof inv.SelfCancelError, "cannot cancel twice");

    // Packed orders can't be cancelled.
    const o2 = await codOrder(alice, 1);
    await db.order.update({ where: { id: o2.id }, data: { status: "PACKED" } });
    err = null;
    try {
      await inv.selfCancelOrder({ userId: alice.id, orderNumber: o2.number });
    } catch (e) {
      err = e;
    }
    ok(err instanceof inv.SelfCancelError && (await db.order.findUniqueOrThrow({ where: { id: o2.id } })).status === "PACKED", "packed order → refused, unchanged");

    // Paid online, provider refund fails → friendly error, nothing changes.
    const o3 = await codOrder(alice, 1);
    await db.order.update({ where: { id: o3.id }, data: { status: "PAID" } });
    await db.payment.updateMany({ where: { orderId: o3.id }, data: { provider: "RAZORPAY", status: "CAPTURED", raw: {} } });
    const stockPaid = await stock();
    err = null;
    try {
      await inv.selfCancelOrder({ userId: alice.id, orderNumber: o3.number });
    } catch (e) {
      err = e;
    }
    const o3After = await db.order.findUniqueOrThrow({ where: { id: o3.id }, include: { payments: true } });
    ok(err instanceof inv.SelfCancelError && /contact/i.test((err as Error).message), `refund failure → friendly error: “${(err as Error | null)?.message}”`);
    ok(o3After.status === "PAID" && o3After.payments[0].status === "CAPTURED" && (await stock()) === stockPaid, "refund failure leaves order, payment and stock unchanged");

    // Paid, refund succeeds (COD provider = no external call) → REFUNDED and restocked.
    await db.payment.updateMany({ where: { orderId: o3.id }, data: { provider: "COD" } });
    const r2 = await inv.selfCancelOrder({ userId: alice.id, orderNumber: o3.number, reason: null });
    const o3Done = await db.order.findUniqueOrThrow({ where: { id: o3.id }, include: { payments: true } });
    ok(r2.mode === "refund" && o3Done.status === "REFUNDED" && o3Done.payments[0].status === "REFUNDED" && (await stock()) === stockPaid + 1, "paid self-cancel → refunded and restocked");

    // ── 4. CSV escaping & formula protection ──
    ok(inv.csvCell("plain") === "plain", "plain cell");
    ok(inv.csvCell("a,b") === '"a,b"', "comma quoted");
    ok(inv.csvCell('say "hi"') === '"say ""hi"""', "quotes doubled");
    ok(inv.csvCell("line\nbreak") === '"line\nbreak"', "newline quoted");
    ok(inv.csvCell("=HYPERLINK(\"x\")") === "\"'=HYPERLINK(\"\"x\"\")\"", "formula with quotes neutralised and quoted");
    ok(["=1+1", "+1", "-1", "@SUM(A1)"].every((s) => inv.csvCell(s) === `'${s}`), "= + - @ prefixed with apostrophe");
    ok(inv.csvCell(42) === "42" && inv.csvCell(null) === "", "numbers and nulls");
    ok(inv.rupees(123456) === "1234.56" && inv.rupees(0) === "0.00", "money in rupees, 2dp");
    await db.order.update({ where: { id: o2.id }, data: { shippingAddress: { ...addr, fullName: "=cmd|' /C calc'!A0" } } });
    const { csv } = await inv.ordersCsv({ status: "PACKED", from: new Date(Date.now() - 3_600_000) });
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    ok(lines[0] === inv.CSV_HEADER.join(","), "CSV header");
    const row = lines.find((l) => l.startsWith(o2.number));
    ok(Boolean(row?.includes(",'=cmd|' /C calc'!A0,")) && Boolean(row?.includes(`,${inv.rupees(o2.total)},COD,`)), `CSV row for ${o2.number} is protected`);
    ok(!lines.some((l) => l.startsWith(o3.number)), "status filter applied");

    // ── 5. Export holds only the requester's data ──
    await db.address.create({ data: { userId: alice.id, ...addr } });
    await db.address.create({ data: { userId: bob.id, ...addr, fullName: "Bob Private" } });
    const o4 = await codOrder(bob, 1);
    const exp = await privacy.exportUserData(alice.id);
    const json = JSON.stringify(exp);
    ok(exp.profile.email === alice.email && exp.addresses.length === 1, "export: own profile and addresses");
    ok(exp.orders.some((o) => o.number === o2.number) && !exp.orders.some((o) => o.number === o4.number), "export: own orders only");
    ok(!json.includes(bob.email) && !json.includes("Bob Private") && !json.includes(bob.id), "export: no trace of another customer");

    // ── 6. Account deletion ──
    await db.wishlistItem.create({ data: { userId: alice.id, productId: v.product.id } });
    await db.review.create({ data: { userId: alice.id, productId: v.product.id, rating: 5, title: "Lovely", body: "Test review" } });
    await db.newsletterSubscriber.create({ data: { email: alice.email } });
    await db.stockAlert.create({ data: { productId: v.product.id, email: alice.email } });
    await db.session.create({ data: { userId: alice.id, sessionToken: `cc-${tag}`, expires: new Date(Date.now() + 86_400_000) } });
    await db.loyaltyEntry.create({ data: { userId: alice.id, points: 50, reason: "test" } });
    await db.user.update({ where: { id: alice.id }, data: { loyaltyPoints: 50 } });
    const userCart = await db.cart.create({ data: { userId: alice.id, items: { create: [{ variantId: v.id, quantity: 1 }] } } });
    cartIds.push(userCart.id);

    const refused = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        return null;
      } catch (e) {
        return e instanceof privacy.PrivacyError ? e.message : `unexpected: ${String(e)}`;
      }
    };
    ok((await refused(() => privacy.deleteAccount(alice.id, { email: alice.email, phrase: "delete" }))) !== null, "deletion needs DELETE");
    ok((await refused(() => privacy.deleteAccount(alice.id, { email: bob.email, phrase: "DELETE" }))) !== null, "deletion needs own email");
    const staff = await newUser("staff", { role: "SUPPORT" });
    const staffMsg = await refused(() => privacy.deleteAccount(staff.id, { email: staff.email, phrase: "DELETE" }));
    ok(Boolean(staffMsg?.includes("ask the owner to remove your staff access first")), `staff refused: “${staffMsg}”`);

    await privacy.deleteAccount(alice.id, { email: alice.email.toUpperCase(), phrase: "DELETE" });
    const gone = await db.user.findUniqueOrThrow({ where: { id: alice.id } });
    ok(gone.email === `deleted-${alice.id}@deleted.invalid` && gone.name === null && gone.phone === null && gone.image === null && gone.loyaltyPoints === 0, "user PII scrubbed, points 0");
    const counts = await Promise.all([
      db.address.count({ where: { userId: alice.id } }),
      db.session.count({ where: { userId: alice.id } }),
      db.wishlistItem.count({ where: { userId: alice.id } }),
      db.review.count({ where: { userId: alice.id } }),
      db.cart.count({ where: { userId: alice.id } }),
      db.loyaltyEntry.count({ where: { userId: alice.id } }),
      db.newsletterSubscriber.count({ where: { email: alice.email } }),
      db.stockAlert.count({ where: { email: alice.email } }),
    ]);
    ok(counts.every((n) => n === 0), `addresses, sessions, wishlist, reviews, cart, ledger, newsletter, stock alerts deleted (${counts.join(",")})`);
    const kept = await db.order.findMany({ where: { id: { in: [o1.id, o2.id, o3.id] } } });
    const shipped = kept.map((o) => o.shippingAddress as Record<string, string>);
    ok(kept.length === 3 && kept.every((o) => o.userId === null && o.email === gone.email), "orders kept, detached from the user");
    ok(shipped.every((a) => a.fullName === "Deleted" && a.phone === "Deleted" && a.line1 === "Deleted" && a.line2 === "Deleted" && a.city === addr.city), "order address personal fields replaced");
    ok(kept.every((o) => o.total > 0 && o.tax >= 0), "order money kept for tax records");
    const bobAfter = await db.user.findUniqueOrThrow({ where: { id: bob.id } });
    ok(bobAfter.email === bob.email && (await db.address.count({ where: { userId: bob.id } })) === 1 && (await db.order.count({ where: { userId: bob.id } })) === 1, "other customers untouched");
    const product = await db.product.findUniqueOrThrow({ where: { id: v.product.id } });
    ok(product.ratingAvg === v.product.ratingAvg && product.ratingCount === v.product.ratingCount, "unapproved review removal leaves ratings alone");
  } finally {
    // Clean up everything this run created and put stock back.
    const orders = await db.order.findMany({ where: { OR: [{ email: { endsWith: `@${DOMAIN}` } }, { userId: { in: userIds } }, ...userIds.map((id) => ({ email: `deleted-${id}@deleted.invalid` }))] }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    await db.inventoryLog.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.order.deleteMany({ where: { id: { in: orderIds } } });
    await db.cart.deleteMany({ where: { OR: [{ id: { in: cartIds } }, { userId: { in: userIds } }] } });
    await db.newsletterSubscriber.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await db.stockAlert.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.productVariant.update({ where: { id: v.id }, data: { stock: v.stock, reserved: v.reserved } });
    await db.product.update({ where: { id: v.product.id }, data: { ratingAvg: v.product.ratingAvg, ratingCount: v.product.ratingCount } });
    console.log("cleaned up");
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
