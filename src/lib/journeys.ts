// Customer journeys — client-safe definitions shared by the engine (src/server/automations.ts) and the admin UI.
// Each built-in journey has a fixed shape (trigger → steps) with editable timing and offers (`config`, zod-validated).
import { z } from "zod";
import type { Segment } from "./segments";

export const JOURNEY_KEYS = ["welcome", "winback", "vip", "lapsed", "review"] as const;
export type JourneyKey = (typeof JOURNEY_KEYS)[number];
export const isJourneyKey = (v: unknown): v is JourneyKey => typeof v === "string" && (JOURNEY_KEYS as readonly string[]).includes(v);

const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const JOURNEY_CONFIG = {
  welcome: z
    .object({
      reviewDay: int(1, 60).default(7),
      ritualDay: int(2, 120).default(21),
    })
    .refine((c) => c.ritualDay > c.reviewDay, { message: "The ritual email must come after the review request", path: ["ritualDay"] }),
  winback: z
    .object({
      couponAfterDays: int(1, 60).default(7),
      percentOff: int(5, 50).default(15),
      couponValidDays: int(3, 60).default(14),
      reminderDaysBefore: int(1, 10).default(3),
      /** Minimum bag in minor units. */
      minSubtotal: int(0, 10_000_000).default(0),
    })
    .refine((c) => c.reminderDaysBefore < c.couponValidDays, { message: "The reminder must fall before the code expires", path: ["reminderDaysBefore"] }),
  vip: z.object({ bonusPoints: int(10, 5000).default(250) }),
  lapsed: z.object({
    percentOff: int(5, 50).default(20),
    couponValidDays: int(3, 60).default(21),
    minSubtotal: int(0, 10_000_000).default(0),
  }),
  review: z.object({ afterDays: int(1, 60).default(5) }),
} as const;

export type JourneyConfig<K extends JourneyKey = JourneyKey> = z.output<(typeof JOURNEY_CONFIG)[K]>;
export type AnyJourneyConfig = { [K in JourneyKey]: JourneyConfig<K> }[JourneyKey];

/** Stored config → valid config (falls back to defaults for anything missing or invalid). */
export function parseJourneyConfig<K extends JourneyKey>(key: K, raw: unknown): JourneyConfig<K> {
  const schema = JOURNEY_CONFIG[key];
  const parsed = schema.safeParse(raw ?? {});
  return (parsed.success ? parsed.data : schema.parse({})) as JourneyConfig<K>;
}

/** Store-wide guardrails (Setting "journeys"). */
export const journeySettingsSchema = z.object({
  /** Kill switch: nothing enrolls or sends while paused. */
  paused: z.boolean().default(false),
  /** Evaluate and report what would happen, without enrolling, sending or issuing anything. */
  dryRun: z.boolean().default(false),
  /** At most one journey email per customer within this many hours. */
  frequencyCapHours: int(1, 24 * 30).default(72),
  /** Journey emails across all customers per rolling 24 hours. */
  dailySendCap: int(1, 100_000).default(500),
  /** Trade (wholesale) account holders are excluded unless this is on. */
  includeTrade: z.boolean().default(false),
  /** A customer counts as "entering" a segment for this many days after they moved into it. */
  entryWindowDays: int(1, 30).default(7),
  /** Minimum gap before the same customer can enter the same journey again. */
  cooldownDays: int(0, 365).default(90),
  /** An order within this many days of a journey email is attributed to it. */
  attributionDays: int(1, 60).default(14),
});
export type JourneySettings = z.output<typeof journeySettingsSchema>;
export const JOURNEY_SETTINGS_KEY = "journeys";

export type JourneyMeta = {
  key: JourneyKey;
  name: string;
  summary: string;
  /** Stored on the Journey row. */
  trigger: string;
  segment: Segment | null;
  /** Any order after entering ends the run as CONVERTED. */
  exitOnOrder: boolean;
};

export const JOURNEYS: Record<JourneyKey, JourneyMeta> = {
  welcome: {
    key: "welcome",
    name: "Welcome",
    summary: "First order → thank-you and ritual guide, a review request, then pieces that complete the ritual.",
    trigger: "segment:New",
    segment: "New",
    exitOnOrder: true,
  },
  winback: {
    key: "winback",
    name: "Win-back",
    summary: "Drifting customers get a warm note, then a personal single-use code, then a reminder before it expires.",
    trigger: "segment:At risk",
    segment: "At risk",
    exitOnOrder: true,
  },
  vip: {
    key: "vip",
    name: "VIP",
    summary: "New Champions are thanked with bonus loyalty points and a note about early access.",
    trigger: "segment:Champions",
    segment: "Champions",
    exitOnOrder: false,
  },
  lapsed: {
    key: "lapsed",
    name: "Lapsed",
    summary: "One last gentle letter with a personal code when a customer has been away over six months — then we stop.",
    trigger: "segment:Lost",
    segment: "Lost",
    exitOnOrder: true,
  },
  review: {
    key: "review",
    name: "Post-delivery review",
    summary: "A few days after delivery, invite a review of the pieces the customer hasn't reviewed yet.",
    trigger: "event:delivered",
    segment: null,
    exitOnOrder: false,
  },
};

