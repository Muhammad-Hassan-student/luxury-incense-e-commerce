import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { adjustStock } from "./inventory";

type Tx = Prisma.TransactionClient;

// ─────────────────────────────── CSV primitives ───────────────────────────────

/** Quote a cell; text that a spreadsheet would treat as a formula is prefixed with ' (CSV injection guard). */
export function csvCell(v: string | number | null | undefined, opts: { text?: boolean } = {}) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (opts.text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: string[][]) {
  return [header.join(","), ...rows.map((r) => r.join(","))].join("\r\n") + "\r\n";
}

/** RFC 4180 parser: quoted fields, escaped quotes, CRLF/LF, BOM. Returns rows of raw cells with 1-based line numbers. */
export function parseCsv(text: string): { line: number; cells: string[] }[] {
  const src = text.replace(/^﻿/, "");
  const out: { line: number; cells: string[] }[] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (c === "\n") line++;
        cell += c;
      }
      continue;
    }
    if (c === '"' && cell === "") quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      out.push({ line: rowLine, cells: row });
      row = [];
      cell = "";
      line++;
      rowLine = line;
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    out.push({ line: rowLine, cells: row });
  }
  return out.filter((r) => r.cells.some((c) => c.trim() !== ""));
}

// ─────────────────────────────── Export ───────────────────────────────

export const EXPORT_COLUMNS = ["sku", "product", "variant", "barcode", "stock", "reserved", "available", "reorderPoint", "reorderQty", "costPrice", "supplier"];

export async function exportInventoryCsv() {
  const variants = await db.productVariant.findMany({
    orderBy: [{ product: { name: "asc" } }, { position: "asc" }],
    select: {
      sku: true,
      label: true,
      barcode: true,
      stock: true,
      reserved: true,
      reorderPoint: true,
      reorderQty: true,
      costPrice: true,
      product: { select: { name: true } },
      supplier: { select: { name: true } },
    },
  });
  const rows = variants.map((v) => [
    csvCell(v.sku, { text: true }),
    csvCell(v.product.name, { text: true }),
    csvCell(v.label, { text: true }),
    csvCell(v.barcode, { text: true }),
    csvCell(v.stock),
    csvCell(v.reserved),
    csvCell(v.stock - v.reserved),
    csvCell(v.reorderPoint),
    csvCell(v.reorderQty),
    csvCell(v.costPrice === null ? null : (v.costPrice / 100).toFixed(2)),
    csvCell(v.supplier?.name, { text: true }),
  ]);
  return toCsv(EXPORT_COLUMNS, rows);
}

// ─────────────────────────────── Import ───────────────────────────────

