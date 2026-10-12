import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { isCurrency, type Currency } from "@/config/brand";
import { convertMinor, regionSchema, roundingFor, ROUNDINGS, type Region, type Rounding } from "@/lib/region-shared";
import { db } from "./db";
import { audit } from "./audit";
import { buildFxTable, getRegion, invalidateRegion, primeMoney, REGION_KEY, RegionPermissionError } from "./region";

/*
 * Base-currency change wizard (owner only). Every stored price is in the base currency, so changing it re-prices
 * the catalogue and every fixed amount:
 *   variants (price, compare-at, cost), shipping rates, coupons (fixed value + minimum), gift card balances,
 *   trade tiers + trade prices, promotions with fixed amounts, the price-drop snapshots and money settings
 *   (gift wrap, free-shipping threshold, COD limit/fee, affiliate minimum payout, monthly revenue goal).
 * Prices and thresholds use the chosen rounding; costs and gift card balances (money owed) convert exactly.
 * Orders, payments, invoices, returns and commissions are history and keep their own currency.
 *
 * Flow: preview → owner types the new code → snapshot of every affected value (CurrencyConversion row, written in
 * the same transaction — this is the backup) → convert → audit. "Undo last conversion" writes the snapshot back.
 */

export type Change =
  | { kind: "row"; model: RowModel; key: Record<string, string>; field: string; label: string; from: number | null; to: number | null }
  | { kind: "setting"; key: string; field: string; label: string; from: number; to: number }
  | { kind: "promotion"; id: string; label: string; from: Prisma.JsonValue; to: Prisma.JsonValue };

type RowModel = "productVariant" | "shippingRate" | "coupon" | "giftCard" | "priceTier" | "tradePrice" | "priceSnapshot";

export type ConversionPlan = { from: Currency; to: Currency; rate: number; rounding: Rounding; changes: Change[] };

/** Money fields kept in Setting rows: [setting key, field, label, default when unset]. */
const MONEY_SETTINGS: [string, string, string, number][] = [
  ["store", "giftWrapFee", "Gift wrap fee", 9900],
  ["store", "freeShippingOver", "Free-shipping threshold", 250000],
  ["cod-risk", "codMaxOrderValue", "COD maximum order value", 2_500_000],
  ["cod-risk", "codFee", "COD fee", 0],
  ["affiliates", "minPayout", "Affiliate minimum payout", 50_000],
  ["dashboard", "monthlyTarget", "Monthly revenue goal", 0],
];

type Db = Prisma.TransactionClient | typeof db;

