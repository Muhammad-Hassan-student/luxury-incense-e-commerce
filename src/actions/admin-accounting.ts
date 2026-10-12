"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { accountingSettingsSchema, getAccountingSettings, saveAccountingSettings, setupProblems } from "@/server/accounting/settings";
import { syncDocuments } from "@/server/accounting/documents";
import { ReconciliationError, fetchSettlements, importSettlement, parseSettlementCsv, recordCodRemittance, rematchSettlement } from "@/server/accounting/reconciliation";
import { cuid, done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";

const revalidateAccounting = () => revalidatePath("/admin/accounting", "layout");

async function guarded(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ReconciliationError) return fail(e.message);
    if (e instanceof z.ZodError) return fail(zodMessage(e));
    const msg = (e as { error?: { description?: string }; message?: string }).error?.description ?? (e as Error).message;
    // Provider API errors (bad key, rate limit) are safe to show to staff.
    if (msg && /stripe|razorpay|api|key|auth|rate/i.test(msg)) return fail(`Provider error: ${msg}`);
    throw e;
  }
}

// ─────────────────────────────── Settings & documents ───────────────────────────────

export async function saveAccountingSettingsAction(input: z.input<typeof accountingSettingsSchema>): Promise<ActionResult> {
  const user = await requirePermission("accounting.manage");
  const parsed = accountingSettingsSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const before = await getAccountingSettings();
  const saved = await saveAccountingSettings(input);
  const changed = Object.keys(saved).filter((k) => JSON.stringify(saved[k as keyof typeof saved]) !== JSON.stringify(before[k as keyof typeof before]));
  await audit(user.id, "accounting.settings", "Setting", "accounting", { changed, enabled: saved.enabled, gstin: saved.gstin, stateCode: saved.stateCode, startsOn: saved.startsOn });
  revalidateAccounting();
  const missing = setupProblems(saved);
  return done(saved.enabled && missing.length ? `Saved — still needed before documents are issued: ${missing.join(", ")}` : "Accounting settings saved");
}

export async function syncAccountingDocuments(): Promise<ActionResult> {
  const user = await requirePermission("accounting.manage");
  const r = await syncDocuments();
  if ("skipped" in r && r.skipped) return fail(`Nothing issued: ${r.skipped}. Complete the GST settings first.`);
  await audit(user.id, "accounting.sync", "TaxDocument", null, { invoices: r.invoices, creditNotes: r.creditNotes });
  revalidateAccounting();
  return done(`${r.invoices} invoice${r.invoices === 1 ? "" : "s"} and ${r.creditNotes} credit note${r.creditNotes === 1 ? "" : "s"} issued`);
}

const hsnSchema = z.object({
  kind: z.enum(["category", "product"]),
  id: cuid,
  hsnCode: z
    .string()
    .trim()
    .regex(/^(\d{4}|\d{6}|\d{8})?$/, "HSN must be 4, 6 or 8 digits"),
});

export async function saveHsnCode(input: z.input<typeof hsnSchema>): Promise<ActionResult> {
  const user = await requirePermission("accounting.manage");
  const parsed = hsnSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { kind, id, hsnCode } = parsed.data;
  const value = hsnCode || null;
  if (kind === "category") {
    const c = await db.category.update({ where: { id }, data: { hsnCode: value }, select: { name: true } }).catch(() => null);
    if (!c) return fail("Category not found.");
    await audit(user.id, "accounting.hsn", "Category", id, { name: c.name, hsnCode: value });
  } else {
    const p = await db.product.update({ where: { id }, data: { hsnCode: value }, select: { name: true } }).catch(() => null);
    if (!p) return fail("Product not found.");
    await audit(user.id, "accounting.hsn", "Product", id, { name: p.name, hsnCode: value });
  }
  revalidatePath("/admin/accounting/hsn");
  return done(value ? `HSN ${value} saved` : kind === "product" ? "Using the category's HSN" : "HSN cleared");
}

