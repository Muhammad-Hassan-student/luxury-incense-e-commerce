"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { cuid, done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";
import { CONFIG_SCHEMAS, evaluatePromotions, PROMOTION_TYPES, type PromoDef, type PromoLine, type PromoResult } from "@/lib/promotions";
import { getPromotionSettings, livePromotions, productNames, savePromotionSettings } from "@/server/promotions";
import { releasePreorders } from "@/server/preorders";

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

const ids = z.array(cuid).max(200);

/** Money inside `config` is in minor units (the form converts rupees). */
const promotionSchema = z
  .object({
    id: cuid.optional(),
    name: z.string().trim().min(2).max(80),
    badge: z.string().trim().max(40),
    type: z.enum(PROMOTION_TYPES),
    config: z.unknown(),
    productIds: ids,
    categoryIds: ids,
    startsAt: optionalDate,
    endsAt: optionalDate,
    isActive: z.boolean(),
    priority: z.number().int().min(0).max(1000),
    stackable: z.boolean(),
    allowCoupon: z.boolean(),
    includeTrade: z.boolean(),
    includeSubscriptions: z.boolean(),
  })
  .superRefine((p, ctx) => {
    if (p.startsAt && p.endsAt && p.endsAt <= p.startsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "End must be after start" });
    const parsed = CONFIG_SCHEMAS[p.type].safeParse(p.config);
    if (!parsed.success) ctx.addIssue({ code: "custom", path: ["config"], message: parsed.error.issues[0]?.message ?? "Check the offer settings" });
  });

function revalidatePromotions() {
  revalidatePath("/admin/promotions");
  revalidatePath("/", "layout");
}

export async function savePromotion(input: z.input<typeof promotionSchema>): Promise<ActionResult> {
  const user = await requirePermission("promotions.manage");
  const parsed = promotionSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { id, ...p } = parsed.data;
  const config = CONFIG_SCHEMAS[p.type].parse(p.config);
  const data = { ...p, badge: p.badge || null, config };
  const saved = id ? await db.promotion.update({ where: { id }, data, select: { id: true } }) : await db.promotion.create({ data, select: { id: true } });
  await audit(user.id, id ? "promotion.update" : "promotion.create", "Promotion", saved.id, { name: p.name, type: p.type, config, startsAt: p.startsAt?.toISOString() ?? null, endsAt: p.endsAt?.toISOString() ?? null, isActive: p.isActive });
  revalidatePromotions();
  return done(id ? `${p.name} saved` : `${p.name} created`, saved.id);
}

const activeSchema = z.object({ id: cuid, isActive: z.boolean() });

/** Pause / resume. A paused promotion never applies, whatever its window. */
export async function setPromotionActive(input: z.input<typeof activeSchema>): Promise<ActionResult> {
  const user = await requirePermission("promotions.manage");
  const parsed = activeSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const updated = await db.promotion.updateMany({ where: { id: parsed.data.id }, data: { isActive: parsed.data.isActive } });
  if (!updated.count) return fail("Promotion not found.");
  await audit(user.id, parsed.data.isActive ? "promotion.resume" : "promotion.pause", "Promotion", parsed.data.id);
  revalidatePromotions();
  return done(parsed.data.isActive ? "Promotion resumed" : "Promotion paused");
}

export async function deletePromotion(input: { id: string }): Promise<ActionResult> {
  const user = await requirePermission("promotions.manage");
  const parsed = z.object({ id: cuid }).safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const p = await db.promotion.findUnique({ where: { id: parsed.data.id }, select: { name: true } });
  if (!p) return fail("Promotion not found.");
  // Order history keeps its own snapshot (OrderPromotion.name), so usage stays readable.
  await db.promotion.delete({ where: { id: parsed.data.id } });
  await audit(user.id, "promotion.delete", "Promotion", parsed.data.id, { name: p.name });
  revalidatePromotions();
  return done(`${p.name} deleted`);
}

const settingsSchema = z.object({ maxDiscountPercent: z.number().int().min(5).max(95) });

export async function savePromotionGuard(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  const user = await requirePermission("promotions.manage");
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const before = await getPromotionSettings();
  await savePromotionSettings(parsed.data);
  await audit(user.id, "promotion.settings", "Setting", "promotions", { before, after: parsed.data });
  revalidatePromotions();
  return done("Discount guard saved");
}

// ─────────────────────────────── Live preview ───────────────────────────────

const previewSchema = z.object({
  draft: z.object({
    name: z.string().max(80),
    badge: z.string().max(40),
    type: z.enum(PROMOTION_TYPES),
    config: z.unknown(),
    productIds: ids,
    categoryIds: ids,
    priority: z.number().int().min(0).max(1000),
    stackable: z.boolean(),
    allowCoupon: z.boolean(),
    includeTrade: z.boolean(),
    includeSubscriptions: z.boolean(),
  }),
  /** The promotion being edited (left out of "other live promotions" so it isn't counted twice). */
  editingId: cuid.nullish(),
  sample: z.array(z.object({ variantId: cuid, quantity: z.number().int().min(1).max(10) })).min(1).max(12),
  withLive: z.boolean(),
});

export type PreviewResult =
  | { ok: true; result: Omit<PromoResult, "lines"> & { lines: (PromoResult["lines"][number] & { name: string })[] }; names: Record<string, string>; total: number; maxDiscountPercent: number }
  | { ok: false; error: string };

