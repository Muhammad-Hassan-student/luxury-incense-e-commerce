// Order lifecycle checks against the local database (creates and cleans up its own test data).
// Run: npm run test:orders
import "dotenv/config";
import { db } from "@/server/db";
import { cartInclude, cartLines } from "@/server/cart-lines";
import { holdGiftCard, GiftCardError } from "@/server/gift-cards";
import { quote } from "@/server/orders";
import { placeOrder, cancelOrder, confirmOrder, releaseExpired, refundOrder, advanceOrder, CheckoutError } from "@/server/orders";
import { reserve, OutOfStockError } from "@/server/inventory";

const addr = { fullName: "Test Buyer", phone: "+919999999999", line1: "1 MG Road", city: "Bengaluru", state: "KA", postalCode: "560001", country: "IN" };
const include = cartInclude;
const variant = (sku: string) => db.productVariant.findUniqueOrThrow({ where: { sku } });
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) process.exitCode = 1; };

async function cartWith(items: { variantId: string; quantity: number }[], couponCode?: string) {
  const coupon = couponCode ? await db.coupon.findUnique({ where: { code: couponCode } }) : null;
  const c = await db.cart.create({ data: { couponId: coupon?.id, items: { create: items } } });
  return db.cart.findUniqueOrThrow({ where: { id: c.id }, include });
}

