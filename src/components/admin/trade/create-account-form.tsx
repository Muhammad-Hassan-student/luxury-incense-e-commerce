"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TradeTerms } from "@/generated/prisma/enums";
import { createTradeAccountAction } from "@/actions/admin-create";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { notify } from "@/components/admin/use-admin-action";
import { COUNTRIES } from "@/components/trade/apply-form";
import { BUSINESS_TYPES, TERMS, TERMS_LABEL, VOLUME_BANDS, taxIdRequired } from "@/components/trade/trade-rules";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { ApplicationInput } from "@/server/trade-schemas";
import type { TierOption } from "./account-actions";

const EMPTY = {
  businessName: "",
  businessType: "",
  contactName: "",
  phone: "",
  taxId: "",
  website: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "IN",
  expectedMonthly: "",
  message: "",
};

/**
 * Trade desk opens an account on a buyer's behalf. Same business fields and validation as the public application
 * (the server re-parses with the shared schema), plus the login email and commercial terms.
 */
export function CreateTradeAccountForm({ tiers, maxCredit }: { tiers: TierOption[]; maxCredit: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [app, setApp] = useState(EMPTY);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"APPROVED" | "PENDING">("APPROVED");
  const [tierId, setTierId] = useState("");
  const [terms, setTerms] = useState<TradeTerms>("PREPAID");
  const [creditLimit, setCreditLimit] = useState("");
  const [minOrderValue, setMinOrderValue] = useState("");
  const [staffNotes, setStaffNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<{ message: string; existingId?: string } | null>(null);

  const tier = tiers.find((t) => t.id === tierId);
  const credit = terms !== "PREPAID";
  const needsTax = app.businessType ? taxIdRequired(app.businessType) : false;
  const err = (k: string) => errors[k] ?? errors[`application.${k}`];
  const field = (k: keyof typeof EMPTY) => ({
    id: `new-trade-${k}`,
    value: app[k],
    onChange: (e: { target: { value: string } }) => setApp((p) => ({ ...p, [k]: e.target.value })),
    "aria-invalid": Boolean(err(k)) || undefined,
    disabled: pending,
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    start(async () => {
      try {
        const res = await createTradeAccountAction({
          application: app as unknown as ApplicationInput,
          email,
          status,
          tierId: tierId || null,
          terms,
          creditLimit: credit ? Number(creditLimit || 0) : 0,
          minOrderValue: Number(minOrderValue || 0),
          staffNotes,
        });
        if (res.ok) {
          notify.success(res.message);
          router.push(`/admin/trade/${res.id}`);
          return;
        }
        const fe = res.fieldErrors ?? {};
        setErrors(fe);
        setFormError({ message: res.error, existingId: res.existingId });
        const first = Object.keys(fe)[0]?.replace(/^application\./, "");
        if (first) document.getElementById(`new-trade-${first}`)?.focus();
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        notify.error("Something went wrong. Please try again.");
      }
    });
  }

  const legend = "eyebrow col-span-full mb-2";

  return (
    <form onSubmit={submit} noValidate className="space-y-12 p-5 sm:p-8">
      <fieldset className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
        <legend className={legend}>Login</legend>
        <Field
          label="Buyer’s login email"
          error={errors.email}
          hint="An existing customer is linked; a new email creates a customer login. Staff emails are refused."
          className="sm:col-span-2"
        >
          <Input id="new-trade-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200} autoComplete="off" aria-invalid={Boolean(errors.email) || undefined} disabled={pending} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
        <legend className={legend}>The business</legend>
        <Field label="Business name" error={err("businessName")} className="sm:col-span-2">
          <Input {...field("businessName")} required maxLength={120} />
        </Field>
        <Field label="Business type" error={err("businessType")}>
          <Select {...field("businessType")} required>
            <option value="" disabled>
              Choose one
            </option>
            {BUSINESS_TYPES.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={needsTax ? "GSTIN / NTN / VAT number" : "GSTIN / NTN / VAT (optional)"} error={err("taxId")} hint={needsTax ? "Required for resellers" : undefined}>
          <Input {...field("taxId")} maxLength={24} className="uppercase" />
        </Field>
        <Field label="Website or Instagram (optional)" error={err("website")} className="sm:col-span-2">
          <Input {...field("website")} inputMode="url" placeholder="maisonexample.com" maxLength={200} />
        </Field>
        <Field label="Contact name" error={err("contactName")}>
          <Input {...field("contactName")} required maxLength={100} />
        </Field>
        <Field label="Phone" error={err("phone")}>
          <Input {...field("phone")} type="tel" required maxLength={20} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
        <legend className={legend}>Business address</legend>
        <Field label="Address" error={err("line1")} className="sm:col-span-2">
          <Input {...field("line1")} required maxLength={200} />
        </Field>
        <Field label="Address line 2 (optional)" error={err("line2")} className="sm:col-span-2">
          <Input {...field("line2")} maxLength={200} />
        </Field>
        <Field label="City" error={err("city")}>
          <Input {...field("city")} required maxLength={100} />
        </Field>
        <Field label="State / region" error={err("state")}>
          <Input {...field("state")} required maxLength={100} />
        </Field>
        <Field label="Postal code" error={err("postalCode")}>
          <Input {...field("postalCode")} required maxLength={12} />
        </Field>
        <Field label="Country" error={err("country")}>
          <Select {...field("country")}>
            {COUNTRIES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Expected monthly volume" error={err("expectedMonthly")}>
          <Select {...field("expectedMonthly")} required>
            <option value="" disabled>
              Choose a band
            </option>
            {VOLUME_BANDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Buyer’s message (optional)" error={err("message")} className="sm:col-span-2">
          <Textarea {...field("message")} maxLength={2000} rows={3} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
        <legend className={legend}>Status & terms</legend>
        <div className="sm:col-span-2" role="radiogroup" aria-label="Account status">
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["APPROVED", "Approved", "Open now — the buyer can order on these terms straight away."],
                ["PENDING", "Pending review", "Add to the review queue; approve later from the account page."],
              ] as const
            ).map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={status === value}
                disabled={pending}
                onClick={() => setStatus(value)}
                className={cn(
                  "border px-4 py-4 text-left transition-colors focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-gold",
                  status === value ? "border-gold bg-bg-soft" : "border-line hover:border-line-strong",
                )}
              >
                <span className={cn("block text-[0.6875rem] uppercase tracking-[0.2em]", status === value ? "text-gold" : "text-fg")}>{label}</span>
                <span className="mt-1 block text-xs text-muted">{hint}</span>
              </button>
            ))}
          </div>
        </div>
        <Field label="Price tier" error={errors.tierId} hint={tier ? `${tier.discountPercent}% off retail · tier minimum ${tier.minOrderValue ? formatMoney(tier.minOrderValue) : "none"}` : "No tier = retail prices, no minimum"}>
          <Select id="new-trade-tierId" value={tierId} onChange={(e) => setTierId(e.target.value)} disabled={pending}>
            <option value="">No tier</option>
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {t.discountPercent}%
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Payment terms" error={errors.terms}>
          <Select id="new-trade-terms" value={terms} onChange={(e) => setTerms(e.target.value as TradeTerms)} disabled={pending}>
            {TERMS.map((t) => (
              <option key={t} value={t}>
                {TERMS_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Credit limit ₹" error={errors.creditLimit} hint={credit ? `Up to ₹${maxCredit.toLocaleString("en-IN")}` : "Not used on prepaid terms"}>
          <Input
            id="new-trade-creditLimit"
            type="number"
            min={0}
            max={maxCredit}
            step={1}
            value={credit ? creditLimit : ""}
            disabled={!credit || pending}
            onChange={(e) => setCreditLimit(e.target.value)}
            aria-invalid={Boolean(errors.creditLimit) || undefined}
          />
        </Field>
        <Field label="Minimum order override ₹" error={errors.minOrderValue} hint="Blank or 0 = use the tier’s minimum">
          <Input id="new-trade-minOrderValue" type="number" min={0} step={1} value={minOrderValue} disabled={pending} onChange={(e) => setMinOrderValue(e.target.value)} />
        </Field>
        <Field label="Internal notes (optional)" error={errors.staffNotes} hint="Never shown to the buyer" className="sm:col-span-2">
          <Textarea id="new-trade-staffNotes" value={staffNotes} onChange={(e) => setStaffNotes(e.target.value)} maxLength={5000} rows={3} disabled={pending} />
        </Field>
      </fieldset>

      {formError ? (
        <p role="alert" className="border border-ember/40 p-4 text-sm text-ember">
          {formError.message}
          {formError.existingId ? (
            <>
              {" "}
              <Link href={`/admin/trade/${formError.existingId}`} className="underline underline-offset-4 hover:text-fg">
                Open that account
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-4 border-t border-line pt-8 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-md text-xs leading-relaxed text-subtle">
          The buyer is emailed a welcome with a sign-in link to the trade portal. The account is recorded in the audit log under your name.
        </p>
        <Button type="submit" disabled={pending}>
          <span>{pending ? "Creating…" : status === "APPROVED" ? "Open trade account" : "Add for review"}</span>
        </Button>
      </div>
    </form>
  );
}
