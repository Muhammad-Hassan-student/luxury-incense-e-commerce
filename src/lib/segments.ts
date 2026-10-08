// RFM-style customer segments — client-safe, shared by the sales reports (src/server/analytics.ts)
// and the customer journeys engine (src/server/automations.ts).

export const SEGMENTS = ["Champions", "Loyal", "New", "At risk", "Lost"] as const;
export type Segment = (typeof SEGMENTS)[number];
export const SEGMENT_HINT: Record<Segment, string> = {
  Champions: "3+ orders, last within 30 days",
  Loyal: "2+ orders, last within 90 days",
  New: "First order within 60 days",
  "At risk": "No order for 2–6 months",
  Lost: "No order for over 6 months",
};

export const isSegment = (v: unknown): v is Segment => typeof v === "string" && (SEGMENTS as readonly string[]).includes(v);

/** RFM-style segment from days since the last order and lifetime order count. */
export function segmentOf(recencyDays: number, frequency: number): Segment {
  if (recencyDays <= 30 && frequency >= 3) return "Champions";
  if (recencyDays <= 90 && frequency >= 2) return "Loyal";
  if (recencyDays <= 60 && frequency === 1) return "New";
  if (recencyDays <= 180) return "At risk";
  return "Lost";
}

const DAY = 86_400_000;

/**
 * Best estimate of when a customer entered the segment they are in now, from their order history alone
 * (recency is whole days since the last order, as in `segmentOf`).
 */
export function segmentEnteredAt(segment: Segment, o: { firstOrderAt: Date; lastOrderAt: Date; frequency: number }): Date {
  const after = (days: number) => new Date(o.lastOrderAt.getTime() + days * DAY);
  switch (segment) {
    case "New":
      return o.firstOrderAt;
    case "Champions":
      return o.lastOrderAt;
    case "Loyal":
      return o.frequency >= 3 ? after(31) : o.lastOrderAt;
    case "At risk":
      return after(o.frequency === 1 ? 61 : 91);
    case "Lost":
      return after(181);
  }
}
