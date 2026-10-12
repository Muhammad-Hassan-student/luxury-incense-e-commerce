"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { cuid, done, fail, isUniqueViolation, zodMessage } from "@/lib/admin-server";
import { toMinor, type ActionResult } from "@/lib/admin-shared";
import { AFF_CODE_RE, createPayoutBatch, getAffiliateSettings, inviteAffiliate, normalizeAffCode, runAffiliateSweep, saveAffiliateSettings } from "@/server/affiliates";
import { sendEmail } from "@/server/email";
import { SimpleEmail } from "@/emails/simple";

const revalidate = () => revalidatePath("/admin/affiliates");
const percent = z.number().min(0).max(50);

const settingsSchema = z.object({
  enabled: z.boolean(),
  defaultCommissionPercent: percent,
  cookieDays: z.number().int().min(1).max(90),
  holdDays: z.number().int().min(0).max(120),
  /** Rupees. */
  minPayout: z.number().min(0).max(100_000),
});

export async function saveAffiliateProgram(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  const user = await requirePermission("affiliates.manage");
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const before = await getAffiliateSettings();
  const after = await saveAffiliateSettings({ ...parsed.data, minPayout: toMinor(parsed.data.minPayout) });
  await audit(user.id, "affiliate.settings", "Setting", "affiliates", { before, after });
  revalidate();
  return done("Programme settings saved");
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(80),
  ratePercent: percent.nullable(),
  code: z.string().trim().max(20),
});

export async function inviteAffiliateAction(input: z.input<typeof inviteSchema>): Promise<ActionResult> {
  const user = await requirePermission("affiliates.manage");
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const d = parsed.data;
  try {
    const a = await inviteAffiliate({ email: d.email, name: d.name || null, commissionBps: d.ratePercent == null ? null : Math.round(d.ratePercent * 100), code: d.code || null });
    await audit(user.id, "affiliate.invite", "Affiliate", a.id, { email: a.email, code: a.code, status: a.status });
    await sendEmail({
      to: a.email,
      subject: "You’re invited to the Maison Oud affiliate programme",
      devLog: `affiliate invite ${a.code}`,
      react: SimpleEmail({
        preview: "Share Maison Oud and earn on every order",
        title: "Join our affiliate programme",
        body: `You’ve been invited to share Maison Oud. Sign in with ${a.email} and open “Affiliate” in your account to get your link and code (${a.code}).`,
        cta: { label: "Open your affiliate page", path: "/account/affiliate" },
      }),
    }).catch((e) => console.error("[affiliates] invite email", e));
    revalidate();
    return done(a.status === "APPROVED" ? `${a.email} added and approved` : `Invitation sent to ${a.email}`, a.id);
  } catch (e) {
    if (isUniqueViolation(e)) return fail("That code is taken.");
    return fail(e instanceof Error ? e.message : "Could not invite.");
  }
}

const statusSchema = z.object({ id: cuid, status: z.enum(["APPROVED", "SUSPENDED"]) });

export async function setAffiliateStatus(input: z.input<typeof statusSchema>): Promise<ActionResult> {
  const user = await requirePermission("affiliates.manage");
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const a = await db.affiliate.findUnique({ where: { id: parsed.data.id } });
  if (!a) return fail("Affiliate not found.");
  if (parsed.data.status === "APPROVED" && !a.userId) return fail("They haven’t joined yet — approval happens when they sign in with the invited email.");
  await db.affiliate.update({ where: { id: a.id }, data: { status: parsed.data.status, approvedAt: parsed.data.status === "APPROVED" ? (a.approvedAt ?? new Date()) : a.approvedAt } });
  await audit(user.id, parsed.data.status === "APPROVED" ? "affiliate.approve" : "affiliate.suspend", "Affiliate", a.id, { code: a.code, from: a.status });
  if (parsed.data.status === "APPROVED" && a.status === "PENDING") {
    await sendEmail({
      to: a.email,
      subject: "You’re in: Maison Oud affiliate programme",
      devLog: `affiliate approved ${a.code}`,
      react: SimpleEmail({ preview: "Your affiliate link is ready", title: "Welcome aboard", body: `Your link and code (${a.code}) are ready in your account.`, cta: { label: "Get your link", path: "/account/affiliate" } }),
    }).catch((e) => console.error("[affiliates] approval email", e));
  }
  revalidate();
  return done(parsed.data.status === "APPROVED" ? `${a.code} approved` : `${a.code} suspended`);
}

const updateSchema = z.object({
  id: cuid,
  ratePercent: percent.nullable(),
  code: z.string().trim().max(20),
  /** Personal discount code; blank removes it. */
  couponCode: z.string().trim().toUpperCase().max(32),
  couponPercent: z.number().int().min(1).max(50),
});

