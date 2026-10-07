"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { applyForTrade } from "@/actions/trade";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { applicationSchema, type ApplicationInput } from "@/server/trade-schemas";
import { BUSINESS_TYPES, VOLUME_BANDS, taxIdRequired } from "./trade-rules";

type Defaults = Pick<ApplicationInput, "contactName" | "phone" | "line1" | "city" | "state" | "postalCode" | "country"> & { line2?: string };

const COUNTRIES = [
  ["IN", "India"],
  ["PK", "Pakistan"],
  ["AE", "United Arab Emirates"],
  ["SA", "Saudi Arabia"],
  ["QA", "Qatar"],
  ["OM", "Oman"],
  ["KW", "Kuwait"],
  ["BH", "Bahrain"],
  ["GB", "United Kingdom"],
  ["US", "United States"],
] as const;

export function TradeApplyForm({ defaults }: { defaults: Defaults }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [f, setF] = useState({
    businessName: "",
    businessType: "",
    contactName: defaults.contactName,
    phone: defaults.phone,
    taxId: "",
    website: "",
    line1: defaults.line1,
    line2: defaults.line2 ?? "",
    city: defaults.city,
    state: defaults.state,
    postalCode: defaults.postalCode,
    country: defaults.country || "IN",
    expectedMonthly: "",
    message: "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const err = (k: string) => errors[k];
  const needsTax = f.businessType ? taxIdRequired(f.businessType) : false;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const input = f as unknown as ApplicationInput;
    const local = applicationSchema.safeParse(input);
    if (!local.success) {
      const next: Record<string, string> = {};
      for (const i of local.error.issues) next[i.path.join(".")] ??= i.message;
      setErrors(next);
      document.getElementById(`apply-${Object.keys(next)[0]}`)?.focus();
      return;
    }
    setErrors({});
    start(async () => {
      const res = await applyForTrade(input);
      if (res.ok) {
        toast("Application sent — we’ll be in touch");
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
      }
    });
  }

  const field = (k: keyof typeof f) => ({ id: `apply-${k}`, value: f[k], onChange: set(k), "aria-invalid": Boolean(err(k)) || undefined, disabled: pending });

  return (
    <form onSubmit={submit} noValidate className="space-y-14">
      <fieldset className="grid gap-8 sm:grid-cols-2">
        <legend className="eyebrow mb-8">The business</legend>
        <Field label="Business name" error={err("businessName")} className="sm:col-span-2">
          <Input {...field("businessName")} autoComplete="organization" required maxLength={120} />
        </Field>
        <Field label="What kind of business?" error={err("businessType")}>
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
        <Field label={needsTax ? "GSTIN / NTN / VAT number" : "GSTIN / NTN / VAT (optional)"} error={err("taxId")} hint={needsTax ? "Required for resellers" : "Optional for hotels, spas and gifting"}>
          <Input {...field("taxId")} required={needsTax} maxLength={24} className="uppercase" />
        </Field>
        <Field label="Website or Instagram (optional)" error={err("website")} className="sm:col-span-2">
          <Input {...field("website")} type="url" inputMode="url" autoComplete="url" placeholder="maisonexample.com" maxLength={200} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-8 sm:grid-cols-2">
        <legend className="eyebrow mb-8">Contact</legend>
        <Field label="Contact name" error={err("contactName")}>
          <Input {...field("contactName")} autoComplete="name" required maxLength={100} />
        </Field>
        <Field label="Phone" error={err("phone")}>
          <Input {...field("phone")} type="tel" autoComplete="tel" required maxLength={20} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-8 sm:grid-cols-2">
        <legend className="eyebrow mb-8">Business address</legend>
        <Field label="Address" error={err("line1")} className="sm:col-span-2">
          <Input {...field("line1")} autoComplete="address-line1" required maxLength={200} />
        </Field>
        <Field label="Address line 2 (optional)" error={err("line2")} className="sm:col-span-2">
          <Input {...field("line2")} autoComplete="address-line2" maxLength={200} />
        </Field>
        <Field label="City" error={err("city")}>
          <Input {...field("city")} autoComplete="address-level2" required maxLength={100} />
        </Field>
        <Field label="State / region" error={err("state")}>
          <Input {...field("state")} autoComplete="address-level1" required maxLength={100} />
        </Field>
        <Field label="Postal code" error={err("postalCode")}>
          <Input {...field("postalCode")} autoComplete="postal-code" required maxLength={12} />
        </Field>
        <Field label="Country" error={err("country")}>
          <Select {...field("country")} autoComplete="country">
            {COUNTRIES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>

      <fieldset className="grid gap-8">
        <legend className="eyebrow mb-8">Your plans</legend>
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
        <Field label="Anything else? (optional)" error={err("message")} hint="Which products interest you, where you’ll sell them, private label ideas…">
          <Textarea {...field("message")} maxLength={2000} rows={4} />
        </Field>
      </fieldset>

      {formError ? (
        <p role="alert" className="border border-ember/40 p-4 text-sm text-ember">
          {formError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-6 border-t border-line pt-8">
        <p className="max-w-sm text-xs leading-relaxed text-subtle">We use these details only to review your application and run your trade account.</p>
        <Button type="submit" disabled={pending}>
          <span>{pending ? "Sending…" : "Send application"}</span>
        </Button>
      </div>
    </form>
  );
}
