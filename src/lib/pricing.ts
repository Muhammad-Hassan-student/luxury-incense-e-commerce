// Pure pricing maths shared by cart, checkout and tests. All amounts are integer minor units.

/** `digital` lines (gift cards) are excluded from discounts, points, tax and shipping. */
export type PricingLine = { unitPrice: number; quantity: number; digital?: boolean };

export type PricingCoupon = {
  code: string;
  type: "PERCENT" | "FIXED" | "FREE_SHIPPING";
  value: number;
  minSubtotal: number;
  maxUses: number | null;
  usedCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
};

export type PricingShipping = { price: number; freeOver: number | null } | null;

export type PricingInput = {
  lines: PricingLine[];
  coupon?: PricingCoupon | null;
  shipping?: PricingShipping;
  /** Points the customer asked to redeem; capped by balance and by `maxPointsShare`. */
  pointsRequested?: number;
  pointsBalance?: number;
  pointValue: number;
  /** Max share of the discounted subtotal payable with points (0–1). */
  maxPointsShare?: number;
  giftWrap?: boolean;
  giftWrapFee?: number;
  taxRatePercent: number;
  taxInclusive: boolean;
  /** Balance of a gift card applied as tender, after everything else. */
  giftCardBalance?: number;
  now?: Date;
};

export type Pricing = {
  subtotal: number;
  discount: number;
  couponError: string | null;
  pointsRedeemed: number;
  pointsValue: number;
  shipping: number;
  giftWrap: number;
  tax: number;
  total: number;
  giftCardApplied: number;
  /** What the customer actually pays with card/UPI/COD. */
  payable: number;
};

export function couponProblem(c: PricingCoupon, subtotal: number, now = new Date()): string | null {
  if (!c.isActive) return "This code is no longer active.";
  if (c.startsAt && now < c.startsAt) return "This code isn't active yet.";
  if (c.endsAt && now > c.endsAt) return "This code has expired.";
  if (c.maxUses != null && c.usedCount >= c.maxUses) return "This code has been fully redeemed.";
  if (subtotal < c.minSubtotal) return "Your bag doesn't meet this code's minimum yet.";
  return null;
}

export function price(input: PricingInput): Pricing {
  const now = input.now ?? new Date();
  const sum = (ls: PricingLine[]) => ls.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const goodsSubtotal = sum(input.lines.filter((l) => !l.digital));
  const digitalSubtotal = sum(input.lines.filter((l) => l.digital));
  const subtotal = goodsSubtotal + digitalSubtotal;

  let discount = 0;
  let freeShipping = false;
  let couponError: string | null = null;
  if (input.coupon) {
    couponError = couponProblem(input.coupon, goodsSubtotal, now);
    if (!couponError) {
      if (input.coupon.type === "PERCENT") discount = Math.round((goodsSubtotal * input.coupon.value) / 100);
      else if (input.coupon.type === "FIXED") discount = Math.min(input.coupon.value, goodsSubtotal);
      else freeShipping = true;
    }
  }
  const afterDiscount = goodsSubtotal - discount;

  const share = input.maxPointsShare ?? 0.2;
  const maxByShare = Math.floor((afterDiscount * share) / input.pointValue);
  const pointsRedeemed = Math.max(
    0,
    Math.min(input.pointsRequested ?? 0, input.pointsBalance ?? 0, maxByShare),
  );
  const pointsValue = pointsRedeemed * input.pointValue;

  let shipping = 0;
  if (input.shipping && !freeShipping && goodsSubtotal > 0) {
    const free = input.shipping.freeOver != null && afterDiscount >= input.shipping.freeOver;
    shipping = free ? 0 : input.shipping.price;
  }

  const giftWrap = input.giftWrap && goodsSubtotal > 0 ? (input.giftWrapFee ?? 0) : 0;
  const goods = afterDiscount - pointsValue;
  const rate = input.taxRatePercent / 100;
  const tax = input.taxInclusive ? Math.round(goods - goods / (1 + rate)) : Math.round(goods * rate);
  const total = goods + shipping + giftWrap + (input.taxInclusive ? 0 : tax) + digitalSubtotal;
  const giftCardApplied = Math.max(0, Math.min(input.giftCardBalance ?? 0, total));

  return { subtotal, discount, couponError, pointsRedeemed, pointsValue, shipping, giftWrap, tax, total, giftCardApplied, payable: total - giftCardApplied };
}

/** Loyalty points earned for an order total (minor units). */
export function pointsEarned(totalMinor: number, earnPer100: number) {
  return Math.floor(totalMinor / 100 / 100) * earnPer100;
}

/** Coffret: sum of the chosen pieces less 10%. */
export function coffretPrice(componentPrices: number[]) {
  return Math.round(componentPrices.reduce((a, b) => a + b, 0) * 0.9);
}
