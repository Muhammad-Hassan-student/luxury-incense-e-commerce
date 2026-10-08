import "server-only";
import type { ReactElement } from "react";
import { Prisma } from "@/generated/prisma/client";
import { brand } from "@/config/brand";
import { JourneyEmail, type JourneyEmailProps } from "@/emails/journey";
import {
  JOURNEY_CONFIG,
  JOURNEY_KEYS,
  JOURNEY_SETTINGS_KEY,
  JOURNEYS,
  journeySettingsSchema,
  journeySteps,
  parseJourneyConfig,
  type JourneyKey,
  type JourneySettings,
  type JourneyStep,
  type StepCondition,
  type TemplateKey,
} from "@/lib/journeys";
import { canDo } from "@/lib/permissions";
import { productHref } from "@/lib/product-href";
import { segmentEnteredAt, segmentOf, type Segment } from "@/lib/segments";
import { KEPT_ORDER_SQL } from "./analytics";
import { audit } from "./audit";
import { db } from "./db";
import { sendEmail } from "./email";
import { isMailableEmail, listUnsubscribeHeaders, normEmail, personalCouponCode, unsubscribePageUrl } from "./marketing";
import { pickAvailable, rankRecommendations } from "./recommendations";

/*
 * Customer journeys engine (cron job "journeys", hourly).
 *
 *   1. Evaluate  — recompute every customer's RFM segment (same rules and "kept order" definition as the sales reports),
 *                  diff against the last evaluation (CustomerSegment) and enroll customers who entered a journey's segment
 *                  within the entry window; delivered orders awaiting a review enroll the post-delivery journey.
 *   2. Convert   — attribute orders to the last journey email within the attribution window; any order ends
 *                  "exit on order" runs as CONVERTED.
 *   3. Advance   — run due steps in small batches: wait → conditions → actions (email / personal coupon / bonus points).
 *
 * Idempotency and concurrency: one entry event can enroll once (unique journey+user+entryKey); evaluation runs under a
 * transaction-level advisory lock (a concurrent run skips it); each step claims its enrollment row with
 * FOR UPDATE SKIP LOCKED and re-checks it is still due, then serialises on a second advisory lock so the frequency and
 * daily caps are exact; at most one message per enrollment step (unique). The message row is committed before the email
 * goes out, so a crash can lose an email but never send one twice.
 */

export class JourneyError extends Error {}
export type JourneyActor = { id: string; permissions: readonly string[] };

type Tx = Prisma.TransactionClient;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const EVAL_LOCK = 74_010_001;
const SEND_LOCK = 74_010_002;
const BATCH = 25;
const MAX_STEPS_PER_RUN = 200;

/** UTC instant → the timestamp-without-zone value Prisma stores. */
const ts = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
const KEPT = KEPT_ORDER_SQL;
const inScope = (scope: string[] | undefined, col = Prisma.sql`o."userId"`) => (scope ? Prisma.sql`AND ${col} IN (${Prisma.join(scope.length ? scope : ["-"])})` : Prisma.empty);

export function assertCanManageJourneys(actor: JourneyActor | null | undefined): asserts actor is JourneyActor {
  if (!actor || !canDo(actor.permissions, "automations.manage")) throw new JourneyError("You don’t have permission to manage customer journeys.");
}

// ─────────────────────────────── Settings & journeys ───────────────────────────────

export async function getJourneySettings(q: Tx | typeof db = db): Promise<JourneySettings> {
  const row = await q.setting.findUnique({ where: { key: JOURNEY_SETTINGS_KEY } });
  const parsed = journeySettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : journeySettingsSchema.parse({});
}

/** Built-in journeys exist from the first load, all switched off. Never overwrites edits. */
export async function ensureJourneys() {
  await db.journey.createMany({
    data: JOURNEY_KEYS.map((key) => ({
      key,
      name: JOURNEYS[key].name,
      trigger: JOURNEYS[key].trigger,
      enabled: false,
      config: JOURNEY_CONFIG[key].parse({}) as Prisma.InputJsonObject,
    })),
    skipDuplicates: true,
  });
  return db.journey.findMany({ where: { key: { in: [...JOURNEY_KEYS] } } });
}

export async function saveJourneySettings(actor: JourneyActor, input: unknown) {
  assertCanManageJourneys(actor);
  const parsed = journeySettingsSchema.safeParse(input);
  if (!parsed.success) throw new JourneyError(parsed.error.issues[0]?.message ?? "Invalid settings.");
  const value = parsed.data as Prisma.InputJsonObject;
  await db.setting.upsert({ where: { key: JOURNEY_SETTINGS_KEY }, update: { value }, create: { key: JOURNEY_SETTINGS_KEY, value } });
  await audit(actor.id, "journeys.settings", "Setting", JOURNEY_SETTINGS_KEY, value);
  return parsed.data;
}

export async function setJourneysPaused(actor: JourneyActor, paused: boolean) {
  assertCanManageJourneys(actor);
  const current = await getJourneySettings();
  return saveJourneySettings(actor, { ...current, paused });
}

export async function setJourneyEnabled(actor: JourneyActor, key: JourneyKey, enabled: boolean) {
  assertCanManageJourneys(actor);
  await ensureJourneys();
  const j = await db.journey.update({ where: { key }, data: { enabled } });
  await audit(actor.id, enabled ? "journey.enable" : "journey.disable", "Journey", j.id, { key });
  return j;
}