export const IMPORT_FIELDS = ["stock", "costPrice", "reorderPoint", "reorderQty", "barcode"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export type ImportValue = number | string | null;
export type ImportChange = { field: ImportField; from: ImportValue; to: ImportValue };
export type ImportRow = { line: number; sku: string; variantId: string; product: string; changes: ImportChange[] };
export type ImportError = { line: number; sku?: string; message: string };
export type ImportPlan = { columns: ImportField[]; rows: ImportRow[]; unchanged: number; total: number; errors: ImportError[] };

export class ImportRejected extends Error {
  constructor(public plan: ImportPlan) {
    super(`${plan.errors.length} error${plan.errors.length === 1 ? "" : "s"} in the file`);
  }
}

const CLEAR = "-";
const intRe = /^\d+$/;
const moneyRe = /^\d+(\.\d{1,2})?$/;
const barcodeRe = /^[A-Za-z0-9._-]{3,64}$/;

/**
 * Validates a CSV against current data and computes per-variant diffs. Nothing is written.
 * Columns: `sku` (required) plus any of stock / costPrice (rupees) / reorderPoint / reorderQty / barcode; others are ignored.
 * Empty cell = leave unchanged; "-" clears costPrice / reorderPoint / reorderQty / barcode.
 */
export async function planImport(text: string, client: Tx | typeof db = db): Promise<ImportPlan> {
  const errors: ImportError[] = [];
  const empty: ImportPlan = { columns: [], rows: [], unchanged: 0, total: 0, errors };
  if (text.length > MAX_IMPORT_BYTES) return { ...empty, errors: [{ line: 0, message: "File is larger than 2 MB." }] };
  const parsed = parseCsv(text);
  if (!parsed.length) return { ...empty, errors: [{ line: 0, message: "The file is empty." }] };

  const header = parsed[0].cells.map((h) => h.trim().replace(/^'/, "").toLowerCase());
  const skuIdx = header.indexOf("sku");
  if (skuIdx < 0) return { ...empty, errors: [{ line: parsed[0].line, message: "Missing a “sku” column." }] };
  const colIdx = new Map<ImportField, number>();
  for (const f of IMPORT_FIELDS) {
    const i = header.indexOf(f.toLowerCase());
    if (i >= 0) colIdx.set(f, i);
  }
  const columns = [...colIdx.keys()];
  if (!columns.length) return { ...empty, errors: [{ line: parsed[0].line, message: `Add at least one of: ${IMPORT_FIELDS.join(", ")}.` }] };
  const body = parsed.slice(1);
  if (body.length > MAX_IMPORT_ROWS) return { ...empty, columns, errors: [{ line: 0, message: `At most ${MAX_IMPORT_ROWS} rows per import.` }] };

  const skus = body.map((r) => (r.cells[skuIdx] ?? "").trim().replace(/^'/, "")).filter(Boolean);
  const variants = await client.productVariant.findMany({
    where: { sku: { in: skus } },
    select: { id: true, sku: true, stock: true, reserved: true, costPrice: true, reorderPoint: true, reorderQty: true, barcode: true, product: { select: { name: true } } },
  });
  const bySku = new Map(variants.map((v) => [v.sku, v]));
  const fileBarcodes = body.map((r) => (colIdx.has("barcode") ? (r.cells[colIdx.get("barcode")!] ?? "").trim().replace(/^'/, "") : "")).filter((b) => b && b !== CLEAR);
  const barcodeOwners = fileBarcodes.length
    ? new Map((await client.productVariant.findMany({ where: { barcode: { in: fileBarcodes } }, select: { id: true, barcode: true } })).map((v) => [v.barcode!, v.id]))
    : new Map<string, string>();

  const seenSku = new Map<string, number>();
  const seenBarcode = new Map<string, number>();
  const rows: ImportRow[] = [];
  let unchanged = 0;
  // Barcodes being moved away from their current owner within this file.
  const releasing = new Set<string>();

  type Pending = { line: number; v: (typeof variants)[number]; changes: ImportChange[] };
  const pending: Pending[] = [];

  for (const r of body) {
    const cell = (f: ImportField) => (r.cells[colIdx.get(f)!] ?? "").trim().replace(/^'/, "");
    const sku = (r.cells[skuIdx] ?? "").trim().replace(/^'/, "");
    if (!sku) {
      errors.push({ line: r.line, message: "Missing SKU." });
      continue;
    }
    if (seenSku.has(sku)) {
      errors.push({ line: r.line, sku, message: `Duplicate SKU (also on line ${seenSku.get(sku)}).` });
      continue;
    }
    seenSku.set(sku, r.line);
    const v = bySku.get(sku);
    if (!v) {
      errors.push({ line: r.line, sku, message: "Unknown SKU (not created)." });
      continue;
    }
    const changes: ImportChange[] = [];
    const rowErrors: string[] = [];

    for (const f of columns) {
      const raw = cell(f);
      if (raw === "") continue;
      if (f === "stock") {
        if (!intRe.test(raw) || Number(raw) > 1_000_000) rowErrors.push("stock must be a whole number ≥ 0");
        else if (Number(raw) < v.reserved) rowErrors.push(`stock can't be below the ${v.reserved} reserved for pending orders`);
        else if (Number(raw) !== v.stock) changes.push({ field: f, from: v.stock, to: Number(raw) });
      } else if (f === "costPrice") {
        if (raw === CLEAR) {
          if (v.costPrice !== null) changes.push({ field: f, from: v.costPrice, to: null });
        } else if (!moneyRe.test(raw) || Number(raw) > 10_000_000) rowErrors.push("costPrice must be rupees ≥ 0 with up to 2 decimals");
        else {
          const minor = Math.round(Number(raw) * 100);
          if (minor !== v.costPrice) changes.push({ field: f, from: v.costPrice, to: minor });
        }
      } else if (f === "reorderPoint" || f === "reorderQty") {
        if (raw === CLEAR) {
          if (v[f] !== null) changes.push({ field: f, from: v[f], to: null });
        } else if (!intRe.test(raw) || Number(raw) > 1_000_000) rowErrors.push(`${f} must be a whole number ≥ 0`);
        else if (f === "reorderQty" && Number(raw) === 0) rowErrors.push("reorderQty must be at least 1 (or - to clear)");
        else if (Number(raw) !== v[f]) changes.push({ field: f, from: v[f], to: Number(raw) });
      } else if (f === "barcode") {
        if (raw === CLEAR) {
          if (v.barcode !== null) changes.push({ field: f, from: v.barcode, to: null });
        } else if (!barcodeRe.test(raw)) rowErrors.push("barcode must be 3–64 letters, digits, dot, dash or underscore");
        else if (seenBarcode.has(raw)) rowErrors.push(`barcode ${raw} is also used on line ${seenBarcode.get(raw)}`);
        else {
          seenBarcode.set(raw, r.line);
          if (raw !== v.barcode) changes.push({ field: f, from: v.barcode, to: raw });
        }
      }
    }
    if (rowErrors.length) {
      errors.push({ line: r.line, sku, message: rowErrors.join("; ") });
      continue;
    }
    const bc = changes.find((c) => c.field === "barcode");
    if (bc && v.barcode) releasing.add(v.barcode);
    pending.push({ line: r.line, v, changes });
  }

  // A barcode may only move to a new variant if its current owner gives it up in the same file.
  for (const p of pending) {
    const bc = p.changes.find((c) => c.field === "barcode");
    if (bc && typeof bc.to === "string") {
      const owner = barcodeOwners.get(bc.to);
      if (owner && owner !== p.v.id && !releasing.has(bc.to)) {
        errors.push({ line: p.line, sku: p.v.sku, message: `barcode ${bc.to} already belongs to another variant` });
        continue;
      }
    }
    if (p.changes.length) rows.push({ line: p.line, sku: p.v.sku, variantId: p.v.id, product: p.v.product.name, changes: p.changes });
    else unchanged++;
  }
  errors.sort((a, b) => a.line - b.line);
  return { columns, rows, unchanged, total: body.length, errors };
}

/**
 * Re-validates against fresh data and applies all changes in one transaction (all or nothing).
 * Stock moves go through adjustStock (reason ADJUST) as the delta to the target figure.
 */
export async function applyImport(text: string, actorId: string) {
  return db.$transaction(
    async (tx) => {
      // Lock the rows the file touches, then re-plan so stock targets are computed against settled values.
      const first = await planImport(text, tx);
      if (first.errors.length) throw new ImportRejected(first);
      const ids = first.rows.map((r) => r.variantId);
      if (ids.length) await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id = ANY(${ids}) FOR UPDATE`;
      const fresh = await planImport(text, tx);
      if (fresh.errors.length) throw new ImportRejected(fresh);

      // Free barcodes first so swaps between variants don't trip the unique index.
      const movingBarcodes = fresh.rows.filter((r) => r.changes.some((c) => c.field === "barcode")).map((r) => r.variantId);
      if (movingBarcodes.length) await tx.productVariant.updateMany({ where: { id: { in: movingBarcodes } }, data: { barcode: null } });

      let stockMoves = 0;
      for (const r of fresh.rows) {
        const data: Prisma.ProductVariantUpdateInput = {};
        for (const c of r.changes) {
          if (c.field === "stock") {
            const delta = (c.to as number) - (c.from as number);
            if (delta) {
              await adjustStock(tx, r.variantId, delta, "ADJUST", actorId);
              stockMoves++;
            }
          } else if (c.field === "barcode") data.barcode = c.to as string | null;
          else data[c.field] = c.to as number | null;
        }
        if (Object.keys(data).length) await tx.productVariant.update({ where: { id: r.variantId }, data });
      }
      return { plan: fresh, updated: fresh.rows.length, stockMoves };
    },
    { timeout: 60_000 },
  );
}