// ─────────────────────────────── Reconciliation ───────────────────────────────

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const rangeSchema = z
  .object({ provider: z.enum(["STRIPE", "RAZORPAY"]), from: day, to: day })
  .refine((v) => v.from <= v.to, { message: "From must be before To", path: ["to"] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86400_000 <= 62, { message: "At most 62 days at a time", path: ["to"] });

export async function fetchPayouts(input: z.input<typeof rangeSchema>): Promise<ActionResult> {
  const user = await requirePermission("accounting.manage");
  const parsed = rangeSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { provider, from, to } = parsed.data;
  return guarded(async () => {
    const r = await fetchSettlements(provider, new Date(`${from}T00:00:00+05:30`), new Date(`${to}T23:59:59+05:30`), user.id);
    await audit(user.id, "reconciliation.fetch", "Settlement", null, { provider, from, to, live: r.live, imported: r.imported, ids: r.settlements.map((s) => s.externalId) });
    revalidateAccounting();
    if (!r.imported) return done(r.live ? "No payouts in that period." : "No captured payments in that period to build a test settlement from.");
    return done(`${r.imported} ${provider === "STRIPE" ? "payout" : "settlement"}${r.imported === 1 ? "" : "s"} imported${r.live ? "" : " (test mode — no keys in Integrations)"}`, r.settlements[0]?.id);
  });
}

const csvSchema = z.object({
  provider: z.enum(["STRIPE", "RAZORPAY"]),
  csv: z.string().min(1, "Choose a file").max(900_000, "File too large (max ~900 KB) — split it by month"),
  fallbackId: z.string().trim().max(120).optional(),
});

export async function importPayoutCsv(input: z.input<typeof csvSchema>): Promise<ActionResult> {
  const user = await requirePermission("accounting.manage");
  const parsed = csvSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { provider, csv, fallbackId } = parsed.data;
  return guarded(async () => {
    const batch = parseSettlementCsv(provider, csv, { fallbackId: fallbackId || undefined });
    const saved = [];
    for (const s of batch) saved.push(await importSettlement(s, user.id));
    await audit(user.id, "reconciliation.import_csv", "Settlement", null, { provider, settlements: saved.map((s) => ({ id: s.externalId, lines: s.matched + s.unmatched + s.mismatched, status: s.status })) });
    revalidateAccounting();
    return done(`${saved.length} settlement${saved.length === 1 ? "" : "s"} imported`, saved[0]?.id);
  });
}

const codSchema = z.object({
  reference: z.string().trim().min(3, "Enter the remittance reference / UTR").max(120),
  courier: z.string().trim().max(60),
  date: day,
  amount: z.number().min(0).max(100_000_000),
  refs: z.string().trim().min(1, "List the AWBs or order numbers").max(50_000),
});

export async function saveCodRemittance(input: z.input<typeof codSchema>): Promise<ActionResult> {
  const user = await requirePermission("accounting.manage");
  const parsed = codSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const v = parsed.data;
  return guarded(async () => {
    const s = await recordCodRemittance({ reference: v.reference, courier: v.courier, date: new Date(`${v.date}T12:00:00+05:30`), amount: Math.round(v.amount * 100), refs: v.refs }, user.id);
    await audit(user.id, "reconciliation.cod_remittance", "Settlement", s.id, { reference: v.reference, courier: v.courier, amount: s.deposited, expected: s.expected, status: s.status, lines: s.matched + s.unmatched + s.mismatched });
    revalidateAccounting();
    return done(s.status === "MATCHED" ? `Remittance ${v.reference} recorded — matches` : `Remittance ${v.reference} recorded — needs review`, s.id);
  });
}

const idSchema = z.object({ id: cuid });

export async function rematchPayout(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const user = await requirePermission("accounting.manage");
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  return guarded(async () => {
    const s = await rematchSettlement(parsed.data.id);
    await audit(user.id, "reconciliation.rematch", "Settlement", s.id, { status: s.status, matched: s.matched, unmatched: s.unmatched, mismatched: s.mismatched });
    revalidateAccounting();
    return done(`Re-matched · ${s.matched} matched, ${s.unmatched} unmatched, ${s.mismatched} mismatched`);
  });
}

export async function deletePayout(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const user = await requirePermission("accounting.manage");
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const s = await db.settlement.findUnique({ where: { id: parsed.data.id }, select: { provider: true, externalId: true, source: true, deposited: true } });
  if (!s) return fail("Settlement not found.");
  await db.settlement.delete({ where: { id: parsed.data.id } });
  await audit(user.id, "reconciliation.delete", "Settlement", parsed.data.id, s);
  revalidateAccounting();
  return done(`${s.externalId} removed`);
}
