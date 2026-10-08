// Zod schemas for every trade input (buyer and staff). Server actions parse with these before touching the database.
import { z } from "zod";
import { BUSINESS_TYPE_VALUES, MAX_LINE_QTY, MAX_ORDER_LINES, TERMS, VOLUME_BANDS, taxIdRequired } from "@/components/trade/trade-rules";

const id = z.string().trim().min(1).max(64);
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((s) => (s ? s : null));

export const addressSchema = z.object({
  fullName: z.string().trim().min(2, "Enter a name for deliveries").max(100),
  phone: z.string().trim().regex(/^[+\d][\d\s-]{6,18}$/, "Enter a valid phone number"),
  line1: z.string().trim().min(3, "Enter the street address").max(200),
  line2: text(200).optional().transform((s) => s || undefined),
  city: z.string().trim().min(2, "Enter a city").max(100),
  state: z.string().trim().min(2, "Enter a state or region").max(100),
  postalCode: z.string().trim().min(3, "Enter a postal code").max(12),
  country: z.string().trim().toUpperCase().length(2, "Use a two-letter country code"),
});
export type TradeAddressInput = z.input<typeof addressSchema>;

/** GSTIN (15), NTN (7–8 digits, optional suffix) or VAT numbers: letters, digits and a few separators. */
const taxIdPattern = /^[A-Za-z0-9][A-Za-z0-9 ./-]{4,23}$/;

export const applicationSchema = z
  .object({
    businessName: z.string().trim().min(2, "Enter your business name").max(120),
    businessType: z.enum(BUSINESS_TYPE_VALUES, "Choose what kind of business you are"),
    contactName: z.string().trim().min(2, "Enter a contact name").max(100),
    phone: z.string().trim().regex(/^[+\d][\d\s-]{6,18}$/, "Enter a valid phone number"),
    taxId: z
      .string()
      .trim()
      .max(24)
      .refine((s) => !s || taxIdPattern.test(s), "That doesn’t look like a GSTIN, NTN or VAT number")
      .transform((s) => (s ? s.toUpperCase() : null)),
    website: z
      .string()
      .trim()
      .max(200)
      .transform((s) => (s && !/^https?:\/\//i.test(s) ? `https://${s}` : s))
      .refine((s) => !s || z.url().safeParse(s).success, "Enter a valid website address")
      .transform((s) => s || null),
    line1: addressSchema.shape.line1,
    line2: addressSchema.shape.line2,
    city: addressSchema.shape.city,
    state: addressSchema.shape.state,
    postalCode: addressSchema.shape.postalCode,
    country: addressSchema.shape.country,
    expectedMonthly: z.enum(VOLUME_BANDS, "Choose an expected volume"),
    message: optionalText(2000),
  })
  .superRefine((v, ctx) => {
    if (taxIdRequired(v.businessType) && !v.taxId) ctx.addIssue({ code: "custom", path: ["taxId"], message: "Resellers need a GSTIN, NTN or VAT number" });
  });
export type ApplicationInput = z.input<typeof applicationSchema>;

export const orderLinesSchema = z
  .array(z.object({ variantId: id, quantity: z.number().int().min(0).max(MAX_LINE_QTY) }))
  .max(MAX_ORDER_LINES, "Too many lines in one order");

export const placeOrderSchema = z.object({
  lines: orderLinesSchema,
  poNumber: optionalText(60),
  notes: optionalText(500),
  address: addressSchema,
  shippingRateId: id,
});
export type PlaceOrderInput = z.input<typeof placeOrderSchema>;

export const acceptQuoteSchema = z.object({
  number: z.string().trim().regex(/^Q-\d{4,8}$/),
  poNumber: optionalText(60),
  address: addressSchema,
  shippingRateId: id,
});

export const quoteNumberSchema = z.object({ number: z.string().trim().regex(/^Q-\d{4,8}$/) });

const money = z.number().int().min(0).max(1_000_000_000);

export const requestQuoteSchema = z
  .object({
    message: optionalText(2000),
    items: z
      .array(
        z.object({
          variantId: id.nullable(),
          description: z.string().trim().max(300),
          quantity: z.number().int().min(1, "Quantities start at 1").max(MAX_LINE_QTY),
          /** Minor units per unit. */
          targetPrice: money.nullable(),
        }),
      )
      .min(1, "Add at least one line")
      .max(100),
  })
  .superRefine((v, ctx) => {
    v.items.forEach((it, i) => {
      if (!it.variantId && it.description.length < 3) ctx.addIssue({ code: "custom", path: ["items", i, "description"], message: "Describe the custom item" });
    });
  });
export type RequestQuoteInput = z.input<typeof requestQuoteSchema>;

// ─────────────────────────────── Staff ───────────────────────────────

/** Amounts arrive in major units (₹) from admin forms. */
const major = z.number().min(0).max(100_000_000);

export const approveSchema = z.object({
  id,
  tierId: id.nullable(),
  terms: z.enum(TERMS),
  creditLimit: major,
  minOrderValue: major,
});

/** Highest credit limit (₹, major units) staff can grant from the admin. Larger lines are arranged outside the system. */
export const MAX_STAFF_CREDIT = 10_000_000;

/** Staff open a trade account on a buyer's behalf: the public application fields plus login email and terms. */
export const staffCreateAccountSchema = z
  .object({
    application: applicationSchema,
    email: z.string().trim().toLowerCase().max(200).pipe(z.email("Enter a valid login email")),
    status: z.enum(["APPROVED", "PENDING"]),
    tierId: id.nullable(),
    terms: z.enum(TERMS),
    creditLimit: z.number().min(0).max(MAX_STAFF_CREDIT, `Credit limits above ₹${MAX_STAFF_CREDIT.toLocaleString("en-IN")} can’t be set here`),
    minOrderValue: major,
    staffNotes: optionalText(5000),
  })
  .superRefine((v, ctx) => {
    if (v.status === "APPROVED" && v.terms !== "PREPAID" && v.creditLimit <= 0) ctx.addIssue({ code: "custom", path: ["creditLimit"], message: "Credit terms need a credit limit" });
  });
export type StaffCreateAccountInput = z.input<typeof staffCreateAccountSchema>;

export const rejectSchema =z.object({ id, reason: z.string().trim().min(3, "Give the applicant a reason").max(1000) });
export const suspendSchema = z.object({ id, reason: z.string().trim().max(1000) });
export const accountIdSchema = z.object({ id });
export const staffNotesSchema = z.object({ id, notes: text(5000) });

export const tierSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(2).max(60),
  description: text(300),
  discountPercent: z.number().int().min(0).max(90),
  minOrderValue: major,
});

export const tierPriceSchema = z.object({ tierId: id, variantId: id, price: major.nullable() });

export const replyQuoteSchema = z.object({
  id,
  validUntil: z.iso.date("Choose a valid-until date"),
  replyMessage: text(2000),
  staffNotes: text(5000),
  lines: z
    .array(
      z.object({
        id,
        variantId: id.nullable(),
        quantity: z.number().int().min(0).max(MAX_LINE_QTY),
        /** Major units per unit. */
        quotedPrice: major.nullable(),
      }),
    )
    .min(1)
    .max(100),
});

export const quoteIdSchema = z.object({ id });
export const quoteNotesSchema = z.object({ id, notes: text(5000) });
export const orderIdSchema = z.object({ orderId: id });

export const variantTradeSchema = z.object({
  variantId: id,
  caseSize: z.number().int().min(1, "Case size starts at 1").max(10_000),
  tradeMinQty: z.number().int().min(1, "Minimum starts at 1").max(MAX_LINE_QTY),
  tradeEnabled: z.boolean(),
});
