import "server-only";
import { z } from "zod";
import type { TradeAccount } from "@/generated/prisma/client";
import { env } from "@/env";
import { brand } from "@/config/brand";
import { formatMoney } from "@/lib/money";
import { toMinor } from "@/lib/admin-shared";
import type { Permission } from "@/lib/permissions";
import { TERMS_LABEL, minimumOrderFor } from "@/components/trade/trade-rules";
import { audit } from "./audit";
import { db } from "./db";
import { TradeError, tradeEmail } from "./trade";
import { staffCreateAccountSchema, type StaffCreateAccountInput } from "./trade-schemas";
import { VisitError, createVisit, emailVisitor, getVisitSettings } from "./visits";
import { VISIT_PURPOSES, fmtVisitDay, fmtVisitTime, walkInStart } from "./visit-schedule";

/*
 * Records staff create on someone else's behalf: trade accounts opened by the trade desk, visits booked by phone and
 * reception walk-ins. Each function re-checks the actor's permission itself (server actions gate first too), validates
 * with zod, audits and sends the same emails the self-service flows send.
 */

export type Actor = { id: string; permissions: readonly string[] };

/** The actor lacks the permission. Distinct from business-rule errors so callers can map it to 403. */
export class StaffPermissionError extends Error {}

function assertCan(actor: Actor, perm: Permission) {
  if (!actor.permissions.includes(perm)) throw new StaffPermissionError(`You need the “${perm}” permission to do this.`);
}

const fieldErrorsOf = (err: z.ZodError) => {
  const out: Record<string, string> = {};
  for (const i of err.issues) out[i.path.join(".")] ??= i.message;
  return out;
};

/** Invalid input with per-field messages (paths joined by "."). */
export class StaffInputError extends Error {
  constructor(public fieldErrors: Record<string, string>) {
    super(Object.values(fieldErrors)[0] ?? "Please check the form.");
  }
}

// ─────────────────────────────── Trade accounts ───────────────────────────────

/** The login already has a trade account; `accountId` lets the UI link to it. */
export class ExistingTradeAccountError extends TradeError {
  constructor(
    public accountId: string,
    businessName: string,
  ) {
    super(`That login already has a trade account (${businessName}).`);
  }
}

const adminEmails = () =>
  env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

/** Sign-in link that lands the buyer in the portal (magic link is requested on the sign-in page). */
export const PORTAL_SIGNIN_PATH = `/signin?callbackUrl=${encodeURIComponent("/trade/portal")}`;

/**
 * Opens a trade account for a buyer. The login email links an existing customer, or creates a new CUSTOMER user.
 * APPROVED (default) accounts can trade at once; PENDING ones wait in the review queue like a public application.
 */
