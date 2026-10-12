"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/i18n/format";
import { applyForTrade } from "@/actions/trade";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { applicationSchema, type ApplicationInput } from "@/server/trade-schemas";
import { BUSINESS_TYPES, VOLUME_BANDS, taxIdRequired } from "./trade-rules";

type Defaults = Pick<ApplicationInput, "contactName" | "phone" | "line1" | "city" | "state" | "postalCode" | "country"> & { line2?: string };

export const COUNTRIES = [
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
  const t = useTranslations("trade.apply");
  const tt = useTranslations("trade");
  const intl = useIntlLocale();
  const regionName = (code: string, fallback: string) => {
    try {
      return new Intl.DisplayNames([intl], { type: "region" }).of(code) ?? fallback;
    } catch {
      return fallback;
    }
  };
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
        toast(t("sent"));
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
        <legend className="eyebrow mb-8">{t("theBusiness")}</legend>
        <Field label={t("businessName")} error={err("businessName")} className="sm:col-span-2">
          <Input {...field("businessName")} autoComplete="organization" required maxLength={120} />
        </Field>
        <Field label={t("businessType")} error={err("businessType")}>
          <Select {...field("businessType")} required>
            <option value="" disabled>
              {t("chooseOne")}
            </option>
            {BUSINESS_TYPES.map((b) => (
              <option key={b.value} value={b.value}>
                {tt(`businessType_${b.value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={needsTax ? t("taxIdRequired") : t("taxIdOptional")} error={err("taxId")} hint={needsTax ? t("taxIdRequiredHint") : t("taxIdOptionalHint")}>
          <Input {...field("taxId")} required={needsTax} maxLength={24} className="uppercase" />
        </Field>
        <Field label={t("website")} error={err("website")} className="sm:col-span-2">
          <Input {...field("website")} type="url" inputMode="url" autoComplete="url" placeholder="maisonexample.com" maxLength={200} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-8 sm:grid-cols-2">
        <legend className="eyebrow mb-8">{t("contact")}</legend>
        <Field label={t("contactName")} error={err("contactName")}>
          <Input {...field("contactName")} autoComplete="name" required maxLength={100} />
        </Field>
        <Field label={tt("address.phone")} error={err("phone")}>
          <Input {...field("phone")} type="tel" autoComplete="tel" required maxLength={20} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-8 sm:grid-cols-2">
        <legend className="eyebrow mb-8">{t("businessAddress")}</legend>
        <Field label={tt("address.line1")} error={err("line1")} className="sm:col-span-2">
          <Input {...field("line1")} autoComplete="address-line1" required maxLength={200} />
        </Field>
        <Field label={tt("address.line2")} error={err("line2")} className="sm:col-span-2">
          <Input {...field("line2")} autoComplete="address-line2" maxLength={200} />
        </Field>
        <Field label={tt("address.city")} error={err("city")}>
          <Input {...field("city")} autoComplete="address-level2" required maxLength={100} />
        </Field>
        <Field label={tt("address.state")} error={err("state")}>
          <Input {...field("state")} autoComplete="address-level1" required maxLength={100} />
        </Field>
        <Field label={tt("address.postalCode")} error={err("postalCode")}>
          <Input {...field("postalCode")} autoComplete="postal-code" required maxLength={12} />
        </Field>
        <Field label={tt("address.country")} error={err("country")}>
          <Select {...field("country")} autoComplete="country">
            {COUNTRIES.map(([code, name]) => (
              <option key={code} value={code}>
                {regionName(code, name)}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>

      <fieldset className="grid gap-8">
        <legend className="eyebrow mb-8">{t("yourPlans")}</legend>
        <Field label={t("expectedMonthly")} error={err("expectedMonthly")}>
          <Select {...field("expectedMonthly")} required>
            <option value="" disabled>
              {t("chooseBand")}
            </option>
            {VOLUME_BANDS.map((b, i) => (
              <option key={b} value={b}>
                {tt(`volumeBand_${i}` as Parameters<typeof tt>[0])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("message")} error={err("message")} hint={t("messageHint")}>
          <Textarea {...field("message")} maxLength={2000} rows={4} />
        </Field>
      </fieldset>

      {formError ? (
        <p role="alert" className="border border-ember/40 p-4 text-sm text-ember">
          {formError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-6 border-t border-line pt-8">
        <p className="max-w-sm text-xs leading-relaxed text-subtle">{t("privacy")}</p>
        <Button type="submit" disabled={pending}>
          <span>{pending ? t("sending") : t("submit")}</span>
        </Button>
      </div>
    </form>
  );
}