export async function saveJourneyConfig(actor: JourneyActor, key: JourneyKey, input: unknown) {
  assertCanManageJourneys(actor);
  const parsed = JOURNEY_CONFIG[key].safeParse(input);
  if (!parsed.success) throw new JourneyError(parsed.error.issues[0]?.message ?? "Invalid settings.");
  await ensureJourneys();
  const config = parsed.data as Prisma.InputJsonObject;
  const j = await db.journey.update({ where: { key }, data: { config } });
  await audit(actor.id, "journey.config", "Journey", j.id, { key, config });
  return j;
}

// ─────────────────────────────── Segments ───────────────────────────────

type CustomerStats = { userId: string; frequency: number; firstOrderAt: Date; lastOrderAt: Date; recency: number; firstOrderId: string };
export type LiveSegment = { segment: Segment; since: Date; firstOrderId: string };

/** Per signed-in customer: kept orders, first/last order, recency in whole days as of `now` (as in the reports). */
async function customerStats(q: Tx | typeof db, now: Date, userIds?: string[]): Promise<CustomerStats[]> {
  const only = userIds ? Prisma.sql`AND o."userId" IN (${Prisma.join(userIds.length ? userIds : ["-"])})` : Prisma.empty;
  const rows = await q.$queryRaw<{ user_id: string; freq: number; first_at: Date; last_at: Date; recency: number; first_id: string }[]>`
    SELECT o."userId" AS user_id, COUNT(*)::int AS freq, MIN(o."placedAt") AS first_at, MAX(o."placedAt") AS last_at,
           FLOOR(EXTRACT(EPOCH FROM (${ts(now)} - MAX(o."placedAt"))) / 86400)::int AS recency,
           (ARRAY_AGG(o.id ORDER BY o."placedAt" ASC))[1] AS first_id
    FROM "Order" o
    WHERE ${KEPT} AND o."userId" IS NOT NULL AND o."placedAt" <= ${ts(now)} ${only}
    GROUP BY o."userId"`;
  return rows.map((r) => ({ userId: r.user_id, frequency: r.freq, firstOrderAt: r.first_at, lastOrderAt: r.last_at, recency: r.recency, firstOrderId: r.first_id }));
}

const live = (s: CustomerStats, now: Date): LiveSegment => {
  const segment = segmentOf(s.recency, s.frequency);
  const est = segmentEnteredAt(segment, s);
  return { segment, since: est > now ? now : est, firstOrderId: s.firstOrderId };
};

/**
 * Current segment of every customer, diffed against the last evaluation: unchanged customers keep the moment they
 * entered; changed or new ones get the estimated entry time. With `write`, the snapshot is updated.
 */
async function evaluateSegments(q: Tx | typeof db, now: Date, write: boolean, scope?: string[]) {
  const [stats, snapshot] = await Promise.all([customerStats(q, now, scope), q.customerSegment.findMany(scope ? { where: { userId: { in: scope } } } : undefined)]);
  const prev = new Map(snapshot.map((s) => [s.userId, s]));
  const current = new Map<string, LiveSegment>();
  const created: { userId: string; segment: string; since: Date }[] = [];
  const changed: { userId: string; segment: string; since: Date }[] = [];
  for (const s of stats) {
    const l = live(s, now);
    const before = prev.get(s.userId);
    if (before && before.segment === l.segment) current.set(s.userId, { ...l, since: before.since });
    else {
      current.set(s.userId, l);
      (before ? changed : created).push({ userId: s.userId, segment: l.segment, since: l.since });
    }
  }
  const gone = snapshot.filter((s) => !current.has(s.userId)).map((s) => s.userId);
  if (write) {
    if (created.length) await q.customerSegment.createMany({ data: created, skipDuplicates: true });
    for (const c of changed) await q.customerSegment.update({ where: { userId: c.userId }, data: { segment: c.segment, since: c.since } });
    if (gone.length) await q.customerSegment.deleteMany({ where: { userId: { in: gone } } });
  }
  return { current, created: created.length, changed: changed.length, removed: gone.length };
}

/** Live segment of one customer (step conditions). */
async function segmentNow(q: Tx | typeof db, userId: string, now: Date): Promise<Segment | null> {
  const [s] = await customerStats(q, now, [userId]);
  return s ? segmentOf(s.recency, s.frequency) : null;
}

/** Customer counts per segment right now (admin cards). */
export async function segmentSizes(now = new Date()): Promise<Record<Segment, number>> {
  const out: Record<Segment, number> = { Champions: 0, Loyal: 0, New: 0, "At risk": 0, Lost: 0 };
  for (const s of await customerStats(db, now)) out[segmentOf(s.recency, s.frequency)]++;
  return out;
}

// ─────────────────────────────── Guardrails ───────────────────────────────

type Recipient = { id: string; email: string; role: string; deletionRequestedAt: Date | null; tradeAccount: { id: string } | null };
const recipientSelect = { id: true, email: true, role: true, deletionRequestedAt: true, tradeAccount: { select: { id: true } } } as const;