/** Builds the full list of changes from the current database. Pure apart from reads; used by preview and apply. */
export async function planConversion(client: Db, opts: { from: Currency; to: Currency; rate: number; rounding: Rounding }): Promise<ConversionPlan> {
  const { rate, rounding } = opts;
  const price = (v: number) => convertMinor(v, rate, rounding);
  const exact = (v: number) => convertMinor(v, rate, "exact");
  const changes: Change[] = [];
  const row = (model: RowModel, key: Record<string, string>, field: string, label: string, from: number | null, conv: (v: number) => number) => {
    if (from === null || from === undefined) return;
    changes.push({ kind: "row", model, key, field, label, from, to: conv(from) });
  };

  const variants = await client.productVariant.findMany({ select: { id: true, label: true, sku: true, price: true, compareAtPrice: true, costPrice: true, product: { select: { name: true } } }, orderBy: { sku: "asc" } });
  for (const v of variants) {
    const label = `${v.product.name} — ${v.label}`;
    row("productVariant", { id: v.id }, "price", label, v.price, price);
    row("productVariant", { id: v.id }, "compareAtPrice", `${label} (compare-at)`, v.compareAtPrice, price);
    row("productVariant", { id: v.id }, "costPrice", `${label} (cost)`, v.costPrice, exact);
  }
  for (const r of await client.shippingRate.findMany({ orderBy: { position: "asc" } })) {
    row("shippingRate", { id: r.id }, "price", `Shipping: ${r.name}`, r.price, price);
    row("shippingRate", { id: r.id }, "freeOver", `Shipping: ${r.name} (free over)`, r.freeOver, price);
  }
  for (const c of await client.coupon.findMany({ orderBy: { code: "asc" } })) {
    if (c.type === "FIXED") row("coupon", { id: c.id }, "value", `Coupon ${c.code}`, c.value, price);
    if (c.minSubtotal) row("coupon", { id: c.id }, "minSubtotal", `Coupon ${c.code} (minimum)`, c.minSubtotal, price);
  }
  for (const g of await client.giftCard.findMany({ orderBy: { createdAt: "asc" } })) {
    const label = `Gift card ••••${g.code.slice(-4)}`;
    row("giftCard", { id: g.id }, "initial", `${label} (initial)`, g.initial, exact);
    row("giftCard", { id: g.id }, "balance", `${label} (balance)`, g.balance, exact);
  }
  for (const t of await client.priceTier.findMany({ orderBy: { name: "asc" } })) {
    if (t.minOrderValue) row("priceTier", { id: t.id }, "minOrderValue", `Trade tier ${t.name} (minimum order)`, t.minOrderValue, price);
  }
  for (const tp of await client.tradePrice.findMany({ include: { tier: { select: { name: true } }, variant: { select: { sku: true } } } })) {
    row("tradePrice", { tierId: tp.tierId, variantId: tp.variantId }, "price", `Trade price ${tp.tier.name} · ${tp.variant.sku}`, tp.price, price);
  }
  for (const s of await client.priceSnapshot.findMany()) row("priceSnapshot", { productId: s.productId }, "price", `Price history ${s.productId}`, s.price, price);

  for (const p of await client.promotion.findMany({ orderBy: { createdAt: "asc" } })) {
    const to = convertPromotionConfig(p.type, p.config, price);
    if (to) changes.push({ kind: "promotion", id: p.id, label: `Promotion: ${p.name}`, from: p.config, to });
  }

  const settingRows = new Map((await client.setting.findMany({ where: { key: { in: [...new Set(MONEY_SETTINGS.map((s) => s[0]))] } } })).map((s) => [s.key, s.value as Record<string, unknown> | null]));
  for (const [key, field, label, fallback] of MONEY_SETTINGS) {
    const raw = settingRows.get(key)?.[field];
    const from = typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
    if (from) changes.push({ kind: "setting", key, field, label, from, to: price(from) });
  }
  return { from: opts.from, to: opts.to, rate, rounding, changes };
}

/** Fixed amounts inside a promotion's config, converted; null when it has none. */
export function convertPromotionConfig(type: string, config: Prisma.JsonValue, conv: (v: number) => number): Prisma.JsonValue | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const c = config as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? conv(v) : v);
  if (type === "FLASH_SALE" && c.kind === "FIXED") return { ...c, value: num(c.value) } as Prisma.JsonValue;
  if (type === "MULTI_BUY" || type === "FIXED_BUNDLE") return { ...c, price: num(c.price) } as Prisma.JsonValue;
  if (type === "TIERED" && Array.isArray(c.tiers)) return { ...c, tiers: c.tiers.map((t) => (t && typeof t === "object" ? { ...(t as object), threshold: num((t as { threshold?: unknown }).threshold) } : t)) } as Prisma.JsonValue;
  return null;
}

type Actor = { id: string; role: string; permissions: readonly string[] };
const ownerOnly = (actor: Actor) => {
  if (actor.role !== "OWNER") throw new RegionPermissionError("Only the owner can change the base currency.");
};

/** Current rate old base → new base, from the live table (manual pins win). */
async function currentRate(region: Region, to: Currency) {
  const fx = await buildFxTable({ ...region, enabledCurrencies: [...new Set([...region.enabledCurrencies, to])] });
  return fx.rates[to]?.rate ?? null;
}

export async function previewConversion(actor: Actor, input: { to: string; rate?: number; rounding?: Rounding }) {
  ownerOnly(actor);
  const region = await getRegion();
  const to = validateTarget(region, input.to);
  const rate = input.rate ?? (await currentRate(region, to));
  if (!rate || !(rate > 0)) throw new Error("No exchange rate for that currency yet — refresh rates or pin one first.");
  const rounding = input.rounding ?? roundingFor(region, to);
  if (!ROUNDINGS.includes(rounding)) throw new Error("Unknown rounding rule.");
  return planConversion(db, { from: region.baseCurrency, to, rate, rounding });
}

