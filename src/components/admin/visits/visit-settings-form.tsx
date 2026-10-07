"use client";

import { useState, type ChangeEvent } from "react";
import { X } from "lucide-react";
import { saveVisitSettingsAction } from "@/actions/admin-visits";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { WEEKDAYS, WEEKDAY_LABEL, fmtDayLabel, type VisitSettings, type Weekday } from "@/server/visit-schedule";
import { useAdminAction } from "../use-admin-action";

const ORDER: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const parseTimes = (s: string) =>
  s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (/^\d:\d\d$/.test(x) ? `0${x}` : x));

export function VisitSettingsForm({ initial }: { initial: VisitSettings }) {
  const { pending, run } = useAdminAction();
  const [weekly, setWeekly] = useState<Record<Weekday, string>>(
    Object.fromEntries(WEEKDAYS.map((d) => [d, initial.weekly[d].join(", ")])) as Record<Weekday, string>,
  );
  const [n, setN] = useState({
    slotMinutes: String(initial.slotMinutes),
    capacityPerSlot: String(initial.capacityPerSlot),
    maxGroupSize: String(initial.maxGroupSize),
    leadDays: String(initial.leadDays),
    horizonDays: String(initial.horizonDays),
    autoMax: String(initial.autoConfirm.maxGroupSize),
  });
  const [timezone, setTimezone] = useState(initial.timezone);
  const [autoOn, setAutoOn] = useState(initial.autoConfirm.enabled);
  const [closed, setClosed] = useState<string[]>(initial.closedDates);
  const [newClosed, setNewClosed] = useState("");
  const [address, setAddress] = useState(initial.address);
  const [directions, setDirections] = useState(initial.directions);
  const num = (k: keyof typeof n) => Number(n[k] || 0);
  const setNum = (k: keyof typeof n) => (e: ChangeEvent<HTMLInputElement>) => setN((p) => ({ ...p, [k]: e.target.value }));

  return (
    <form
      className="space-y-10 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          saveVisitSettingsAction({
            timezone: timezone.trim(),
            weekly: Object.fromEntries(WEEKDAYS.map((d) => [d, parseTimes(weekly[d])])) as Record<Weekday, string[]>,
            slotMinutes: num("slotMinutes"),
            capacityPerSlot: num("capacityPerSlot"),
            maxGroupSize: num("maxGroupSize"),
            leadDays: num("leadDays"),
            horizonDays: num("horizonDays"),
            closedDates: closed,
            address,
            directions,
            autoConfirm: { enabled: autoOn, maxGroupSize: num("autoMax") || 1 },
          }),
        );
      }}
    >
      <fieldset>
        <legend className="eyebrow mb-4">Weekly visiting times</legend>
        <p className="mb-5 text-xs text-subtle">24-hour times, separated by commas (e.g. 11:00, 14:00, 16:00). Leave blank for days the atelier is closed to visitors.</p>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          {ORDER.map((d) => (
            <Field key={d} label={WEEKDAY_LABEL[d]}>
              <Input value={weekly[d]} onChange={(e) => setWeekly((p) => ({ ...p, [d]: e.target.value }))} placeholder="Closed" className="font-mono" />
            </Field>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="eyebrow mb-4">Capacity & window</legend>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Visit length (min)">
            <Input type="number" min={15} max={480} step={5} value={n.slotMinutes} onChange={setNum("slotMinutes")} required />
          </Field>
          <Field label="People per slot">
            <Input type="number" min={1} max={500} value={n.capacityPerSlot} onChange={setNum("capacityPerSlot")} required />
          </Field>
          <Field label="Max group size">
            <Input type="number" min={1} max={500} value={n.maxGroupSize} onChange={setNum("maxGroupSize")} required />
          </Field>
          <Field label="Lead time (days)" hint="0 = same day">
            <Input type="number" min={0} max={90} value={n.leadDays} onChange={setNum("leadDays")} required />
          </Field>
          <Field label="Horizon (days)">
            <Input type="number" min={1} max={365} value={n.horizonDays} onChange={setNum("horizonDays")} required />
          </Field>
          <Field label="Time zone" hint="IANA name">
            <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} required className="font-mono" />
          </Field>
        </div>
      </fieldset>

      <fieldset>
        <legend className="eyebrow mb-4">Auto-confirm</legend>
        <div className="flex flex-wrap items-end gap-6">
          <label className="flex items-center gap-3 pb-3 text-sm">
            <input type="checkbox" checked={autoOn} onChange={(e) => setAutoOn(e.target.checked)} className="size-4 accent-[var(--gold)]" />
            Confirm small groups instantly
          </label>
          <Field label="Up to (people)" className="w-40">
            <Input type="number" min={1} max={500} value={n.autoMax} onChange={setNum("autoMax")} disabled={!autoOn} />
          </Field>
        </div>
      </fieldset>

      <fieldset>
        <legend className="eyebrow mb-4">Closed dates</legend>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Add a date" className="w-48">
            <Input type="date" value={newClosed} onChange={(e) => setNewClosed(e.target.value)} />
          </Field>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!newClosed}
            onClick={() => {
              if (newClosed && !closed.includes(newClosed)) setClosed([...closed, newClosed].sort());
              setNewClosed("");
            }}
          >
            Add
          </Button>
        </div>
        {closed.length ? (
          <ul className="mt-5 flex flex-wrap gap-2" aria-label="Closed dates">
            {closed.map((d) => (
              <li key={d} className="inline-flex items-center gap-2 border border-line py-1 pe-1 ps-3 text-sm">
                {fmtDayLabel(d, { weekday: "short", year: true })}
                <button type="button" onClick={() => setClosed(closed.filter((x) => x !== d))} className="p-1 text-muted hover:text-ember" aria-label={`Remove ${d}`}>
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-xs text-subtle">No closures.</p>
        )}
      </fieldset>

      <fieldset className="grid gap-8 md:grid-cols-2">
        <legend className="eyebrow mb-4">Finding us</legend>
        <Field label="Address" hint="Printed on the visitor pass and calendar invite.">
          <Textarea value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} rows={4} required />
        </Field>
        <Field label="Directions">
          <Textarea value={directions} onChange={(e) => setDirections(e.target.value)} maxLength={2000} rows={4} />
        </Field>
      </fieldset>

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          Save availability
        </Button>
      </div>
    </form>
  );
}