/** Why this person must not get journey email, or null. Staff, deleted, scrubbed/invalid, opted out, trade (unless allowed). */
async function blockReason(q: Tx | typeof db, u: Recipient, settings: JourneySettings): Promise<string | null> {
  if (u.role !== "CUSTOMER") return "staff account";
  if (u.deletionRequestedAt) return "account deleted";
  if (!isMailableEmail(u.email)) return "no valid email";
  if (u.tradeAccount && !settings.includeTrade) return "trade account";
  const pref = await q.marketingPreference.findUnique({ where: { email: normEmail(u.email) }, select: { journeys: true } });
  if (pref && !pref.journeys) return "opted out";
  return null;
}

async function eligibleUsers(q: Tx | typeof db, ids: string[], settings: JourneySettings) {
  if (!ids.length) return new Map<string, { id: string; email: string; name: string | null }>();
  const users = await q.user.findMany({
    where: { id: { in: ids }, role: "CUSTOMER", deletionRequestedAt: null, ...(settings.includeTrade ? {} : { tradeAccount: null }) },
    select: { id: true, email: true, name: true },
  });
  const mailable = users.filter((u) => isMailableEmail(u.email));
  const optedOut = new Set(
    (await q.marketingPreference.findMany({ where: { email: { in: mailable.map((u) => normEmail(u.email)) }, journeys: false }, select: { email: true } })).map((p) => p.email),
  );
  return new Map(mailable.filter((u) => !optedOut.has(normEmail(u.email))).map((u) => [u.id, u]));
}

// ─────────────────────────────── Entries ───────────────────────────────

export type Entry = { journeyId: string; key: JourneyKey; userId: string; entryKey: string; enteredAt: Date; context: Prisma.InputJsonObject };

async function findEntries(
  q: Tx | typeof db,
  journeys: { id: string; key: string; config: Prisma.JsonValue }[],
  segments: Map<string, LiveSegment>,
  settings: JourneySettings,
  now: Date,
  scope?: string[],
) {
  const windowStart = new Date(now.getTime() - settings.entryWindowDays * DAY);
  const out: Entry[] = [];
  for (const j of journeys) {
    const key = j.key as JourneyKey;
    const meta = JOURNEYS[key];
    let candidates: Entry[] = [];
    if (meta.segment) {
      for (const [userId, s] of segments) {
        if (s.segment !== meta.segment || s.since < windowStart || s.since > now) continue;
        candidates.push({ journeyId: j.id, key, userId, entryKey: `${s.segment}@${s.since.toISOString()}`, enteredAt: s.since, context: { segment: s.segment, orderId: s.firstOrderId } });
      }
    } else if (key === "review") {
      const c = parseJourneyConfig("review", j.config);
      const latest = new Date(now.getTime() - c.afterDays * DAY);
      const earliest = new Date(latest.getTime() - settings.entryWindowDays * DAY);
      const rows = await q.$queryRaw<{ id: string; user_id: string; delivered_at: Date }[]>`
        SELECT o.id, o."userId" AS user_id, MIN(ev."createdAt") AS delivered_at
        FROM "Order" o JOIN "OrderEvent" ev ON ev."orderId" = o.id AND ev.status = 'DELIVERED'
        WHERE o."userId" IS NOT NULL AND o.status = 'DELIVERED' AND o."tradeAccountId" IS NULL ${inScope(scope)}
          AND EXISTS (
            SELECT 1 FROM "OrderItem" oi JOIN "ProductVariant" v ON v.id = oi."variantId" JOIN "Product" p ON p.id = v."productId"
            WHERE oi."orderId" = o.id AND NOT p."isGiftCard"
              AND NOT EXISTS (SELECT 1 FROM "Review" r WHERE r."productId" = p.id AND r."userId" = o."userId"))
        GROUP BY o.id
        HAVING MIN(ev."createdAt") >= ${ts(earliest)} AND MIN(ev."createdAt") <= ${ts(latest)}`;
      candidates = rows.map((r) => ({ journeyId: j.id, key, userId: r.user_id, entryKey: `order:${r.id}`, enteredAt: r.delivered_at, context: { orderId: r.id } }));
    }
    if (!candidates.length) continue;

    // Guardrails, then no second run while one is active, no re-entry within the cooldown, never the same entry twice.
    const ok = await eligibleUsers(q, [...new Set(candidates.map((c) => c.userId))], settings);
    const existing = await q.journeyEnrollment.findMany({
      where: { journeyId: j.id, userId: { in: candidates.map((c) => c.userId) } },
      select: { userId: true, status: true, enteredAt: true, entryKey: true },
    });
    const cooldown = settings.cooldownDays * DAY;
    for (const c of candidates) {
      if (!ok.has(c.userId)) continue;
      const mine = existing.filter((e) => e.userId === c.userId);
      if (mine.some((e) => e.entryKey === c.entryKey || e.status === "ACTIVE")) continue;
      if (meta.segment && mine.some((e) => Math.abs(c.enteredAt.getTime() - e.enteredAt.getTime()) < cooldown)) continue;
      out.push(c);
    }
  }
  return out;
}