/** Runs the draft (as if live now) on a sample bag, optionally together with the promotions live right now. */
export async function previewPromotion(input: z.input<typeof previewSchema>): Promise<PreviewResult> {
  await requirePermission("promotions.manage");
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: zodMessage(parsed.error) };
  const { draft, sample, withLive, editingId } = parsed.data;
  const config = CONFIG_SCHEMAS[draft.type].safeParse(draft.config);
  if (!config.success) return { ok: false, error: config.error.issues[0]?.message ?? "Check the offer settings" };
  const variants = await db.productVariant.findMany({ where: { id: { in: sample.map((s) => s.variantId) } }, select: { id: true, price: true, label: true, product: { select: { id: true, name: true, categoryId: true, isGiftCard: true } } } });
  const byId = new Map(variants.map((v) => [v.id, v]));
  const lines: PromoLine[] = sample
    .filter((s) => byId.has(s.variantId))
    .map((s, i) => {
      const v = byId.get(s.variantId)!;
      return { id: `l${i}`, productId: v.product.id, categoryId: v.product.categoryId, listPrice: v.price, quantity: s.quantity, excluded: v.product.isGiftCard };
    });
  const now = new Date();
  const def = { ...draft, id: editingId ?? "draft", badge: draft.badge || null, config: config.data, startsAt: null, endsAt: null, isActive: true } as PromoDef;
  const others = withLive ? (await livePromotions(now)).filter((p) => p.id !== editingId) : [];
  const settings = await getPromotionSettings();
  const result = evaluatePromotions({ lines, promotions: [def, ...others], ctx: { now, maxDiscountPercent: settings.maxDiscountPercent } });
  const nameIds = [...new Set([...result.nudges.flatMap((n) => (n.kind === "BUY_X_GET_Y" ? n.getProductIds : n.kind === "FIXED_BUNDLE" ? n.missing.map((m) => m.productId) : []))])];
  const names = await productNames(nameIds);
  const labelled = result.lines.map((l, i) => {
    const v = byId.get(sample.filter((s) => byId.has(s.variantId))[i].variantId)!;
    return { ...l, name: `${v.product.name} · ${v.label}` };
  });
  const goods = result.lines.reduce((n, l) => n + l.unitPrice * l.quantity, 0);
  return { ok: true, result: { ...result, lines: labelled }, names, total: goods - result.promoDiscount, maxDiscountPercent: settings.maxDiscountPercent };
}

// ─────────────────────────────── Pre-orders ───────────────────────────────

const preorderSchema = z.object({
  variantId: cuid,
  active: z.boolean(),
  shipDate: z
    .string()
    .trim()
    .min(1, "Choose the expected ship date")
    .transform((s, ctx) => {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: "custom", message: "Invalid date" });
        return z.NEVER;
      }
      return d;
    }),
  cap: z.number().int().min(1).max(100_000).nullable(),
  note: z.string().trim().max(200),
});

export async function savePreorder(input: z.input<typeof preorderSchema>): Promise<ActionResult> {
  const user = await requirePermission("promotions.manage");
  const parsed = preorderSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { variantId, ...p } = parsed.data;
  const variant = await db.productVariant.findUnique({ where: { id: variantId }, select: { sku: true, product: { select: { isGiftCard: true, model: true } } } });
  if (!variant) return fail("Variant not found.");
  if (variant.product.isGiftCard || variant.product.model === "GIFTBOX") return fail("Gift cards and coffrets can’t be pre-ordered.");
  const existing = await db.preorderVariant.findUnique({ where: { variantId } });
  if (existing && p.cap != null && p.cap < existing.sold) return fail(`${existing.sold} units are already pre-ordered — the cap can’t be lower.`);
  await db.preorderVariant.upsert({ where: { variantId }, update: { ...p, note: p.note || null }, create: { variantId, ...p, note: p.note || null } });
  await audit(user.id, existing ? "preorder.update" : "preorder.create", "PreorderVariant", variantId, { sku: variant.sku, active: p.active, shipDate: p.shipDate.toISOString(), cap: p.cap });
  revalidatePromotions();
  return done(`Pre-order for ${variant.sku} saved`);
}

const releaseSchema = z.object({ variantId: cuid, endPreorder: z.boolean() });

/** Stock has arrived: take it for waiting pre-orders (oldest first) and lift their fulfilment hold. */
export async function releasePreorderStock(input: z.input<typeof releaseSchema>): Promise<ActionResult> {
  const user = await requirePermission("promotions.manage", "inventory.adjust");
  const parsed = releaseSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const r = await releasePreorders(parsed.data.variantId, user.id, { endPreorder: parsed.data.endPreorder });
  await audit(user.id, "preorder.release", "PreorderVariant", parsed.data.variantId, { released: r.released, blocked: r.blocked, endPreorder: parsed.data.endPreorder });
  revalidatePromotions();
  revalidatePath("/admin/fulfilment");
  if (!r.released.length && r.blocked) return fail(`Not enough free stock for ${r.blocked} yet — receive the stock first.`);
  if (!r.released.length) return done("No pre-orders were waiting.");
  const units = r.released.reduce((n, x) => n + x.quantity, 0);
  return done(`${units} unit${units === 1 ? "" : "s"} released on ${r.released.length} order${r.released.length === 1 ? "" : "s"}${r.blocked ? ` — ${r.blocked} still waits for stock` : ""}`);
}
