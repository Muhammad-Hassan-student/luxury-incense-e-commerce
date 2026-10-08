"use client";

import { useState } from "react";
import { saveJourneyConfigAction, saveJourneySettingsAction, setJourneyEnabledAction, setJourneysPausedAction } from "@/actions/admin-automations";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type { JourneyKey, JourneySettings, TemplateKey } from "@/lib/journeys";
import { TEMPLATE_LABEL } from "@/lib/journeys";
import { cn } from "@/lib/utils";
import { useAdminAction } from "../use-admin-action";

/** On/off switch for one journey (same look as the other admin toggles). */
export function JourneySwitch({ journeyKey, name, enabled }: { journeyKey: JourneyKey; name: string; enabled: boolean }) {
  const { pending, run } = useAdminAction();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${name} journey ${enabled ? "on" : "off"}`}
      disabled={pending}
      onClick={() => run(() => setJourneyEnabledAction({ key: journeyKey, enabled: !enabled }))}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center border transition-colors duration-300 disabled:cursor-not-allowed",
        enabled ? "border-gold bg-gold/20" : "border-line-strong bg-transparent",
        pending && "opacity-50",
      )}
    >
      <span className={cn("absolute size-3 transition-transform duration-300", enabled ? "translate-x-[1.1rem] bg-gold" : "translate-x-[0.2rem] bg-subtle")} />
    </button>
  );
}

/** Kill switch for every journey. */
export function PauseAll({ paused }: { paused: boolean }) {
  const { pending, run } = useAdminAction();
  const [confirming, setConfirming] = useState(false);
  if (paused) {
    return (
      <Button size="sm" disabled={pending} onClick={() => run(() => setJourneysPausedAction({ paused: false }))}>
        Resume journeys
      </Button>
    );
  }
  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Stop every enrolment and send?</span>
        <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => setJourneysPausedAction({ paused: true }), { onSuccess: () => setConfirming(false) })}>
          Pause all
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    );
  }
  return (
    <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
      Pause all journeys
    </Button>
  );
}

type NumField = { name: string; label: string; hint?: string; min: number; max: number; money?: boolean };

const CONFIG_FIELDS: Record<JourneyKey, NumField[]> = {
  welcome: [
    { name: "reviewDay", label: "Review request on day", min: 1, max: 60 },
    { name: "ritualDay", label: "“Complete the ritual” on day", min: 2, max: 120 },
  ],
  winback: [
    { name: "couponAfterDays", label: "Code after (days without an order)", min: 1, max: 60 },
    { name: "percentOff", label: "Code discount (%)", min: 5, max: 50 },
    { name: "couponValidDays", label: "Code valid for (days)", min: 3, max: 60 },
    { name: "reminderDaysBefore", label: "Reminder (days before expiry)", min: 1, max: 10 },
    { name: "minSubtotal", label: "Minimum bag (₹)", min: 0, max: 100000, money: true },
  ],
  vip: [{ name: "bonusPoints", label: "Bonus loyalty points", min: 10, max: 5000 }],
  lapsed: [
    { name: "percentOff", label: "Code discount (%)", min: 5, max: 50 },
    { name: "couponValidDays", label: "Code valid for (days)", min: 3, max: 60 },
    { name: "minSubtotal", label: "Minimum bag (₹)", min: 0, max: 100000, money: true },
  ],
  review: [{ name: "afterDays", label: "Ask this many days after delivery", min: 1, max: 60 }],
};

export function JourneyConfigForm({ journeyKey, config }: { journeyKey: JourneyKey; config: Record<string, number> }) {
  const { pending, run } = useAdminAction();
  const fields = CONFIG_FIELDS[journeyKey];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, String(f.money ? (config[f.name] ?? 0) / 100 : (config[f.name] ?? ""))])),
  );
  return (
    <form
      className="space-y-6 px-5 py-5"
      onSubmit={(e) => {
        e.preventDefault();
        const out = Object.fromEntries(fields.map((f) => [f.name, f.money ? Math.round(Number(values[f.name]) * 100) : Number(values[f.name])]));
        run(() => saveJourneyConfigAction({ key: journeyKey, config: out }));
      }}
    >
      <div className="grid gap-6 sm:grid-cols-2">
        {fields.map((f) => (
          <Field key={f.name} label={f.label} hint={f.hint}>
            <Input
              type="number"
              inputMode="numeric"
              min={f.min}
              max={f.max}
              step={1}
              required
              value={values[f.name]}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
      <Button size="sm" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save timing & offers"}
      </Button>
    </form>
  );
}

export function GuardrailsForm({ settings }: { settings: JourneySettings }) {
  const { pending, run } = useAdminAction();
  const [s, setS] = useState(settings);
  const num = (name: keyof JourneySettings, label: string, min: number, max: number, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input type="number" min={min} max={max} step={1} required value={String(s[name])} onChange={(e) => setS((x) => ({ ...x, [name]: Number(e.target.value) }))} />
    </Field>
  );
  const check = (name: "dryRun" | "includeTrade", label: string, hint: string) => (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" className="mt-1 accent-gold" checked={s[name]} onChange={(e) => setS((x) => ({ ...x, [name]: e.target.checked }))} />
      <span>
        <span className="text-fg">{label}</span>
        <span className="block text-xs text-subtle">{hint}</span>
      </span>
    </label>
  );
  return (
    <form
      className="space-y-6 px-5 py-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveJourneySettingsAction(s));
      }}
    >
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {num("frequencyCapHours", "Max 1 journey email per customer every (hours)", 1, 720)}
        {num("dailySendCap", "Daily send cap (all customers)", 1, 100000)}
        {num("entryWindowDays", "Entry window (days)", 1, 30, "How recently a customer must have entered a segment")}
        {num("cooldownDays", "Re-entry cooldown (days)", 0, 365)}
        {num("attributionDays", "Attribution window (days)", 1, 60, "Orders this soon after an email count as converted")}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {check("dryRun", "Dry-run mode", "The hourly job only reports what it would do — nothing is enrolled, sent or issued.")}
        {check("includeTrade", "Include trade accounts", "Wholesale buyers are excluded by default.")}
      </div>
      <Button size="sm" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save guardrails"}
      </Button>
    </form>
  );
}

/** Rendered email HTML per template, shown in a sandboxed frame. */
export function EmailPreview({ previews }: { previews: { template: TemplateKey; subject: string; html: string }[] }) {
  const [active, setActive] = useState(0);
  const current = previews[active];
  if (!current) return null;
  return (
    <div>
      <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3" role="tablist" aria-label="Email templates">
        {previews.map((p, i) => (
          <button
            key={p.template}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={cn(
              "border px-3 py-1.5 text-[0.625rem] uppercase tracking-[0.18em] transition-colors",
              i === active ? "border-gold text-gold" : "border-line text-muted hover:border-line-strong hover:text-fg",
            )}
          >
            {TEMPLATE_LABEL[p.template].split(" · ")[1] ?? TEMPLATE_LABEL[p.template]}
          </button>
        ))}
      </div>
      <p className="px-5 pt-4 text-xs text-muted">
        Subject: <span className="text-fg">{current.subject}</span>
      </p>
      <div className="p-3 sm:p-5">
        <iframe title={`Preview: ${TEMPLATE_LABEL[current.template]}`} srcDoc={current.html} sandbox="allow-same-origin" className="h-[640px] w-full border border-line bg-[#0b0a09]" />
      </div>
    </div>
  );
}
