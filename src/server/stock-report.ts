import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { BUILT_IN_PERMISSIONS, expand, type Permission } from "@/lib/permissions";
import { LowStockEmail } from "@/emails/low-stock";
import { db } from "./db";
import { sendEmail } from "./email";
import { onOrderByVariant } from "./purchasing";
import { getSettings } from "./settings";

// ─────────────────────────────── KPIs ───────────────────────────────

export type StockKpis = {
  variants: number;
  units: number;
  costValue: number;
  missingCost: number;
  retailValue: number;
  belowReorder: number;
  outOfStock: number;
};

/** Headline stock figures (gift cards excluded: they're not physical stock). */
export async function stockKpis(threshold?: number): Promise<StockKpis> {
  const t = threshold ?? (await getSettings()).lowStockThreshold;
  const [r] = await db.$queryRaw<
    { variants: bigint; units: bigint | null; cost: bigint | null; missing: bigint; retail: bigint | null; low: bigint; out: bigint }[]
  >`
    SELECT COUNT(*) AS variants,
           SUM(v.stock) AS units,
           SUM(v.stock::bigint * v."costPrice") FILTER (WHERE v."costPrice" IS NOT NULL) AS cost,
           COUNT(*) FILTER (WHERE v."costPrice" IS NULL) AS missing,
           SUM(v.stock::bigint * v.price) AS retail,
           COUNT(*) FILTER (WHERE v.stock - v.reserved <= COALESCE(v."reorderPoint", ${t})) AS low,
           COUNT(*) FILTER (WHERE v.stock - v.reserved <= 0) AS out
    FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId"
    WHERE p."isGiftCard" = false`;
  return {
    variants: Number(r?.variants ?? 0),
    units: Number(r?.units ?? 0),
    costValue: Number(r?.cost ?? 0),
    missingCost: Number(r?.missing ?? 0),
    retailValue: Number(r?.retail ?? 0),
    belowReorder: Number(r?.low ?? 0),
    outOfStock: Number(r?.out ?? 0),
  };
}

// ─────────────────────────────── Stock table ───────────────────────────────

export const STOCK_FILTERS = ["all", "low", "out", "nocost"] as const;
export type StockFilter = (typeof STOCK_FILTERS)[number];

export type StockRow = {
  id: string;
  sku: string;
  label: string;
  barcode: string | null;
  price: number;
  stock: number;
  reserved: number;
  available: number;
  reorderPoint: number;
  reorderPointIsDefault: boolean;
  reorderQty: number | null;
  costPrice: number | null;
  onOrder: number;
  low: boolean;
  out: boolean;
  isGiftCard: boolean;
  product: { id: string; name: string; isActive: boolean };
  supplier: { id: string; name: string } | null;
};

export async function stockRows(opts: { q?: string; filter?: StockFilter; supplierId?: string; threshold?: number }): Promise<StockRow[]> {
  const threshold = opts.threshold ?? (await getSettings()).lowStockThreshold;
  const and: Prisma.ProductVariantWhereInput[] = [];
  if (opts.q) {
    const contains = { contains: opts.q, mode: "insensitive" as const };
    and.push({ OR: [{ sku: contains }, { label: contains }, { barcode: contains }, { product: { name: contains } }] });
  }
  if (opts.supplierId === "none") and.push({ supplierId: null });
  else if (opts.supplierId) and.push({ supplierId: opts.supplierId });
  if (opts.filter === "nocost") and.push({ costPrice: null });

  const variants = await db.productVariant.findMany({
    where: and.length ? { AND: and } : undefined,
    orderBy: [{ product: { name: "asc" } }, { position: "asc" }],
    select: {
      id: true,
      sku: true,
      label: true,
      barcode: true,
      price: true,
      stock: true,
      reserved: true,
      reorderPoint: true,
      reorderQty: true,
      costPrice: true,
      product: { select: { id: true, name: true, isActive: true, isGiftCard: true } },
      supplier: { select: { id: true, name: true } },
    },
  });
  const onOrder = await onOrderByVariant(db, variants.map((v) => v.id));
  const rows = variants.map((v): StockRow => {
    const available = v.stock - v.reserved;
    const reorderPoint = v.reorderPoint ?? threshold;
    return {
      id: v.id,
      sku: v.sku,
      label: v.label,
      barcode: v.barcode,
      price: v.price,
      stock: v.stock,
      reserved: v.reserved,
      available,
      reorderPoint,
      reorderPointIsDefault: v.reorderPoint === null,
      reorderQty: v.reorderQty,
      costPrice: v.costPrice,
      onOrder: onOrder.get(v.id) ?? 0,
      low: available <= reorderPoint,
      out: available <= 0,
      isGiftCard: v.product.isGiftCard,
      product: { id: v.product.id, name: v.product.name, isActive: v.product.isActive },
      supplier: v.supplier,
    };
  });
  if (opts.filter === "low") return rows.filter((r) => r.low && !r.isGiftCard);
  if (opts.filter === "out") return rows.filter((r) => r.out && !r.isGiftCard);
  return rows;
}

