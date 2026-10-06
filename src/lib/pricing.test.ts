import { describe, expect, it } from "vitest";
import { coffretPrice, couponProblem, pointsEarned, price, type PricingCoupon } from "./pricing";

const base = { pointValue: 100, taxRatePercent: 18, taxInclusive: true };
const coupon = (over: Partial<PricingCoupon>): PricingCoupon => ({
  code: "X",
  type: "PERCENT",
  value: 10,
  minSubtotal: 0,
  maxUses: null,
  usedCount: 0,
  startsAt: null,
  endsAt: null,
  isActive: true,
  ...over,
});

describe("price", () => {
  it("sums lines and backs out inclusive tax", () => {
    const p = price({ ...base, lines: [{ unitPrice: 11800, quantity: 2 }] });
    expect(p.subtotal).toBe(23600);
    expect(p.tax).toBe(3600);
    expect(p.total).toBe(23600);
  });

  it("adds tax on top when exclusive", () => {
    const p = price({ ...base, taxInclusive: false, lines: [{ unitPrice: 10000, quantity: 1 }] });
    expect(p.tax).toBe(1800);
    expect(p.total).toBe(11800);
  });

  it("applies percent and fixed coupons, never below zero", () => {
    expect(price({ ...base, lines: [{ unitPrice: 10000, quantity: 1 }], coupon: coupon({}) }).discount).toBe(1000);
    const fixed = price({
      ...base,
      lines: [{ unitPrice: 10000, quantity: 1 }],
      coupon: coupon({ type: "FIXED", value: 50000 }),
    });
    expect(fixed.discount).toBe(10000);
    expect(fixed.total).toBe(0);
  });

  it("rejects coupons below minimum, expired or used up", () => {
    const lines = [{ unitPrice: 10000, quantity: 1 }];
    expect(price({ ...base, lines, coupon: coupon({ minSubtotal: 20000 }) }).couponError).toMatch(/minimum/);
    expect(price({ ...base, lines, coupon: coupon({ endsAt: new Date(0) }) }).couponError).toMatch(/expired/);
    expect(price({ ...base, lines, coupon: coupon({ maxUses: 1, usedCount: 1 }) }).discount).toBe(0);
  });

  it("charges shipping unless over threshold or free-shipping coupon", () => {
    const lines = [{ unitPrice: 10000, quantity: 1 }];
    const shipping = { price: 9900, freeOver: 250000 };
    expect(price({ ...base, lines, shipping }).shipping).toBe(9900);
    expect(price({ ...base, lines: [{ unitPrice: 300000, quantity: 1 }], shipping }).shipping).toBe(0);
    expect(price({ ...base, lines, shipping, coupon: coupon({ type: "FREE_SHIPPING" }) }).shipping).toBe(0);
  });

  it("does not charge shipping on an empty bag", () => {
    expect(price({ ...base, lines: [], shipping: { price: 9900, freeOver: null } }).total).toBe(0);
  });

  it("caps points by balance and by 20% of the bag", () => {
    const lines = [{ unitPrice: 100000, quantity: 1 }];
    const capped = price({ ...base, lines, pointsRequested: 9999, pointsBalance: 9999 });
    expect(capped.pointsRedeemed).toBe(200);
    expect(capped.total).toBe(80000);
    expect(price({ ...base, lines, pointsRequested: 50, pointsBalance: 30 }).pointsRedeemed).toBe(30);
  });

  it("adds gift wrap fee", () => {
    const p = price({ ...base, lines: [{ unitPrice: 10000, quantity: 1 }], giftWrap: true, giftWrapFee: 9900 });
    expect(p.total).toBe(19900);
  });
});

describe("gift cards", () => {
  it("keeps gift card purchases out of discounts, tax and shipping", () => {
    const p = price({
      ...base,
      lines: [{ unitPrice: 10000, quantity: 1 }, { unitPrice: 250000, quantity: 1, digital: true }],
      coupon: coupon({}),
      shipping: { price: 9900, freeOver: 250000 },
    });
    expect(p.discount).toBe(1000);
    expect(p.shipping).toBe(9900);
    expect(p.total).toBe(9000 + 9900 + 250000);
  });

  it("charges no shipping for a gift-card-only bag", () => {
    const p = price({ ...base, lines: [{ unitPrice: 500000, quantity: 1, digital: true }], shipping: { price: 9900, freeOver: null } });
    expect(p.shipping).toBe(0);
    expect(p.tax).toBe(0);
    expect(p.total).toBe(500000);
  });

  it("applies a gift card balance as tender, never beyond the total", () => {
    const lines = [{ unitPrice: 100000, quantity: 1 }];
    expect(price({ ...base, lines, giftCardBalance: 30000 })).toMatchObject({ giftCardApplied: 30000, payable: 70000 });
    expect(price({ ...base, lines, giftCardBalance: 500000 })).toMatchObject({ giftCardApplied: 100000, payable: 0 });
  });

  it("checks coupon minimums against physical goods only", () => {
    const p = price({ ...base, lines: [{ unitPrice: 500000, quantity: 1, digital: true }], coupon: coupon({ minSubtotal: 100000 }) });
    expect(p.couponError).toMatch(/minimum/);
  });
});

describe("helpers", () => {
  it("earns points per ₹100", () => {
    expect(pointsEarned(250000, 5)).toBe(125);
    expect(pointsEarned(9999, 5)).toBe(0);
  });
  it("prices a coffret at 10% off", () => {
    expect(coffretPrice([10000, 20000])).toBe(27000);
  });
  it("accepts a valid coupon", () => {
    expect(couponProblem(coupon({}), 100)).toBeNull();
  });
});
