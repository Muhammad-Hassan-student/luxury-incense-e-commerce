"use client";

import { useState } from "react";
import { saveRiskSettingsAction } from "@/actions/admin-whatsapp";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { toMajor, toMinor } from "@/lib/admin-shared";
import { useAdminAction } from "./use-admin-action";

const splitList = (s: string) =>
  s
    .split(/[\n,;]/)
    .map((x) => x.trim())
    .filter(Boolean);

export type RiskSettingsValue = {
  codMaxOrderValue: number;
  codBlockRiskAbove: number;
  codFee: number;
  prepaidIncentive: "none" | "percent" | "free_shipping";
  prepaidPercent: number;
  codConfirmation: boolean;
  confirmWithinHours: number;
  reminderBeforeHours: number;
  blockedPhones: string[];
  blockedPincodes: string[];
  abandonedWhatsApp: boolean;
  marketingCapDays: number;
};

export function RiskSettingsForm({ initial, readOnly }: { initial: RiskSettingsValue; readOnly?: boolean }) {
  const { pending, run } = useAdminAction();
  const [f, setF] = useState({
    codMaxOrderValue: String(toMajor(initial.codMaxOrderValue)),
    codBlockRiskAbove: String(initial.codBlockRiskAbove),
    codFee: String(toMajor(initial.codFee)),
    prepaidIncentive: initial.prepaidIncentive,
    prepaidPercent: String(initial.prepaidPercent),
    codConfirmation: initial.codConfirmation,
    confirmWithinHours: String(initial.confirmWithinHours),
    reminderBeforeHours: String(initial.reminderBeforeHours),
    blockedPhones: initial.blockedPhones.join("\n"),
    blockedPincodes: initial.blockedPincodes.join(", "),
    abandonedWhatsApp: initial.abandonedWhatsApp,
    marketingCapDays: String(initial.marketingCapDays),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  return (
    <form
      className="grid gap-6 p-5 sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          saveRiskSettingsAction({
            codMaxOrderValue: toMinor(Number(f.codMaxOrderValue)),
            codBlockRiskAbove: Number(f.codBlockRiskAbove),
            codFee: toMinor(Number(f.codFee)),
            prepaidIncentive: f.prepaidIncentive,
            prepaidPercent: Number(f.prepaidPercent),
            codConfirmation: f.codConfirmation,
            confirmWithinHours: Number(f.confirmWithinHours),
            reminderBeforeHours: Number(f.reminderBeforeHours),
            blockedPhones: splitList(f.blockedPhones),
            blockedPincodes: splitList(f.blockedPincodes),
            abandonedWhatsApp: f.abandonedWhatsApp,
            marketingCapDays: Number(f.marketingCapDays),
          }),
        );
      }}
    >
      <fieldset disabled={readOnly || pending} className="contents">
        <Field label="COD max order value ₹" hint="0 = no limit">
          <Input type="number" min={0} step={1} required value={f.codMaxOrderValue} onChange={(e) => set("codMaxOrderValue", e.target.value)} />
        </Field>
        <Field label="Hide COD at risk score ≥" hint="1–100 (101 = never by score)">
          <Input type="number" min={1} max={101} step={1} required value={f.codBlockRiskAbove} onChange={(e) => set("codBlockRiskAbove", e.target.value)} />
        </Field>
        <Field label="COD fee ₹" hint="Added to cash-on-delivery orders">
          <Input type="number" min={0} step={1} required value={f.codFee} onChange={(e) => set("codFee", e.target.value)} />
        </Field>
        <Field label="Pay-online incentive">
          <Select value={f.prepaidIncentive} onChange={(e) => set("prepaidIncentive", e.target.value as typeof f.prepaidIncentive)}>
            <option value="none" className="bg-bg">None</option>
            <option value="percent" className="bg-bg">% off</option>
            <option value="free_shipping" className="bg-bg">Free shipping</option>
          </Select>
        </Field>
        <Field label="Incentive %" hint="Used when the incentive is % off">
          <Input type="number" min={0} max={50} step={0.5} value={f.prepaidPercent} onChange={(e) => set("prepaidPercent", e.target.value)} />
        </Field>
        <Field label="WhatsApp marketing cap (days)" hint="Max one bag reminder per phone in this window">
          <Input type="number" min={1} max={90} step={1} required value={f.marketingCapDays} onChange={(e) => set("marketingCapDays", e.target.value)} />
        </Field>
        <Field label="Confirm COD within (hours)" hint="Unconfirmed orders are cancelled and stock released">
          <Input type="number" min={1} max={168} step={1} required value={f.confirmWithinHours} onChange={(e) => set("confirmWithinHours", e.target.value)} />
        </Field>
        <Field label="Reminder before deadline (hours)" hint="0 = no reminder">
          <Input type="number" min={0} max={167} step={1} required value={f.reminderBeforeHours} onChange={(e) => set("reminderBeforeHours", e.target.value)} />
        </Field>
        <div className="flex flex-col justify-end gap-3 pb-1 text-sm">
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={f.codConfirmation} onChange={(e) => set("codConfirmation", e.target.checked)} className="size-4 accent-[var(--gold)]" />
            Require COD confirmation before packing
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={f.abandonedWhatsApp} onChange={(e) => set("abandonedWhatsApp", e.target.checked)} className="size-4 accent-[var(--gold)]" />
            Abandoned-bag WhatsApp (consented customers)
          </label>
        </div>
        <Field label="Blocked phones" hint="One per line; COD is never offered to these" className="sm:col-span-1 lg:col-span-2">
          <Textarea value={f.blockedPhones} onChange={(e) => set("blockedPhones", e.target.value)} className="min-h-20 font-mono text-xs" placeholder="+919800000000" />
        </Field>
        <Field label="Blocked pincodes" hint="Comma or line separated">
          <Textarea value={f.blockedPincodes} onChange={(e) => set("blockedPincodes", e.target.value)} className="min-h-20 font-mono text-xs" placeholder="110001, 400001" />
        </Field>
      </fieldset>
      {readOnly ? (
        <p className="text-xs text-subtle sm:col-span-2 lg:col-span-3">Only staff with settings access can change these.</p>
      ) : (
        <div className="flex justify-end sm:col-span-2 lg:col-span-3">
          <Button type="submit" size="sm" disabled={pending}>
            Save COD & risk settings
          </Button>
        </div>
      )}
    </form>
  );
}