// ─────────────────────────────── Low-stock digest ───────────────────────────────

export type LowStockItem = { sku: string; product: string; label: string; available: number; reorderPoint: number; onOrder: number; supplier: string | null };

export async function lowStockItems(): Promise<LowStockItem[]> {
  const rows = await stockRows({ filter: "low" });
  return rows
    .filter((r) => r.product.isActive)
    .sort((a, b) => a.available - a.reorderPoint - (b.available - b.reorderPoint))
    .map((r) => ({ sku: r.sku, product: r.product.name, label: r.label, available: r.available, reorderPoint: r.reorderPoint, onOrder: r.onOrder, supplier: r.supplier?.name ?? null }));
}

/** Staff whose effective permissions include `perm` (custom role → its permissions; else built-in level defaults). */
export async function staffWithPermission(perm: Permission) {
  const users = await db.user.findMany({
    where: { role: { not: "CUSTOMER" } },
    select: { email: true, role: true, staffRole: { select: { permissions: true } } },
  });
  return users
    .filter((u) => {
      if (u.role === "OWNER") return true;
      if (u.role === "CUSTOMER") return false;
      return expand(u.staffRole ? u.staffRole.permissions : BUILT_IN_PERMISSIONS[u.role]).has(perm);
    })
    .map((u) => u.email);
}

export const LOW_STOCK_DIGEST_KEY = "lowStockDigest";

/** Store-local calendar day (YYYY-MM-DD). */
export const storeDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/**
 * Atomically claims today's digest slot in the Setting table; false when it was already sent today.
 * Exported for tests.
 */
export async function claimDigestDay(day: string) {
  const value = JSON.stringify({ lastSentOn: day, at: new Date().toISOString() });
  const rows = await db.$queryRaw<{ key: string }[]>`
    INSERT INTO "Setting" (key, value) VALUES (${LOW_STOCK_DIGEST_KEY}, ${value}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    WHERE "Setting".value->>'lastSentOn' IS DISTINCT FROM ${day}
    RETURNING key`;
  return rows.length > 0;
}

/** Emails the low-stock digest to staff with inventory.view, at most once per store day. */
export async function sendLowStockDigest(now = new Date()) {
  const day = storeDay(now);
  const last = await db.setting.findUnique({ where: { key: LOW_STOCK_DIGEST_KEY } });
  const lastDay = last?.value && typeof last.value === "object" && !Array.isArray(last.value) ? (last.value as { lastSentOn?: unknown }).lastSentOn : undefined;
  if (lastDay === day) return { skipped: "already sent today", day };

  const items = await lowStockItems();
  if (!items.length) return { skipped: "nothing low", day, items: 0 };
  const recipients = await staffWithPermission("inventory.view");
  if (!recipients.length) return { skipped: "no recipients", day, items: items.length };
  if (!(await claimDigestDay(day))) return { skipped: "already sent today", day };

  const subject = `Low stock: ${items.length} variant${items.length === 1 ? "" : "s"} at or below reorder point`;
  for (const to of recipients) {
    await sendEmail({ to, subject, react: LowStockEmail({ items, day }), devLog: items.map((i) => `${i.sku} ${i.available}/${i.reorderPoint} (+${i.onOrder} on order)`).join(", ") });
  }
  return { sent: recipients.length, items: items.length, day };
}