/** "Preview who would enter now" — read-only, first `limit` people plus the total. */
export async function previewEntries(key: JourneyKey, opts: { now?: Date; limit?: number } = {}) {
  const now = opts.now ?? new Date();
  const [settings, journeys] = await Promise.all([getJourneySettings(), ensureJourneys()]);
  const j = journeys.find((x) => x.key === key)!;
  const { current } = await evaluateSegments(db, now, false);
  const entries = await findEntries(db, [j], current, settings, now);
  const shown = entries.slice(0, opts.limit ?? 20);
  const users = await db.user.findMany({ where: { id: { in: shown.map((e) => e.userId) } }, select: { id: true, name: true, email: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  return {
    total: entries.length,
    people: shown.map((e) => ({ ...e, name: byId.get(e.userId)?.name ?? null, email: byId.get(e.userId)?.email ?? "" })),
  };
}

// ─────────────────────────────── Conversion & attribution ───────────────────────────────

async function convert(q: Tx, settings: JourneySettings, now: Date, scope?: string[]) {
  const lookback = new Date(now.getTime() - 60 * DAY);
  // Last touch: each new order goes to the latest journey email sent within the window before it.
  const pairs = await q.$queryRaw<{ order_id: string; total: number; placed_at: Date; message_id: string; enrollment_id: string }[]>`
    SELECT DISTINCT ON (o.id) o.id AS order_id, o.total, o."placedAt" AS placed_at, m.id AS message_id, m."enrollmentId" AS enrollment_id
    FROM "Order" o
    JOIN "JourneyMessage" m ON m."userId" = o."userId"
    WHERE ${KEPT} AND o."placedAt" <= ${ts(now)} AND o."placedAt" >= ${ts(lookback)}
      AND m.status = 'SENT' AND m."convertedOrderId" IS NULL
      AND o."placedAt" > m."sentAt" AND o."placedAt" <= m."sentAt" + make_interval(days => ${settings.attributionDays}::int)
      AND NOT EXISTS (SELECT 1 FROM "JourneyMessage" x WHERE x."convertedOrderId" = o.id) ${inScope(scope)}
    ORDER BY o.id, m."sentAt" DESC`;
  pairs.sort((a, b) => a.placed_at.getTime() - b.placed_at.getTime());
  const used = new Set<string>();
  let attributed = 0;
  for (const p of pairs) {
    if (used.has(p.message_id)) continue;
    const r = await q.journeyMessage.updateMany({
      where: { id: p.message_id, convertedOrderId: null },
      data: { convertedOrderId: p.order_id, revenue: p.total, convertedAt: p.placed_at },
    });
    if (!r.count) continue;
    used.add(p.message_id);
    attributed++;
    await q.journeyEnrollment.updateMany({
      where: { id: p.enrollment_id, status: { in: ["ACTIVE", "COMPLETED"] } },
      data: { status: "CONVERTED", convertedOrderId: p.order_id, exitReason: "ordered", exitedAt: now, nextRunAt: null },
    });
  }
  // Any order after entering ends an "exit on order" run, attributed or not.
  const exitKeys = JOURNEY_KEYS.filter((k) => JOURNEYS[k].exitOnOrder);
  const exited = await q.$executeRaw`
    UPDATE "JourneyEnrollment" e
    SET status = 'CONVERTED', "exitReason" = 'ordered', "exitedAt" = ${ts(now)}, "nextRunAt" = NULL, "updatedAt" = ${ts(now)},
        "convertedOrderId" = (SELECT o.id FROM "Order" o WHERE o."userId" = e."userId" AND ${KEPT}
                              AND o."placedAt" > e."enteredAt" AND o."placedAt" <= ${ts(now)} ORDER BY o."placedAt" ASC LIMIT 1)
    FROM "Journey" j
    WHERE j.id = e."journeyId" AND j.key IN (${Prisma.join(exitKeys)}) AND e.status = 'ACTIVE' ${inScope(scope, Prisma.sql`e."userId"`)}
      AND EXISTS (SELECT 1 FROM "Order" o WHERE o."userId" = e."userId" AND ${KEPT} AND o."placedAt" > e."enteredAt" AND o."placedAt" <= ${ts(now)})`;
  return { attributed, converted: exited };
}

async function orderedSince(q: Tx, userId: string, since: Date, now: Date) {
  const [row] = await q.$queryRaw<{ id: string }[]>`
    SELECT o.id FROM "Order" o WHERE o."userId" = ${userId} AND ${KEPT} AND o."placedAt" > ${ts(since)} AND o."placedAt" <= ${ts(now)}
    ORDER BY o."placedAt" ASC LIMIT 1`;
  return row?.id ?? null;
}

// ─────────────────────────────── Step content ───────────────────────────────

type Product = { name: string; path: string; note?: string | null };

async function unreviewedProducts(userId: string, orderId: string | undefined): Promise<Product[]> {
  if (!orderId) return [];
  const items = await db.orderItem.findMany({
    where: { orderId, variant: { product: { isGiftCard: false, isActive: true, reviews: { none: { userId } } } } },
    select: { variant: { select: { product: { select: { id: true, name: true, slug: true } } } } },
  });
  const seen = new Map<string, Product>();
  for (const i of items) {
    const p = i.variant?.product;
    if (p && !seen.has(p.id)) seen.set(p.id, { name: p.name, path: `${productHref(p.slug)}#reviews` });
  }
  return [...seen.values()].slice(0, 4);
}

async function ritualRecommendations(userId: string): Promise<Product[]> {
  const owned = await db.orderItem.findMany({
    where: { order: { userId }, variantId: { not: null } },
    select: { variant: { select: { productId: true } } },
    take: 20,
  });
  const ids = [...new Set(owned.flatMap((o) => (o.variant ? [o.variant.productId] : [])))];
  if (!ids.length) return [];
  const ranked = (await Promise.all(ids.slice(0, 3).map((id) => rankRecommendations(id)))).flat();
  const picks = await pickAvailable(ranked, 3, ids);
  return picks.map((p) => ({ name: p.name, path: productHref(p.slug), note: p.subtitle }));
}

export type EmailData = {
  name?: string | null;
  coupon?: { code: string; percent: number; expiresAt: Date } | null;
  points?: number | null;
  products?: Product[];
};

const fmtDay = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(d);

/** Subject + body for a journey template. Shared by the engine and the admin preview. */
export function journeyEmail(template: TemplateKey, data: EmailData, to: string): { subject: string; react: ReactElement } {
  const hi = data.name?.trim() ? `${data.name.trim().split(/\s+/)[0]}, ` : "";
  const coupon = data.coupon ? { code: data.coupon.code, percent: data.coupon.percent, expires: fmtDay(data.coupon.expiresAt) } : undefined;
  const base = { unsubscribeUrl: unsubscribePageUrl(to), products: data.products };
  const c: Record<TemplateKey, { subject: string } & Omit<JourneyEmailProps, "unsubscribeUrl">> = {
    welcome: {
      subject: `Welcome to ${brand.name}`,
      preview: "Thank you — and how to get the most from your first ritual",
      title: `${hi}thank you`.replace(/^./, (x) => x.toUpperCase()),
      paragraphs: [
        "Your first order means a great deal to a small atelier like ours. Everything you chose was made in a small batch, by hand.",
        "Light slowly, let the first smoke clear, then let the fragrance settle into the room. Our ritual guide walks through each piece.",
      ],
      cta: { label: "Read the ritual guide", path: "/ritual" },
    },
    "welcome-review": {
      subject: "How is your ritual so far?",
      preview: "A few words from you help others find their scent",
      title: "How was it?",
      paragraphs: ["You’ve had a little time with your pieces now. A short review helps other people choose — and tells us what to make next."],
      cta: { label: "Write a review", path: data.products?.[0]?.path ?? "/account/orders" },
    },
    "welcome-ritual": {
      subject: "Pieces to complete your ritual",
      preview: "Chosen to sit beautifully alongside what you already have",
      title: "Complete the ritual",
      paragraphs: ["These pair beautifully with what you chose — the combinations our customers return to most."],
      cta: { label: "Explore the collection", path: "/shop" },
    },
    "winback-miss": {
      subject: "We’ve missed you",
      preview: "New batches have come out of the atelier since your last visit",
      title: `${hi}we’ve missed you`.replace(/^./, (x) => x.toUpperCase()),
      paragraphs: ["It has been a little while. New small batches have left the atelier since — a few of them may feel familiar."],
      cta: { label: "See what’s new", path: "/shop" },
    },
    "winback-coupon": {
      subject: "Something just for you",
      preview: "A personal code to welcome you back",
      title: "A small welcome back",
      paragraphs: ["We’d love to see you again, so here is a code made for you alone. It works once, on any piece."],
      coupon,
      cta: { label: "Shop now", path: "/shop" },
    },
    "winback-reminder": {
      subject: "Your personal code expires soon",
      preview: "A gentle reminder before your code lapses",
      title: "Before it lapses",
      paragraphs: ["A gentle reminder: the code we set aside for you expires in a few days."],
      coupon,
      cta: { label: "Use my code", path: "/shop" },
    },
    "vip-thanks": {
      subject: "Thank you for being one of our closest",
      preview: `A gift of ${data.points ?? 0} ${brand.loyalty.name} — and first look at new batches`,
      title: `${hi}thank you`.replace(/^./, (x) => x.toUpperCase()),
      paragraphs: [
        "You are among the people who keep this atelier going. As a small thank-you we’ve added bonus points to your account.",
        "You’ll also hear about new batches before anyone else — keep an eye on your inbox.",
      ],
      points: data.points ? { amount: data.points, name: brand.loyalty.name } : undefined,
      cta: { label: "View my account", path: "/account" },
    },
    "lapsed-coupon": {
      subject: "One last note from us",
      preview: "We won’t keep writing — but the door is always open",
      title: "The door is always open",
      paragraphs: [
        "It’s been a long while, so this is our last note for now. If you’d like to return, here is a personal code to make it a little easier.",
        "Either way, thank you for having been part of our story.",
      ],
      coupon,
      cta: { label: "Visit the atelier", path: "/shop" },
    },
    "review-request": {
      subject: "How did your order arrive?",
      preview: "Share a few words about your pieces",
      title: "How is it?",
      paragraphs: ["Your order arrived a few days ago. We’d love to know how you’re finding it — a short review helps others choose."],
      cta: { label: "Write a review", path: data.products?.[0]?.path ?? "/account/orders" },
    },
  };
  const { subject, ...props } = c[template];
  return { subject, react: JourneyEmail({ ...props, ...base }) };
}

/** Sample data for the admin preview. */
export function samplePreview(template: TemplateKey, key: JourneyKey, config: unknown) {
  const steps = journeySteps(key, config);
  const action = steps.flatMap((s) => s.actions);
  const c = action.find((a) => a.kind === "coupon");
  const p = action.find((a) => a.kind === "points");
  const sample: Product[] = [
    { name: "Aged Oud Attar", path: "/shop", note: "Deep, resinous, slow" },
    { name: "Rose Bakhoor", path: "/shop", note: "For evenings" },
  ];
  return journeyEmail(
    template,
    {
      name: "Ayesha Khan",
      coupon: c && c.kind === "coupon" ? { code: "WB-EXAMPLE7K2M", percent: c.percentOff, expiresAt: new Date(Date.now() + c.validDays * DAY) } : null,
      points: p && p.kind === "points" ? p.amount : null,
      products: sample,
    },
    "customer@example.com",
  );
}

// ─────────────────────────────── Steps ───────────────────────────────

type StepOutcome =
  | { kind: "none" }
  | { kind: "exited" | "converted" | "completed" | "skipped" | "deferred" }
  | { kind: "daily-cap" }
  | { kind: "send"; messageId: string; template: TemplateKey; to: string; userId: string; context: { orderId?: string } };

async function checkCondition(q: Tx, cond: StepCondition, e: { id: string; userId: string; context: Prisma.JsonValue }, now: Date): Promise<"ok" | "skip" | "exit"> {
  const ctx = (e.context ?? {}) as { orderId?: string };
  switch (cond.kind) {
    case "still-in": {
      const seg = await segmentNow(q, e.userId, now);
      return seg && cond.segments.includes(seg) ? "ok" : "exit";
    }
    case "has-unreviewed": {
      if (!ctx.orderId) return cond.otherwise;
      const n = await q.orderItem.count({
        where: { orderId: ctx.orderId, variant: { product: { isGiftCard: false, isActive: true, reviews: { none: { userId: e.userId } } } } },
      });
      return n > 0 ? "ok" : cond.otherwise;
    }
    case "coupon-unused": {
      const m = await q.journeyMessage.findUnique({ where: { enrollmentId_step: { enrollmentId: e.id, step: cond.fromStep } }, select: { couponCode: true, couponExpiresAt: true } });
      if (!m?.couponCode || (m.couponExpiresAt && m.couponExpiresAt <= now)) return "skip";
      const used = await q.order.count({ where: { couponCode: m.couponCode, status: { not: "CANCELLED" } } });
      return used ? "skip" : "ok";
    }
  }
}

/** Runs the due step of one enrollment, if this worker can claim it. */
async function runStep(enrollmentId: string, settings: JourneySettings, now: Date): Promise<StepOutcome> {
  return db.$transaction(
    async (tx): Promise<StepOutcome> => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "JourneyEnrollment" WHERE id = ${enrollmentId} AND status = 'ACTIVE' AND "nextRunAt" <= ${ts(now)}
        FOR UPDATE SKIP LOCKED`;
      if (!claimed.length) return { kind: "none" };
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SEND_LOCK})`;

      const e = await tx.journeyEnrollment.findUniqueOrThrow({ where: { id: enrollmentId }, include: { journey: true, user: { select: recipientSelect } } });
      if (!e.journey.enabled) return { kind: "none" };
      const key = e.journey.key as JourneyKey;
      const steps: JourneyStep[] = journeySteps(key, e.journey.config);
      const end = (status: "EXITED" | "COMPLETED" | "CONVERTED", reason: string, extra: Prisma.JourneyEnrollmentUpdateInput = {}) =>
        tx.journeyEnrollment.update({ where: { id: e.id }, data: { status, exitReason: reason, exitedAt: now, nextRunAt: null, ...extra } });
      const advance = async (from: number) => {
        const next = steps[from + 1];
        if (!next) await end("COMPLETED", "finished", { step: from + 1 });
        else await tx.journeyEnrollment.update({ where: { id: e.id }, data: { step: from + 1, nextRunAt: new Date(now.getTime() + next.waitHours * HOUR) } });
      };

      const step = steps[e.step];
      if (!step) {
        await end("COMPLETED", "finished");
        return { kind: "completed" };
      }
      const blocked = await blockReason(tx, e.user, settings);
      if (blocked) {
        await end("EXITED", blocked);
        return { kind: "exited" };
      }
      if (JOURNEYS[key].exitOnOrder) {
        const order = await orderedSince(tx, e.userId, e.enteredAt, now);
        if (order) {
          await end("CONVERTED", "ordered", { convertedOrderId: order });
          return { kind: "converted" };
        }
      }
      for (const cond of step.conditions) {
        const r = await checkCondition(tx, cond, e, now);
        if (r === "exit") {
          await end("EXITED", cond.kind === "still-in" ? "left segment" : "nothing to ask");
          return { kind: "exited" };
        }
        if (r === "skip") {
          await advance(e.step);
          return { kind: "skipped" };
        }
      }

      // Caps: one journey email per customer per window, and a store-wide daily ceiling.
      const recent = await tx.journeyMessage.findFirst({
        where: { userId: e.userId, status: { in: ["SENDING", "SENT"] }, sentAt: { gt: new Date(now.getTime() - settings.frequencyCapHours * HOUR), lte: now } },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
      });
      if (recent) {
        await tx.journeyEnrollment.update({ where: { id: e.id }, data: { nextRunAt: new Date(recent.sentAt.getTime() + settings.frequencyCapHours * HOUR) } });
        return { kind: "deferred" };
      }
      const today = await tx.journeyMessage.count({ where: { sentAt: { gt: new Date(now.getTime() - DAY), lte: now }, status: { in: ["SENDING", "SENT"] } } });
      if (today >= settings.dailySendCap) {
        await tx.journeyEnrollment.update({ where: { id: e.id }, data: { nextRunAt: new Date(now.getTime() + HOUR) } });
        return { kind: "daily-cap" };
      }

      // Actions.
      let couponCode: string | null = null;
      let couponExpiresAt: Date | null = null;
      let points: number | null = null;
      let template: TemplateKey | null = null;
      for (const a of step.actions) {
        if (a.kind === "coupon") {
          couponCode = personalCouponCode(key === "lapsed" ? "LP" : "WB");
          couponExpiresAt = new Date(now.getTime() + a.validDays * DAY);
          await tx.coupon.create({
            data: { code: couponCode, description: `${JOURNEYS[key].name} journey · personal, single use`, type: "PERCENT", value: a.percentOff, minSubtotal: a.minSubtotal, maxUses: 1, startsAt: now, endsAt: couponExpiresAt },
          });
        } else if (a.kind === "points") {
          points = a.amount;
        } else template = a.template;
      }
      // The message row is the idempotency key for this step (unique enrollment + step).
      const message = await tx.journeyMessage.create({
        data: { enrollmentId: e.id, userId: e.userId, step: e.step, template: template ?? "none", email: e.user.email, sentAt: now, couponCode, couponExpiresAt, points },
      });
      if (points) {
        await tx.loyaltyEntry.create({ data: { userId: e.userId, points, reason: `${JOURNEYS[key].name} thank-you bonus` } });
        await tx.user.update({ where: { id: e.userId }, data: { loyaltyPoints: { increment: points } } });
      }
      await advance(e.step);
      if (!template) {
        await tx.journeyMessage.update({ where: { id: message.id }, data: { status: "SENT" } });
        return { kind: "skipped" };
      }
      return { kind: "send", messageId: message.id, template, to: e.user.email, userId: e.userId, context: (e.context ?? {}) as { orderId?: string } };
    },
    { timeout: 20_000, maxWait: 20_000 },
  );
}

async function deliver(o: Extract<StepOutcome, { kind: "send" }>) {
  const m = await db.journeyMessage.findUniqueOrThrow({
    where: { id: o.messageId },
    include: { user: { select: { name: true } }, enrollment: { select: { id: true, journey: { select: { key: true, config: true } } } } },
  });
  const key = m.enrollment.journey.key as JourneyKey;
  const data: EmailData = { name: m.user.name, points: m.points };
  const percentFor = (step: number) => {
    const a = journeySteps(key, m.enrollment.journey.config)[step]?.actions.find((x) => x.kind === "coupon");
    return a && a.kind === "coupon" ? a.percentOff : 0;
  };
  if (m.couponCode && m.couponExpiresAt) data.coupon = { code: m.couponCode, percent: percentFor(m.step), expiresAt: m.couponExpiresAt };
  if (o.template === "winback-reminder") {
    const first = await db.journeyMessage.findUnique({ where: { enrollmentId_step: { enrollmentId: m.enrollmentId, step: 1 } } });
    if (first?.couponCode && first.couponExpiresAt) {
      const coupon = await db.coupon.findUnique({ where: { code: first.couponCode }, select: { value: true } });
      data.coupon = { code: first.couponCode, percent: coupon?.value ?? percentFor(1), expiresAt: first.couponExpiresAt };
    }
  }
  if (o.template === "welcome-review" || o.template === "review-request") data.products = await unreviewedProducts(o.userId, o.context.orderId);
  if (o.template === "welcome-ritual") data.products = await ritualRecommendations(o.userId).catch(() => []);

  const { subject, react } = journeyEmail(o.template, data, m.email);
  try {
    await sendEmail({ to: m.email, subject, react, headers: listUnsubscribeHeaders(m.email), throwOnError: true, devLog: `journey ${key} step ${m.step} (${o.template})` });
    await db.journeyMessage.update({ where: { id: m.id }, data: { status: "SENT" } });
    return true;
  } catch (e) {
    await db.journeyMessage.update({ where: { id: m.id }, data: { status: "FAILED", error: e instanceof Error ? e.message.slice(0, 500) : "send failed" } });
    console.error("[journeys] send failed", e);
    return false;
  }
}

// ─────────────────────────────── The job ───────────────────────────────

export type JourneyRun = {
  paused?: boolean;
  dryRun?: boolean;
  evaluated?: boolean;
  segments?: { created: number; changed: number; removed: number };
  enrolled: number;
  wouldEnroll?: Record<string, number>;
  dueSteps?: number;
  attributed: number;
  converted: number;
  sent: number;
  failed: number;
  skipped: number;
  deferred: number;
  exited: number;
  dailyCapReached?: boolean;
};

/**
 * The hourly job. `scope` limits everything to some customers (check scripts only — never touch real customers).
 */
export async function runJourneys(opts: { now?: Date; dryRun?: boolean; scope?: string[] } = {}): Promise<JourneyRun> {
  const scope = opts.scope;
  const now = opts.now ?? new Date();
  const settings = await getJourneySettings();
  const out: JourneyRun = { enrolled: 0, attributed: 0, converted: 0, sent: 0, failed: 0, skipped: 0, deferred: 0, exited: 0 };
  if (settings.paused) return { ...out, paused: true };
  const journeys = (await ensureJourneys()).filter((j) => j.enabled);

  if (opts.dryRun ?? settings.dryRun) {
    const { current } = await evaluateSegments(db, now, false, scope);
    const entries = await findEntries(db, journeys, current, settings, now, scope);
    const wouldEnroll = Object.fromEntries(journeys.map((j) => [j.key, entries.filter((e) => e.journeyId === j.id).length]));
    const dueSteps = await db.journeyEnrollment.count({ where: { status: "ACTIVE", nextRunAt: { lte: now }, journey: { enabled: true }, ...(scope ? { userId: { in: scope } } : {}) } });
    return { ...out, dryRun: true, wouldEnroll, dueSteps };
  }

  // 1 + 2. Evaluate segments, enroll, convert — one evaluator at a time (others skip this part).
  const evaluated = await db.$transaction(
    async (tx) => {
      const [lock] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${EVAL_LOCK}) AS ok`;
      if (!lock?.ok) return null;
      const seg = await evaluateSegments(tx, now, true, scope);
      const entries = await findEntries(tx, journeys, seg.current, settings, now, scope);
      const created = entries.length
        ? await tx.journeyEnrollment.createMany({
            data: entries.map((e) => ({ journeyId: e.journeyId, userId: e.userId, entryKey: e.entryKey, enteredAt: e.enteredAt, context: e.context, nextRunAt: now })),
            skipDuplicates: true,
          })
        : { count: 0 };
      const conv = await convert(tx, settings, now, scope);
      return { segments: { created: seg.created, changed: seg.changed, removed: seg.removed }, enrolled: created.count, ...conv };
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
  if (evaluated) Object.assign(out, evaluated, { evaluated: true });

  // 3. Advance due steps of enabled journeys, in small batches.
  let handled = 0;
  const tried = new Set<string>();
  while (handled < MAX_STEPS_PER_RUN) {
    const due = await db.journeyEnrollment.findMany({
      where: { status: "ACTIVE", nextRunAt: { lte: now }, journey: { enabled: true }, id: { notIn: [...tried] }, ...(scope ? { userId: { in: scope } } : {}) },
      orderBy: { nextRunAt: "asc" },
      take: BATCH,
      select: { id: true },
    });
    if (!due.length) break;
    for (const { id } of due) {
      tried.add(id);
      handled++;
      const r = await runStep(id, settings, now);
      if (r.kind === "send") {
        if (await deliver(r)) out.sent++;
        else out.failed++;
      } else if (r.kind === "skipped" || r.kind === "completed") out.skipped++;
      else if (r.kind === "deferred") out.deferred++;
      else if (r.kind === "exited") out.exited++;
      else if (r.kind === "converted") out.converted++;
      else if (r.kind === "daily-cap") {
        out.dailyCapReached = true;
        return out;
      }
    }
  }
  return out;
}

// ─────────────────────────────── Admin overview ───────────────────────────────

export async function journeyStats(now = new Date()) {
  const since = new Date(now.getTime() - 30 * DAY);
  const [journeys, active, sent, converted] = await Promise.all([
    ensureJourneys(),
    db.journeyEnrollment.groupBy({ by: ["journeyId"], where: { status: "ACTIVE" }, _count: true }),
    db.$queryRaw<{ journey_id: string; sent: number }[]>`
      SELECT e."journeyId" AS journey_id, COUNT(*)::int AS sent FROM "JourneyMessage" m JOIN "JourneyEnrollment" e ON e.id = m."enrollmentId"
      WHERE m.status = 'SENT' AND m.template <> 'none' AND m."sentAt" >= ${ts(since)} GROUP BY 1`,
    db.$queryRaw<{ journey_id: string; converted: number; revenue: bigint }[]>`
      SELECT e."journeyId" AS journey_id, COUNT(*)::int AS converted, COALESCE(SUM(m.revenue), 0)::bigint AS revenue
      FROM "JourneyMessage" m JOIN "JourneyEnrollment" e ON e.id = m."enrollmentId"
      WHERE m."convertedAt" >= ${ts(since)} GROUP BY 1`,
  ]);
  return new Map(
    journeys.map((j) => [
      j.key,
      {
        active: active.find((a) => a.journeyId === j.id)?._count ?? 0,
        sent: sent.find((s) => s.journey_id === j.id)?.sent ?? 0,
        converted: converted.find((c) => c.journey_id === j.id)?.converted ?? 0,
        revenue: Number(converted.find((c) => c.journey_id === j.id)?.revenue ?? 0),
      },
    ]),
  );
}