function validateTarget(region: Region, raw: string): Currency {
  const to = raw?.toUpperCase();
  if (!isCurrency(to)) throw new Error("Unsupported currency.");
  if (to === region.baseCurrency) throw new Error(`${to} is already the base currency.`);
  return to;
}

/** Writes one value (rows deleted since are skipped). */
async function writeChange(tx: Prisma.TransactionClient, c: Change, value: "from" | "to") {
  const v = c[value];
  if (c.kind === "row") {
    const data = { [c.field]: v };
    switch (c.model) {
      case "productVariant":
        return tx.productVariant.updateMany({ where: { id: c.key.id }, data });
      case "shippingRate":
        return tx.shippingRate.updateMany({ where: { id: c.key.id }, data });
      case "coupon":
        return tx.coupon.updateMany({ where: { id: c.key.id }, data });
      case "giftCard":
        return tx.giftCard.updateMany({ where: { id: c.key.id }, data });
      case "priceTier":
        return tx.priceTier.updateMany({ where: { id: c.key.id }, data });
      case "tradePrice":
        return tx.tradePrice.updateMany({ where: { tierId: c.key.tierId, variantId: c.key.variantId }, data });
      case "priceSnapshot":
        return tx.priceSnapshot.updateMany({ where: { productId: c.key.productId }, data });
    }
  }
  if (c.kind === "promotion") return tx.promotion.updateMany({ where: { id: c.id }, data: { config: v as Prisma.InputJsonValue } });
  if (c.kind === "setting") {
    const row = await tx.setting.findUnique({ where: { key: c.key } });
    const next = { ...((row?.value as object | null) ?? {}), [c.field]: v };
    return tx.setting.upsert({ where: { key: c.key }, update: { value: next }, create: { key: c.key, value: next } });
  }
}

/** Re-bases the exchange-rate rows: new → X = (old → X) / (old → new). Manual pins are re-based too. */
async function rebaseRates(tx: Prisma.TransactionClient, from: Currency, to: Currency, rate: number, now: Date) {
  const rows = await tx.exchangeRate.findMany({ where: { base: from } });
  const targets = new Map<string, { rate: number; manualRate: number | null }>();
  targets.set(from, { rate: 1 / rate, manualRate: null });
  for (const r of rows) {
    if (r.quote === to) continue;
    targets.set(r.quote, { rate: r.rate / rate, manualRate: r.manualRate != null ? r.manualRate / rate : null });
  }
  for (const [quote, v] of targets) {
    await tx.exchangeRate.upsert({
      where: { base_quote: { base: to, quote } },
      update: { rate: v.rate, manualRate: v.manualRate, source: v.manualRate != null ? "manual" : "auto", fetchedAt: now },
      create: { base: to, quote, rate: v.rate, manualRate: v.manualRate, source: v.manualRate != null ? "manual" : "auto", fetchedAt: now },
    });
  }
}

/**
 * Converts everything to the new base in one transaction. `confirm` must equal the new currency code.
 * Returns the plan that was applied (identical to what preview showed for the same rate and rounding).
 */
export async function applyConversion(actor: Actor, input: { to: string; confirm: string; rate?: number; rounding?: Rounding }, now = new Date()) {
  ownerOnly(actor);
  const region = await getRegion();
  const to = validateTarget(region, input.to);
  if ((input.confirm ?? "").trim().toUpperCase() !== to) throw new Error(`Type ${to} to confirm.`);
  const rate = input.rate ?? (await currentRate(region, to));
  if (!rate || !(rate > 0)) throw new Error("No exchange rate for that currency yet — refresh rates or pin one first.");
  const rounding = input.rounding ?? roundingFor(region, to);

  const result = await db.$transaction(
    async (tx) => {
      const plan = await planConversion(tx, { from: region.baseCurrency, to, rate, rounding });
      const regionRow = await tx.setting.findUnique({ where: { key: REGION_KEY } });
      // Backup first: the snapshot of every value we are about to change (+ the region row as it was).
      const conversion = await tx.currencyConversion.create({
        data: {
          fromCurrency: region.baseCurrency,
          toCurrency: to,
          rate,
          rounding,
          snapshot: { changes: plan.changes, region: regionRow?.value ?? null } as unknown as Prisma.InputJsonValue,
          summary: summarize(plan) as Prisma.InputJsonValue,
          actorId: actor.id,
        },
      });
      for (const c of plan.changes) await writeChange(tx, c, "to");
      await rebaseRates(tx, region.baseCurrency, to, rate, now);
      const nextRegion = regionSchema.parse({
        ...region,
        baseCurrency: to,
        displayCurrency: region.displayCurrency === region.baseCurrency ? to : region.displayCurrency,
        enabledCurrencies: [...new Set([to, ...region.enabledCurrencies])],
      });
      await tx.setting.upsert({ where: { key: REGION_KEY }, update: { value: nextRegion }, create: { key: REGION_KEY, value: nextRegion } });
      return { plan, conversionId: conversion.id };
    },
    { timeout: 180_000, maxWait: 20_000 },
  );
  await audit(actor.id, "currency.convert", "CurrencyConversion", result.conversionId, { from: region.baseCurrency, to, rate, rounding, ...summarize(result.plan) });
  invalidateRegion();
  await primeMoney();
  return result;
}

