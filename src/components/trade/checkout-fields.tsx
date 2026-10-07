"use client";

import { formatMoney } from "@/lib/money";
import { Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { ratesFor, type ShippingRateLike } from "./trade-rules";

export type TradeAddressValue = {
  fullName: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type TradeCheckoutValue = { poNumber: string; shippingRateId: string; address: TradeAddressValue };

export const emptyAddress: TradeAddressValue = { fullName: "", phone: "", line1: "", line2: "", city: "", state: "", postalCode: "", country: "IN" };

/** Shipping rate options for the address's country, plus the chosen one (falls back to the first, as quote() does). */
export function chosenRate(rates: ShippingRateLike[], value: TradeCheckoutValue) {
  const options = ratesFor(rates, value.address.country || "IN");
  return { options, rate: options.find((r) => r.id === value.shippingRateId) ?? options[0] ?? null };
}

/** PO number, delivery address and shipping method — shared by quick-order checkout and quote acceptance. */
export function TradeCheckoutFields({
  value,
  onChange,
  rates,
  errors = {},
  disabled,
  idPrefix,
  freeOverHint = true,
}: {
  value: TradeCheckoutValue;
  onChange: (v: TradeCheckoutValue) => void;
  rates: ShippingRateLike[];
  errors?: Record<string, string>;
  disabled?: boolean;
  idPrefix: string;
  freeOverHint?: boolean;
}) {
  const a = value.address;
  const setAddr = (k: keyof TradeAddressValue) => (e: { target: { value: string } }) => onChange({ ...value, address: { ...a, [k]: k === "country" ? e.target.value.toUpperCase().slice(0, 2) : e.target.value } });
  const { options, rate } = chosenRate(rates, value);
  const addrField = (k: keyof TradeAddressValue) => ({
    id: `${idPrefix}-address.${k}`,
    value: a[k],
    onChange: setAddr(k),
    disabled,
    "aria-invalid": Boolean(errors[`address.${k}`]) || undefined,
  });

  return (
    <div className="space-y-10">
      <Field label="Your PO number (optional)" error={errors.poNumber} hint="Printed on the invoice so your accounts team can match it">
        <Input id={`${idPrefix}-poNumber`} value={value.poNumber} onChange={(e) => onChange({ ...value, poNumber: e.target.value })} maxLength={60} disabled={disabled} autoComplete="off" />
      </Field>

      <fieldset className="grid gap-6 sm:grid-cols-2">
        <legend className="eyebrow mb-6">Deliver to</legend>
        <Field label="Attention / receiver" error={errors["address.fullName"]}>
          <Input {...addrField("fullName")} autoComplete="name" maxLength={100} />
        </Field>
        <Field label="Phone" error={errors["address.phone"]}>
          <Input {...addrField("phone")} type="tel" autoComplete="tel" maxLength={20} />
        </Field>
        <Field label="Address" error={errors["address.line1"]} className="sm:col-span-2">
          <Input {...addrField("line1")} autoComplete="address-line1" maxLength={200} />
        </Field>
        <Field label="Address line 2 (optional)" error={errors["address.line2"]} className="sm:col-span-2">
          <Input {...addrField("line2")} autoComplete="address-line2" maxLength={200} />
        </Field>
        <Field label="City" error={errors["address.city"]}>
          <Input {...addrField("city")} autoComplete="address-level2" maxLength={100} />
        </Field>
        <Field label="State / region" error={errors["address.state"]}>
          <Input {...addrField("state")} autoComplete="address-level1" maxLength={100} />
        </Field>
        <Field label="Postal code" error={errors["address.postalCode"]}>
          <Input {...addrField("postalCode")} autoComplete="postal-code" maxLength={12} />
        </Field>
        <Field label="Country code" error={errors["address.country"]} hint="Two letters, e.g. IN, AE, PK">
          <Input {...addrField("country")} autoComplete="country" maxLength={2} className="uppercase" />
        </Field>
      </fieldset>

      <fieldset>
        <legend className="eyebrow mb-6">Shipping</legend>
        {options.length ? (
          <div className="divide-y divide-line border-y border-line" role="radiogroup" aria-label="Shipping method">
            {options.map((r) => {
              const checked = rate?.id === r.id;
              return (
                <label key={r.id} className={cn("flex cursor-pointer items-center justify-between gap-4 py-4 text-sm transition-colors", checked ? "text-fg" : "text-muted hover:text-fg")}>
                  <span className="flex items-center gap-4">
                    <input
                      type="radio"
                      name={`${idPrefix}-rate`}
                      value={r.id}
                      checked={checked}
                      onChange={() => onChange({ ...value, shippingRateId: r.id })}
                      disabled={disabled}
                      className="size-4 accent-[var(--gold)]"
                    />
                    <span>
                      {r.name}
                      <span className="block text-xs text-subtle">
                        {r.etaDays} days{freeOverHint && r.freeOver != null ? ` · free over ${formatMoney(r.freeOver)}` : ""}
                      </span>
                    </span>
                  </span>
                  <span className="tabular-nums">{formatMoney(r.price)}</span>
                </label>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-ember">We don’t ship to that country yet — contact the trade desk for a freight quote.</p>
        )}
        {errors.shippingRateId ? <p className="mt-2 text-xs text-ember">{errors.shippingRateId}</p> : null}
      </fieldset>
    </div>
  );
}