async function main() {
  const user = await db.user.upsert({ where: { email: "e2e@test.local" }, update: { loyaltyPoints: 0 }, create: { email: "e2e@test.local", name: "E2E" } });
  const v = await variant("NAG-CHAMPA-NOIR-20-STICKS");
  const before = v.stock;

  // 1. COD order commits stock immediately, applies coupon, awards points.
  let cart = await cartWith([{ variantId: v.id, quantity: 2 }], "WELCOME10");
  let { order } = await placeOrder({ cart, lines: await cartLines(cart), userId: user.id, email: user.email, address: addr, shippingRateId: "ship-in", provider: "COD", pointsRequested: 0, giftWrap: false });
  let after = await variant(v.sku);
  ok(after.stock === before - 2 && after.reserved === v.reserved, `COD commits stock (${before} → ${after.stock}, reserved ${after.reserved})`);
  ok(order.discount === 9000 && order.shipping === 9900 && order.total === 90000 - 9000 + 9900, `pricing: discount ${order.discount}, shipping ${order.shipping}, total ${order.total}`);
  const u1 = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  ok(u1.loyaltyPoints === 45, `points earned on ₹${order.total / 100}: ${u1.loyaltyPoints}`);
  ok((await db.cartItem.count({ where: { cartId: cart.id } })) === 0, "cart cleared after confirm");
  ok(!(await confirmOrder(order.id, { captured: false })), "confirm is idempotent");

  // 2. Cancelling a confirmed COD order returns stock and reverses points.
  await cancelOrder(order.id, "test cancel");
  after = await variant(v.sku);
  const u2 = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  ok(after.stock === before, `cancel restocks (${after.stock})`);
  ok(u2.loyaltyPoints === 0, `cancel reverses points (${u2.loyaltyPoints})`);

  // 3. Online payment that can't start (no Stripe keys) releases the hold.
  cart = await cartWith([{ variantId: v.id, quantity: 1 }]);
  try {
    await placeOrder({ cart, lines: await cartLines(cart), userId: null, email: "guest@test.local", address: addr, shippingRateId: "ship-in", provider: "STRIPE", pointsRequested: 0, giftWrap: false });
    ok(false, "stripe without keys should throw");
  } catch {
    after = await variant(v.sku);
    ok(after.reserved === v.reserved && after.stock === before, `failed payment start releases hold (reserved ${after.reserved})`);
  }

  // 4. Race: two holds on the last unit — exactly one wins.
  const last = await variant("JASMINE-MAJLIS-CANDLE-CLASSIC-220-G");
  await db.productVariant.update({ where: { id: last.id }, data: { stock: 1, reserved: 0 } });
  const results = await Promise.allSettled([1, 2].map(() => db.$transaction((tx) => reserve(tx, last.id, 1, "race"))));
  ok(results.filter((r) => r.status === "fulfilled").length === 1 && results.some((r) => r.status === "rejected" && r.reason instanceof OutOfStockError), "only one of two concurrent holds succeeds");
  await db.productVariant.update({ where: { id: last.id }, data: { stock: 0, reserved: 0 } });

  // 5. Expired hold: simulate a pending online order whose window lapsed.
  cart = await cartWith([{ variantId: v.id, quantity: 3 }]);
  const pending = await db.$transaction(async (tx) => {
    const o = await tx.order.create({ data: { number: `MO-T${Date.now() % 1e6}`, email: "x@test.local", currency: "INR", subtotal: 1, shipping: 0, tax: 0, total: 1, shippingAddress: addr, reservedUntil: new Date(Date.now() - 1000), items: { create: [{ variantId: v.id, name: "t", label: "t", sku: v.sku, unitPrice: 1, quantity: 3 }] }, payments: { create: { provider: "RAZORPAY", amount: 1, currency: "INR" } } } });
    await reserve(tx, v.id, 3, o.id);
    return o;
  });
  ok((await variant(v.sku)).reserved === v.reserved + 3, "hold taken");
  const released = await releaseExpired();
  const p2 = await db.order.findUniqueOrThrow({ where: { id: pending.id } });
  ok(released >= 1 && p2.status === "CANCELLED" && (await variant(v.sku)).reserved === v.reserved, `expired hold released (status ${p2.status})`);

  // 6. Payment arriving after expiry re-takes stock if available.
  await confirmOrder(pending.id, { captured: true, raw: { paymentId: "pay_late" } });
  const p3 = await db.order.findUniqueOrThrow({ where: { id: pending.id } });
  ok(p3.status === "PAID" && (await variant(v.sku)).stock === before - 3, `late payment honoured (status ${p3.status})`);

  // 7. Fulfilment transitions and invalid jumps.
  await advanceOrder(pending.id, "PACKED");
  await advanceOrder(pending.id, "SHIPPED", { trackingNumber: "TRK123" });
  let threw = false;
  try { await advanceOrder(pending.id, "PACKED"); } catch { threw = true; }
  ok(threw, "cannot move SHIPPED back to PACKED");

  // 8. Out-of-stock in bag is rejected at checkout.
  const sold = await variant("JASMINE-MAJLIS-CANDLE-CLASSIC-220-G");
  cart = await cartWith([{ variantId: sold.id, quantity: 1 }]);
  try {
    await placeOrder({ cart, lines: await cartLines(cart), userId: null, email: "g@test.local", address: addr, shippingRateId: "ship-in", provider: "COD", pointsRequested: 0, giftWrap: false });
    ok(false, "sold-out checkout should fail");
  } catch (e) { ok(e instanceof CheckoutError, `sold-out rejected: ${(e as Error).message}`); }

  // 9. Buying a gift card issues it only once payment is captured.
  const gcVariant = await variant("GIFT-CARD-2-500");
  const gcMeta = { giftCard: { recipientName: "Aisha", recipientEmail: "aisha@test.local", message: "Happy birthday", senderName: "E2E" } };
  const purchase = await db.$transaction(async (tx) => {
    const o = await tx.order.create({ data: { number: `MO-G${Date.now() % 1e6}`, email: "buyer@test.local", currency: "INR", subtotal: 250000, shipping: 0, tax: 0, total: 250000, shippingAddress: addr, reservedUntil: new Date(Date.now() + 60_000), items: { create: [{ variantId: gcVariant.id, name: "Gift Card", label: "₹2,500", sku: gcVariant.sku, unitPrice: 250000, quantity: 1, meta: gcMeta }] }, payments: { create: { provider: "RAZORPAY", amount: 250000, currency: "INR" } } } });
    await reserve(tx, gcVariant.id, 1, o.id);
    return o;
  });
  ok((await db.giftCard.count({ where: { sourceOrderId: purchase.id } })) === 0, "no gift card before payment");
  await confirmOrder(purchase.id, { captured: true, raw: { paymentId: "pay_gc" } });
  const card = await db.giftCard.findFirstOrThrow({ where: { sourceOrderId: purchase.id } });
  ok(card.balance === 250000 && card.recipientEmail === "aisha@test.local" && /^MO-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(card.code), `gift card issued on capture (${card.code})`);

  // 10. Gift cards can't buy gift cards.
  cart = await cartWith([{ variantId: gcVariant.id, quantity: 1 }]);
  await db.cartItem.updateMany({ where: { cartId: cart.id }, data: { bundle: gcMeta } });
  await db.cart.update({ where: { id: cart.id }, data: { giftCardCode: card.code } });
  cart = await db.cart.findUniqueOrThrow({ where: { id: cart.id }, include });
  const gq = await quote({ lines: await cartLines(cart), cart });
  ok(gq.giftCard?.error === "Gift cards can’t be used to buy other gift cards." && gq.pricing.giftCardApplied === 0, "gift card can't pay for gift cards");

  // 11. Redeeming a card that covers the whole order: no payment needed, balance drawn down.
  cart = await cartWith([{ variantId: v.id, quantity: 2 }]);
  await db.cart.update({ where: { id: cart.id }, data: { giftCardCode: card.code } });
  cart = await db.cart.findUniqueOrThrow({ where: { id: cart.id }, include });
  ({ order } = await placeOrder({ cart, lines: await cartLines(cart), userId: null, email: "redeem@test.local", address: addr, shippingRateId: "ship-in", provider: "STRIPE", pointsRequested: 0, giftWrap: false }));
  const redeemed = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { payments: true } });
  const afterSpend = await db.giftCard.findUniqueOrThrow({ where: { id: card.id } });
  ok(redeemed.status === "PAID" && redeemed.giftCardAmount === 99900 && redeemed.payments[0].amount === 0, `fully covered order confirmed without payment (gift card ${redeemed.giftCardAmount})`);
  ok(afterSpend.balance === 250000 - 99900, `card balance drawn down (${afterSpend.balance})`);

  // 12. Cancelling it puts the balance back.
  await cancelOrder(order.id, "test cancel");
  ok((await db.giftCard.findUniqueOrThrow({ where: { id: card.id } })).balance === 250000, "cancel restores gift card balance");

  // 13. Two simultaneous spends can't overdraw a card.
  const spends = await Promise.allSettled([1, 2].map(() => db.$transaction((tx) => holdGiftCard(tx, card.code, 200000))));
  ok(spends.filter((r) => r.status === "fulfilled").length === 1 && spends.some((r) => r.status === "rejected" && r.reason instanceof GiftCardError), "only one of two concurrent spends succeeds");
  await db.giftCard.update({ where: { id: card.id }, data: { balance: 250000 } });

  // 14. Refunding the purchase voids the card it issued.
  await db.payment.updateMany({ where: { orderId: purchase.id }, data: { provider: "COD" } }); // no provider call in tests
  await refundOrder(purchase.id, "test refund");
  const voided = await db.giftCard.findUniqueOrThrow({ where: { id: card.id } });
  ok(!voided.isActive && voided.balance === 0, "refunding the purchase voids its gift card");
  await db.giftCard.deleteMany({ where: { sourceOrderId: purchase.id } });
  await db.productVariant.update({ where: { id: gcVariant.id }, data: { stock: gcVariant.stock, reserved: gcVariant.reserved } });

  // Clean up test data and restore stock.
  const testOrders = await db.order.findMany({ where: { email: { endsWith: "@test.local" } }, select: { id: true } });
  await db.inventoryLog.deleteMany({ where: { orderId: { in: [...testOrders.map((o) => o.id), "race"] } } });
  await db.order.deleteMany({ where: { id: { in: testOrders.map((o) => o.id) } } });
  await db.cart.deleteMany({ where: { userId: null, OR: [{ email: null }, { email: { endsWith: "@test.local" } }] } });
  await db.loyaltyEntry.deleteMany({ where: { userId: user.id } });
  await db.user.delete({ where: { id: user.id } });
  await db.productVariant.update({ where: { id: v.id }, data: { stock: before, reserved: v.reserved } });
  await db.coupon.update({ where: { code: "WELCOME10" }, data: { usedCount: 0 } });
  await db.productVariant.update({ where: { id: last.id }, data: { stock: last.stock, reserved: last.reserved } });
  console.log("cleaned up");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