/** Rate, link code and personal discount code (creates the coupon when it doesn't exist yet). */
export async function updateAffiliate(input: z.input<typeof updateSchema>): Promise<ActionResult> {
  const user = await requirePermission("affiliates.manage");
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const d = parsed.data;
  const a = await db.affiliate.findUnique({ where: { id: d.id } });
  if (!a) return fail("Affiliate not found.");
  const code = normalizeAffCode(d.code || a.code);
  if (!AFF_CODE_RE.test(code)) return fail("Link codes are 4–20 letters or numbers.");
  if (d.couponCode && !/^[A-Z0-9_-]{3,32}$/.test(d.couponCode)) return fail("Discount codes are 3–32 letters, numbers, dash or underscore.");
  try {
    if (d.couponCode) {
      const coupon = await db.coupon.findUnique({ where: { code: d.couponCode } });
      if (!coupon) {
        await db.coupon.create({ data: { code: d.couponCode, type: "PERCENT", value: d.couponPercent, description: `Affiliate code · ${a.name ?? a.email}` } });
        await audit(user.id, "coupon.create", "Coupon", d.couponCode, { code: d.couponCode, type: "PERCENT", value: d.couponPercent, affiliate: a.code });
      }
    }
    await db.affiliate.update({ where: { id: a.id }, data: { code, commissionBps: d.ratePercent == null ? null : Math.round(d.ratePercent * 100), couponCode: d.couponCode || null } });
  } catch (e) {
    if (isUniqueViolation(e)) return fail("That link or discount code already belongs to someone else.");
    throw e;
  }
  await audit(user.id, "affiliate.update", "Affiliate", a.id, { code, ratePercent: d.ratePercent, couponCode: d.couponCode || null });
  revalidate();
  return done(`${code} saved`);
}

const reviewSchema = z.object({ id: cuid, decision: z.enum(["approve", "reject"]), note: z.string().trim().max(200).optional() });

/** Staff decision on a commission (flagged ones are never auto-approved). */
export async function reviewCommission(input: z.input<typeof reviewSchema>): Promise<ActionResult> {
  const user = await requirePermission("affiliates.manage");
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const c = await db.affiliateCommission.findUnique({ where: { id: parsed.data.id } });
  if (!c) return fail("Commission not found.");
  if (parsed.data.decision === "approve") {
    if (c.status !== "PENDING") return fail("Only pending commissions can be approved.");
    const order = await db.order.findUnique({ where: { id: c.orderId }, select: { status: true } });
    if (!order || order.status === "CANCELLED" || order.status === "REFUNDED") return fail("That order was cancelled or refunded.");
    await db.affiliateCommission.update({ where: { id: c.id }, data: { status: "APPROVED", approvedAt: new Date(), note: parsed.data.note || c.note } });
  } else {
    if (!["ATTRIBUTED", "PENDING", "APPROVED"].includes(c.status)) return fail("This commission can’t be rejected now.");
    await db.affiliateCommission.update({ where: { id: c.id }, data: { status: "REJECTED", amount: 0, note: parsed.data.note || "Rejected by staff" } });
  }
  await audit(user.id, `affiliate.commission_${parsed.data.decision}`, "AffiliateCommission", c.id, { order: c.orderNumber, amount: c.amount, flags: c.flags });
  revalidate();
  return done(parsed.data.decision === "approve" ? `${c.orderNumber} approved` : `${c.orderNumber} rejected`);
}

const payoutSchema = z.object({ reference: z.string().trim().max(80) });

export async function runPayoutBatch(input: z.input<typeof payoutSchema>): Promise<ActionResult> {
  const user = await requirePermission("affiliates.manage");
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const r = await createPayoutBatch(user.id, { reference: parsed.data.reference || null });
  await audit(user.id, "affiliate.payout", "AffiliatePayout", r.batch, { affiliates: r.paid.length, total: r.total });
  revalidate();
  if (!r.paid.length) return fail("Nothing to pay — no affiliate has approved earnings above the minimum payout.");
  return done(`Batch ${r.batch}: ${r.paid.length} payout${r.paid.length === 1 ? "" : "s"}`, r.batch);
}

export async function runAffiliateSweepAction(): Promise<ActionResult> {
  const user = await requirePermission("affiliates.manage");
  const r = await runAffiliateSweep();
  await audit(user.id, "affiliate.sweep", "AffiliateCommission", null, r);
  revalidate();
  return done(`${r.approved} commission${r.approved === 1 ? "" : "s"} approved`);
}