export type TemplateKey =
  | "welcome"
  | "welcome-review"
  | "welcome-ritual"
  | "winback-miss"
  | "winback-coupon"
  | "winback-reminder"
  | "vip-thanks"
  | "lapsed-coupon"
  | "review-request";

/** Checks a step makes before acting. `skip` moves on to the next step; `exit` ends the run. */
export type StepCondition =
  | { kind: "still-in"; segments: Segment[] }
  | { kind: "has-unreviewed"; source: "first-order" | "entry-order"; otherwise: "skip" | "exit" }
  | { kind: "coupon-unused"; fromStep: number };

export type StepAction = { kind: "email"; template: TemplateKey } | { kind: "coupon"; percentOff: number; validDays: number; minSubtotal: number } | { kind: "points"; amount: number };

export type JourneyStep = {
  label: string;
  /** Delay after the previous step ran (step 0: after entering). */
  waitHours: number;
  conditions: StepCondition[];
  actions: StepAction[];
};

const D = 24;

export function journeySteps(key: JourneyKey, raw: unknown): JourneyStep[] {
  switch (key) {
    case "welcome": {
      const c = parseJourneyConfig("welcome", raw);
      return [
        { label: "Thank-you & ritual guide", waitHours: 0, conditions: [], actions: [{ kind: "email", template: "welcome" }] },
        {
          label: "Review request",
          waitHours: c.reviewDay * D,
          conditions: [{ kind: "has-unreviewed", source: "first-order", otherwise: "skip" }],
          actions: [{ kind: "email", template: "welcome-review" }],
        },
        { label: "Complete the ritual", waitHours: (c.ritualDay - c.reviewDay) * D, conditions: [], actions: [{ kind: "email", template: "welcome-ritual" }] },
      ];
    }
    case "winback": {
      const c = parseJourneyConfig("winback", raw);
      return [
        { label: "We miss you", waitHours: 0, conditions: [{ kind: "still-in", segments: ["At risk"] }], actions: [{ kind: "email", template: "winback-miss" }] },
        {
          label: `Personal ${c.percentOff}% code`,
          waitHours: c.couponAfterDays * D,
          conditions: [{ kind: "still-in", segments: ["At risk", "Lost"] }],
          actions: [
            { kind: "coupon", percentOff: c.percentOff, validDays: c.couponValidDays, minSubtotal: c.minSubtotal },
            { kind: "email", template: "winback-coupon" },
          ],
        },
        {
          label: "Code expiry reminder",
          waitHours: (c.couponValidDays - c.reminderDaysBefore) * D,
          conditions: [{ kind: "coupon-unused", fromStep: 1 }],
          actions: [{ kind: "email", template: "winback-reminder" }],
        },
      ];
    }
    case "vip": {
      const c = parseJourneyConfig("vip", raw);
      return [
        {
          label: "Thank-you, bonus & early access",
          waitHours: 0,
          conditions: [{ kind: "still-in", segments: ["Champions"] }],
          actions: [
            { kind: "points", amount: c.bonusPoints },
            { kind: "email", template: "vip-thanks" },
          ],
        },
      ];
    }
    case "lapsed": {
      const c = parseJourneyConfig("lapsed", raw);
      return [
        {
          label: `Last note with ${c.percentOff}% code`,
          waitHours: 0,
          conditions: [{ kind: "still-in", segments: ["Lost"] }],
          actions: [
            { kind: "coupon", percentOff: c.percentOff, validDays: c.couponValidDays, minSubtotal: c.minSubtotal },
            { kind: "email", template: "lapsed-coupon" },
          ],
        },
      ];
    }
    case "review":
      return [
        {
          label: "Review request",
          waitHours: 0,
          conditions: [{ kind: "has-unreviewed", source: "entry-order", otherwise: "exit" }],
          actions: [{ kind: "email", template: "review-request" }],
        },
      ];
  }
}

export const TEMPLATE_LABEL: Record<TemplateKey, string> = {
  welcome: "Welcome · thank-you & ritual guide",
  "welcome-review": "Welcome · review request",
  "welcome-ritual": "Welcome · complete the ritual",
  "winback-miss": "Win-back · we miss you",
  "winback-coupon": "Win-back · personal code",
  "winback-reminder": "Win-back · code expiry reminder",
  "vip-thanks": "VIP · thank-you & bonus",
  "lapsed-coupon": "Lapsed · last note",
  "review-request": "Post-delivery · review request",
};

/** Templates a journey can send, in order. */
export const journeyTemplates = (key: JourneyKey, raw?: unknown): TemplateKey[] =>
  journeySteps(key, raw).flatMap((s) => s.actions.flatMap((a) => (a.kind === "email" ? [a.template] : [])));

export const fmtWait = (hours: number) => {
  if (hours === 0) return "Immediately";
  if (hours % 24 === 0) return `Wait ${hours / 24} day${hours === 24 ? "" : "s"}`;
  return `Wait ${hours} hour${hours === 1 ? "" : "s"}`;
};

export const ENROLLMENT_STATUS_LABEL = { ACTIVE: "Active", COMPLETED: "Completed", EXITED: "Exited", CONVERTED: "Converted" } as const;