export function summarize(plan: ConversionPlan) {
  const count: Record<string, number> = {};
  for (const c of plan.changes) {
    const k = c.kind === "row" ? c.model : c.kind;
    count[k] = (count[k] ?? 0) + 1;
  }
  return { changes: plan.changes.length, byKind: count };
}

/** The latest conversion that can still be undone. */
export async function lastConversion() {
  return db.currencyConversion.findFirst({ where: { undoneAt: null }, orderBy: { createdAt: "desc" } });
}

/** Writes the snapshot of the last conversion back (prices, settings, region). Exchange-rate rows are left as they are. */
export async function undoLastConversion(actor: Actor) {
  ownerOnly(actor);
  const last = await lastConversion();
  if (!last) throw new Error("There is no conversion to undo.");
  const region = await getRegion();
  if (region.baseCurrency !== last.toCurrency) throw new Error(`The base currency is ${region.baseCurrency}, not ${last.toCurrency} — undo the later change first.`);
  const snap = last.snapshot as unknown as { changes: Change[]; region: Prisma.JsonValue | null };
  let editedSince = 0;
  await db.$transaction(
    async (tx) => {
      for (const c of snap.changes) {
        if (c.kind === "row" && (await currentRowValue(tx, c)) !== c.to) editedSince++;
        await writeChange(tx, c, "from");
      }
      if (snap.region) await tx.setting.upsert({ where: { key: REGION_KEY }, update: { value: snap.region as Prisma.InputJsonValue }, create: { key: REGION_KEY, value: snap.region as Prisma.InputJsonValue } });
      else await tx.setting.deleteMany({ where: { key: REGION_KEY } });
      await tx.currencyConversion.update({ where: { id: last.id }, data: { undoneAt: new Date(), undoneById: actor.id } });
    },
    { timeout: 180_000, maxWait: 20_000 },
  );
  await audit(actor.id, "currency.undo", "CurrencyConversion", last.id, { from: last.toCurrency, to: last.fromCurrency, restored: snap.changes.length, editedSince });
  invalidateRegion();
  await primeMoney();
  return { restored: snap.changes.length, editedSince, base: last.fromCurrency };
}

async function currentRowValue(tx: Prisma.TransactionClient, c: Extract<Change, { kind: "row" }>): Promise<number | null> {
  const pick = (r: Record<string, unknown> | null) => (r ? ((r[c.field] as number | null) ?? null) : null);
  switch (c.model) {
    case "productVariant":
      return pick(await tx.productVariant.findUnique({ where: { id: c.key.id } }));
    case "shippingRate":
      return pick(await tx.shippingRate.findUnique({ where: { id: c.key.id } }));
    case "coupon":
      return pick(await tx.coupon.findUnique({ where: { id: c.key.id } }));
    case "giftCard":
      return pick(await tx.giftCard.findUnique({ where: { id: c.key.id } }));
    case "priceTier":
      return pick(await tx.priceTier.findUnique({ where: { id: c.key.id } }));
    case "tradePrice":
      return pick(await tx.tradePrice.findUnique({ where: { tierId_variantId: { tierId: c.key.tierId, variantId: c.key.variantId } } }));
    case "priceSnapshot":
      return pick(await tx.priceSnapshot.findUnique({ where: { productId: c.key.productId } }));
  }
}
