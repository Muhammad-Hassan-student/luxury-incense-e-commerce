"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createVisitAction } from "@/actions/admin-create";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { notify } from "@/components/admin/use-admin-action";
import { COMPANY_PURPOSES, PURPOSE_INFO, VISIT_PURPOSES, fmtClock, fmtDayLabel, type DayAvailability, type VisitPurpose } from "@/server/visit-schedule";
import { cn } from "@/lib/utils";

/**
 * Staff booking form: visitor details, then a day and time from the same availability the public booking uses
 * (staff see today onwards). Full or short slots can be booked only with "override capacity", which is audited.
 */
export function CreateVisitForm({ days, capacity, durationMins, timezone }: { days: DayAvailability[]; capacity: number; durationMins: number; timezone: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState({ name: "", email: "", phone: "", company: "", purpose: "TOUR" as VisitPurpose, groupSize: "2", notes: "" });
  const [day, setDay] = useState(() => days.find((d) => d.slots.some((s) => s.remaining > 0))?.day ?? days[0]?.day ?? "");
  const [startsAt, setStartsAt] = useState("");
  const [override, setOverride] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const size = Math.max(0, Math.floor(Number(f.groupSize) || 0));
  const dayData = days.find((d) => d.day === day);
  const slot = dayData?.slots.find((s) => s.startsAt === startsAt);
  const short = slot ? slot.remaining < size : false;
  const needsCompany = COMPANY_PURPOSES.includes(f.purpose);
  const freeByDay = useMemo(() => new Map(days.map((d) => [d.day, d.slots.reduce((n, s) => n + s.remaining, 0)])), [days]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const field = (k: keyof typeof f) => ({ id: `new-visit-${k}`, value: f[k], onChange: set(k), "aria-invalid": Boolean(errors[k]) || undefined, disabled: pending });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!startsAt) {
      setErrors({ startsAt: "Choose a time." });
      return;
    }
    start(async () => {
      try {
        const res = await createVisitAction({ ...f, groupSize: size, startsAt, override: short && override });
        if (res.ok) {
          notify.success(res.message);
          router.push(`/admin/visits/${res.id}`);
          return;
        }
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
        router.refresh();
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        notify.error("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-10 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <fieldset className="grid content-start gap-x-8 gap-y-7 sm:grid-cols-2">
        <legend className="eyebrow mb-6">Visitor</legend>
        <Field label="Name" error={errors.name} className="sm:col-span-2">
          <Input {...field("name")} required maxLength={120} autoComplete="off" />
        </Field>
        <Field label="Email" error={errors.email} hint="The visitor pass is sent here">
          <Input {...field("email")} type="email" required maxLength={200} autoComplete="off" />
        </Field>
        <Field label="Phone" error={errors.phone}>
          <Input {...field("phone")} type="tel" required maxLength={32} autoComplete="off" />
        </Field>
        <Field label="Purpose" error={errors.purpose}>
          <Select {...field("purpose")}>
            {VISIT_PURPOSES.map((p) => (
              <option key={p} value={p}>
                {PURPOSE_INFO[p].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Party size" error={errors.groupSize}>
          <Input {...field("groupSize")} type="number" min={1} max={500} step={1} required inputMode="numeric" />
        </Field>
        <Field label={needsCompany ? "Company" : "Company (optional)"} error={errors.company} className="sm:col-span-2">
          <Input {...field("company")} maxLength={160} required={needsCompany} />
        </Field>
        <Field label="Staff notes (optional)" error={errors.notes} hint="Only staff see these" className="sm:col-span-2">
          <Textarea {...field("notes")} maxLength={4000} rows={3} />
        </Field>
      </fieldset>

      <fieldset className="min-w-0 space-y-6">
        <legend className="eyebrow mb-6">When</legend>
        {days.length ? (
          <>
            <Field label="Day" hint={`${timezone} · ${durationMins}-minute visits, ${capacity} places per slot`}>
              <Select
                id="new-visit-day"
                value={day}
                onChange={(e) => {
                  setDay(e.target.value);
                  setStartsAt("");
                  setOverride(false);
                }}
                disabled={pending}
              >
                {days.map((d) => (
                  <option key={d.day} value={d.day}>
                    {fmtDayLabel(d.day, { weekday: "short" })} · {freeByDay.get(d.day) ? `${freeByDay.get(d.day)} places free` : "full"}
                  </option>
                ))}
              </Select>
            </Field>
            <div role="radiogroup" aria-label="Time" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {dayData?.slots.map((s) => {
                const checked = s.startsAt === startsAt;
                const fits = s.remaining >= size;
                const used = Math.min(capacity, capacity - s.remaining);
                return (
                  <button
                    key={s.startsAt}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    disabled={pending}
                    onClick={() => {
                      setStartsAt(s.startsAt);
                      setOverride(false);
                      setErrors((e) => ({ ...e, startsAt: "" }));
                    }}
                    className={cn(
                      "flex min-h-24 flex-col justify-between border px-4 py-3 text-left transition-colors focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-gold",
                      checked ? "border-gold bg-bg-soft" : fits ? "border-line hover:border-line-strong" : "border-line opacity-60 hover:opacity-100",
                    )}
                  >
                    <span className={cn("font-display text-2xl font-light tabular-nums", checked ? "text-gold" : "text-fg")}>{fmtClock(s.time)}</span>
                    <span className="mt-2 block h-1 w-full bg-bg-soft" aria-hidden>
                      <span className={cn("block h-full", s.remaining <= 0 ? "bg-ember" : "bg-gold")} style={{ width: `${Math.max(0, Math.min(100, (used / capacity) * 100))}%` }} />
                    </span>
                    <span className={cn("mt-2 text-[0.625rem] uppercase tracking-[0.18em]", fits ? "text-muted" : "text-ember")}>
                      {s.remaining <= 0 ? "Full" : `${s.remaining} left`}
                      {!fits && s.remaining > 0 ? " · too few" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
            {errors.startsAt ? <p className="text-xs text-ember">{errors.startsAt}</p> : null}
            {short ? (
              <label className="flex items-start gap-3 border border-ember/40 p-4 text-sm text-ember">
                <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--gold)]" disabled={pending} />
                <span>
                  Override capacity: only {Math.max(0, slot?.remaining ?? 0)} place{slot?.remaining === 1 ? "" : "s"} left for a party of {size}. Book anyway — this is recorded in the audit log.
                </span>
              </label>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted">No visiting times are configured in the booking window. Add some under Availability.</p>
        )}

        {formError ? (
          <p role="alert" className="border border-ember/40 p-4 text-sm text-ember">
            {formError}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-line pt-6">
          <p className="text-xs leading-relaxed text-subtle">The visit is confirmed immediately and the visitor is emailed their pass with a link to manage it.</p>
          <Button type="submit" disabled={pending || !startsAt || (short && !override)} className="self-start">
            <span>{pending ? "Booking…" : "Confirm visit & email pass"}</span>
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
