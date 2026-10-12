import "server-only";
import { z } from "zod";
import { db } from "../db";
import { isValidGstin, normalizeGstin } from "@/lib/gst";

/** Accounting settings, stored in Setting "accounting". GST documents are only issued once `enabled` is on. */
export const accountingSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    legalName: z.string().trim().max(100).default(""),
    gstin: z
      .string()
      .trim()
      .transform(normalizeGstin)
      .refine((v) => v === "" || isValidGstin(v), "Not a valid GSTIN (check digit)")
      .default(""),
    /** GST state code of the registered place of business, e.g. "07" (from the GSTIN when blank) */
    stateCode: z.string().trim().regex(/^(\d{2})?$/, "Two-digit state code").default(""),
    address: z.string().trim().max(200).default(""),
    city: z.string().trim().max(60).default(""),
    pincode: z.string().trim().regex(/^(\d{6})?$/, "Six digits").default(""),
    email: z.string().trim().max(120).default(""),
    phone: z.string().trim().max(20).default(""),
    invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{0,3}$/, "1–4 letters/digits").default("MO"),
    creditNotePrefix: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{0,3}$/, "1–4 letters/digits").default("CN"),
    /** Orders confirmed before this date keep their legacy INV- numbers (no GST document is issued for them). */
    startsOn: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(""),
    /** Default HSN when neither the product nor its category has one */
    defaultHsn: z.string().trim().regex(/^(\d{4}|\d{6}|\d{8})?$/, "4, 6 or 8 digits").default(""),
    // Tally ledger names (must exist in Tally, or be created by the import)
    ledgerSales: z.string().trim().max(60).default("Sales - GST"),
    ledgerCgst: z.string().trim().max(60).default("Output CGST"),
    ledgerSgst: z.string().trim().max(60).default("Output SGST"),
    ledgerIgst: z.string().trim().max(60).default("Output IGST"),
    ledgerShipping: z.string().trim().max(60).default("Shipping Charges"),
    ledgerGiftCards: z.string().trim().max(60).default("Gift Card Liability"),
    ledgerCustomers: z.string().trim().max(60).default("Online Customers"),
    tallyCompany: z.string().trim().max(80).default(""),
    /** Flag a reconciliation line when |provider − expected| exceeds this many paise */
    tolerance: z.number().int().min(0).max(100_00).default(100),
  })
  .transform((v) => ({ ...v, stateCode: v.stateCode || (v.gstin ? v.gstin.slice(0, 2) : "") }));

export type AccountingSettings = z.output<typeof accountingSettingsSchema>;
export type AccountingSettingsInput = z.input<typeof accountingSettingsSchema>;

export const ACCOUNTING_KEY = "accounting";

export async function getAccountingSettings(): Promise<AccountingSettings> {
  const row = await db.setting.findUnique({ where: { key: ACCOUNTING_KEY } });
  const parsed = accountingSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : accountingSettingsSchema.parse({});
}

export async function saveAccountingSettings(input: AccountingSettingsInput) {
  const value = accountingSettingsSchema.parse(input);
  await db.setting.upsert({ where: { key: ACCOUNTING_KEY }, create: { key: ACCOUNTING_KEY, value }, update: { value } });
  return value;
}

/** What still blocks issuing GST documents (empty = ready). */
export function setupProblems(s: AccountingSettings) {
  const out: string[] = [];
  if (!s.legalName) out.push("Legal name");
  if (!s.gstin) out.push("GSTIN");
  if (!s.stateCode) out.push("State");
  if (!s.pincode) out.push("Pincode");
  if (!s.startsOn) out.push("Start date");
  return out;
}