export async function staffCreateTradeAccount(actor: Actor, input: StaffCreateAccountInput) {
  assertCan(actor, "trade.manage");
  const parsed = staffCreateAccountSchema.safeParse(input);
  if (!parsed.success) throw new StaffInputError(fieldErrorsOf(parsed.error));
  const d = parsed.data;
  const a = d.application;
  const approved = d.status === "APPROVED";
  if (adminEmails().includes(d.email)) throw new TradeError("That email is reserved for store administrators.");
  if (d.tierId && !(await db.priceTier.findUnique({ where: { id: d.tierId }, select: { id: true } }))) throw new TradeError("That price tier no longer exists.");

  const creditLimit = d.terms === "PREPAID" ? 0 : toMinor(d.creditLimit);
  const minOrderValue = toMinor(d.minOrderValue);
  const now = new Date();

  let created: { account: TradeAccount; newUser: boolean };
  try {
    created = await db.$transaction(async (tx) => {
      // Serialise on the email so two desks can't create the same login twice.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"User.email:" + d.email}))`;
      const existing = await tx.user.findFirst({
        where: { email: { equals: d.email, mode: "insensitive" } },
        select: { id: true, role: true, phone: true, name: true, tradeAccount: { select: { id: true, businessName: true } } },
      });
      if (existing && existing.role !== "CUSTOMER") throw new TradeError("That email belongs to a staff member. Use the buyer’s own email.");
      if (existing?.tradeAccount) throw new ExistingTradeAccountError(existing.tradeAccount.id, existing.tradeAccount.businessName);
      const user =
        existing ??
        (await tx.user.create({ data: { email: d.email, name: a.contactName, phone: a.phone, role: "CUSTOMER" }, select: { id: true, role: true, phone: true, name: true } }));
      if (existing && (!existing.name || !existing.phone)) {
        await tx.user.update({ where: { id: existing.id }, data: { name: existing.name ?? a.contactName, phone: existing.phone ?? a.phone } });
      }
      const account = await tx.tradeAccount.create({
        data: {
          userId: user.id,
          status: d.status,
          businessName: a.businessName,
          businessType: a.businessType,
          contactName: a.contactName,
          phone: a.phone,
          taxId: a.taxId,
          website: a.website,
          address: { fullName: a.contactName, phone: a.phone, line1: a.line1, ...(a.line2 ? { line2: a.line2 } : {}), city: a.city, state: a.state, postalCode: a.postalCode, country: a.country },
          expectedMonthly: a.expectedMonthly,
          message: a.message,
          tierId: d.tierId,
          terms: d.terms,
          creditLimit,
          minOrderValue,
          staffNotes: d.staffNotes,
          ...(approved ? { reviewedById: actor.id, reviewedAt: now } : {}),
        },
      });
      return { account, newUser: !existing };
    });
  } catch (e) {
    if (typeof e === "object" && e && "code" in e && (e as { code: unknown }).code === "P2002") throw new TradeError("That login was just given a trade account. Reload and check.");
    throw e;
  }

  const { account, newUser } = created;
  await audit(actor.id, "trade.create", "TradeAccount", account.id, {
    business: account.businessName,
    email: d.email,
    newUser,
    status: account.status,
    tierId: account.tierId,
    terms: account.terms,
    creditLimit: account.creditLimit,
    minOrderValue: account.minOrderValue,
  });

  const tier = account.tierId ? await db.priceTier.findUnique({ where: { id: account.tierId } }) : null;
  const minimum = minimumOrderFor(account, tier);
  const signIn = newUser
    ? `Sign in with ${d.email} — we’ll email you a one-time link, no password needed.`
    : `Sign in as usual with ${d.email}; your trade portal is now linked to that login.`;
  await tradeEmail(
    d.email,
    approved ? "Welcome to Maison Oud Trade" : "We’ve started your trade application",
    approved
      ? {
          preview: "Your trade account is open",
          title: "Your trade account is open",
          paragraphs: [
            `Welcome, ${a.contactName.split(" ")[0]}. Our trade desk has opened a trade account for ${account.businessName}: wholesale prices, case packs and your payment terms are live in the trade portal.`,
            signIn,
            `Questions about an order? Reply to this email or write to ${brand.email}.`,
          ],
          details: [
            ["Price tier", tier ? `${tier.name} (${tier.discountPercent}% off retail)` : "Standard trade"],
            ["Payment terms", TERMS_LABEL[account.terms]],
            ...(account.terms !== "PREPAID" ? ([["Credit limit", formatMoney(account.creditLimit)]] as [string, string][]) : []),
            ["Minimum order", minimum ? formatMoney(minimum) : "None"],
          ],
          cta: { label: "Sign in to the trade portal", path: PORTAL_SIGNIN_PATH },
        }
      : {
          preview: "Your trade application is with our trade desk",
          title: "Application started",
          paragraphs: [
            `Thank you, ${a.contactName.split(" ")[0]}. We’ve recorded a trade application for ${account.businessName} from our conversation. Our trade desk will confirm your terms shortly.`,
            signIn,
          ],
          details: [["Business", account.businessName]],
          cta: { label: "View your application", path: `/signin?callbackUrl=${encodeURIComponent("/trade/apply")}` },
        },
  );
  return { account, newUser };
}

// ─────────────────────────────── Visits ───────────────────────────────

const phone = z
  .string()
  .trim()
  .min(7, "Enter a phone number.")
  .max(32)
  .regex(/^[+()\d\s.-]+$/, "Phone numbers may contain digits, spaces, +, - and brackets.");

