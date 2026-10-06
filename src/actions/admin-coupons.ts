"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DiscountType } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { requireRole } from "@/server/roles";
import { audit } from "@/server/audit";
import { cuid, done, fail, isUniqueViolation, zodMessage } from "@/lib/admin-server";
import { toMinor, type ActionResult } from "@/lib/admin-shared";

const optionalDate = z
  .string()
  .trim()
  .transform((s, ctx) => {
    if (!s) return null;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Invalid date" });
      return z.NEVER;
    }
    return d;
  });

const couponSchema = z
  .object({
    id: z.string().max(64).optional(),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(3)
      .max(32)
      .regex(/^[A-Z0-9_-]+$/, "Letters, numbers, dash and underscore only"),
    description: z.string().trim().max(200),
    type: z.enum(DiscountType),
    /** Percent (0–100) for PERCENT, major units for FIXED, ignored for FREE_SHIPPING. */
    value: z.number().min(0).max(10_000_000),
    /** Major units. */
    minSubtotal: z.number().min(0).max(10_000_000),
    maxUses: z.number().int().min(1).max(10_000_000).nullable(),
    startsAt: optionalDate,
    endsAt: optionalDate,
    isActive: z.boolean(),
  })
  .superRefine((c, ctx) => {
    if (c.type === "PERCENT" && (c.value <= 0 || c.value > 100 || !Number.isInteger(c.value))) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Percent must be a whole number from 1 to 100" });
    }
    if (c.type === "FIXED" && c.value <= 0) ctx.addIssue({ code: "custom", path: ["value"], message: "Enter an amount" });
    if (c.startsAt && c.endsAt && c.endsAt <= c.startsAt) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "End must be after start" });
    }
  });

function revalidateCoupons() {
  revalidatePath("/admin/coupons");
  revalidatePath("/", "layout");
}

export async function saveCoupon(input: z.input<typeof couponSchema>): Promise<ActionResult> {
  const user = await requireRole("MANAGER");
  const parsed = couponSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { id, ...c } = parsed.data;
  const data = {
    code: c.code,
    description: c.description || null,
    type: c.type,
    value: c.type === "PERCENT" ? c.value : c.type === "FIXED" ? toMinor(c.value) : 0,
    minSubtotal: toMinor(c.minSubtotal),
    maxUses: c.maxUses,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    isActive: c.isActive,
  };
  try {
    const saved = id
      ? await db.coupon.update({ where: { id }, data, select: { id: true } })
      : await db.coupon.create({ data, select: { id: true } });
    await audit(user.id, id ? "coupon.update" : "coupon.create", "Coupon", saved.id, { code: data.code, type: data.type, value: data.value });
    revalidateCoupons();
    return done(id ? `${data.code} saved` : `${data.code} created`, saved.id);
  } catch (e) {
    if (isUniqueViolation(e)) return fail("That code already exists.");
    throw e;
  }
}

const activeSchema = z.object({ id: cuid, isActive: z.boolean() });

export async function setCouponActive(input: z.input<typeof activeSchema>): Promise<ActionResult> {
  const user = await requireRole("MANAGER");
  const parsed = activeSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const updated = await db.coupon.updateMany({ where: { id: parsed.data.id }, data: { isActive: parsed.data.isActive } });
  if (!updated.count) return fail("Coupon not found.");
  await audit(user.id, parsed.data.isActive ? "coupon.activate" : "coupon.deactivate", "Coupon", parsed.data.id);
  revalidateCoupons();
  return done(parsed.data.isActive ? "Coupon active" : "Coupon deactivated");
}