export const staffVisitSchema = z.object({
  purpose: z.enum(VISIT_PURPOSES, "Choose the purpose of the visit."),
  startsAt: z.iso.datetime({ offset: true, message: "Choose a time." }).transform((s) => new Date(s)),
  groupSize: z.number().int("Party size must be a whole number.").min(1, "At least one guest.").max(500),
  name: z.string().trim().min(2, "Enter the visitor’s name.").max(120),
  email: z.string().trim().max(200).pipe(z.email("Enter a valid email.")),
  phone,
  company: z.string().trim().max(160).optional().default(""),
  notes: z.string().trim().max(4000).optional().default(""),
  override: z.boolean().optional().default(false),
});
export type StaffVisitInput = z.input<typeof staffVisitSchema>;

/** Books a visit for someone (phone or email enquiry): CONFIRMED at once, visitor pass emailed. */
export async function staffCreateVisit(actor: Actor, input: StaffVisitInput, opts: { now?: Date } = {}) {
  assertCan(actor, "visits.manage");
  const parsed = staffVisitSchema.safeParse(input);
  if (!parsed.success) throw new StaffInputError(fieldErrorsOf(parsed.error));
  const d = parsed.data;
  const s = await getVisitSettings();
  const { visit, overCapacity, remainingBefore } = await createVisit(
    { purpose: d.purpose, startsAt: d.startsAt, groupSize: d.groupSize, name: d.name, email: d.email, phone: d.phone, company: d.company, staffNotes: d.notes },
    { now: opts.now, settings: s, staff: { override: d.override } },
  );
  await audit(actor.id, "visit.create", "Visit", visit.id, { reference: visit.reference, startsAt: visit.startsAt.toISOString(), groupSize: visit.groupSize, override: d.override });
  if (overCapacity) {
    await audit(actor.id, "visit.capacity_override", "Visit", visit.id, {
      reference: visit.reference,
      startsAt: visit.startsAt.toISOString(),
      groupSize: visit.groupSize,
      remainingBefore,
      capacity: s.capacityPerSlot,
    });
  }
  await emailVisitor(visit, "confirmed", { settings: s });
  return { visit, overCapacity, when: `${fmtVisitDay(visit.startsAt, s.timezone)}, ${fmtVisitTime(visit.startsAt, s.timezone)}` };
}

const optionalPhone = z
  .string()
  .trim()
  .max(32)
  .refine((v) => !v || /^[+()\d\s.-]{7,}$/.test(v), "Enter a valid phone number or leave it blank.")
  .optional()
  .default("");

export const walkInSchema = z.object({
  name: z.string().trim().min(2, "Enter the visitor’s name.").max(120),
  groupSize: z.number().int("Party size must be a whole number.").min(1, "At least one guest.").max(500),
  purpose: z.enum(VISIT_PURPOSES).optional().default("TOUR"),
  phone: optionalPhone,
  email: z
    .string()
    .trim()
    .max(200)
    .refine((v) => !v || z.email().safeParse(v).success, "Enter a valid email or leave it blank.")
    .optional()
    .default(""),
  company: z.string().trim().max(160).optional().default(""),
  notes: z.string().trim().max(4000).optional().default(""),
});
export type WalkInInput = z.input<typeof walkInSchema>;

/** Someone at the gate without a booking: recorded against the running slot and checked in now. No email is sent. */
export async function staffWalkIn(actor: Actor, input: WalkInInput, opts: { now?: Date } = {}) {
  assertCan(actor, "visits.manage");
  const parsed = walkInSchema.safeParse(input);
  if (!parsed.success) throw new StaffInputError(fieldErrorsOf(parsed.error));
  const d = parsed.data;
  const now = opts.now ?? new Date();
  const s = await getVisitSettings();
  const startsAt = walkInStart(s, now);
  const { visit, overCapacity, remainingBefore } = await createVisit(
    { purpose: d.purpose, startsAt, groupSize: d.groupSize, name: d.name, email: d.email, phone: d.phone, company: d.company, staffNotes: d.notes || "Walk-in" },
    { now, settings: s, staff: { walkIn: true } },
  );
  await audit(actor.id, "visit.walk_in", "Visit", visit.id, { reference: visit.reference, startsAt: visit.startsAt.toISOString(), groupSize: visit.groupSize, overCapacity, remainingBefore });
  return { visit, overCapacity };
}

export { VisitError };
