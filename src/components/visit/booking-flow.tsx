"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { bookVisit, refreshVisitAvailability } from "@/actions/visits";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { COMPANY_PURPOSES, PURPOSE_INFO, VISIT_PURPOSES, fmtClock, fmtDayLabel, type DayAvailability, type VisitPurpose } from "@/server/visit-schedule";
import { SlotPicker } from "./slot-picker";
import { VisitCalendar } from "./visit-calendar";

const STEPS = ["Purpose", "Date", "Time", "Your party", "Review"] as const;

export type BookingConfig = {
  maxGroupSize: number;
  slotMinutes: number;
  autoConfirm: { enabled: boolean; maxGroupSize: number };
};

export function BookingFlow({
  initialDays,
  today,
  config,
  prefill,
}: {
  initialDays: DayAvailability[];
  today: string;
  config: BookingConfig;
  prefill: { name: string; email: string };
}) {
  const router = useRouter();
  const [days, setDays] = useState(initialDays);
  const [step, setStep] = useState(0);
  const [purpose, setPurpose] = useState<VisitPurpose | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [groupSize, setGroupSize] = useState(2);
  const [f, setF] = useState({ name: prefill.name, email: prefill.email, phone: "", company: "", message: "" });
  const [pending, start] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const slotLabel = useId();

  // Move focus to the new step's heading so screen-reader and keyboard users land in the right place.
  useEffect(() => {
    if (moved.current) headingRef.current?.focus();
    moved.current = true;
  }, [step]);

  const dayData = days.find((d) => d.day === day) ?? null;
  const slot = dayData?.slots.find((s) => s.startsAt === startsAt) ?? null;
  const maxForSlot = Math.max(1, Math.min(config.maxGroupSize, slot?.remaining ?? config.maxGroupSize));
  const needsCompany = purpose ? COMPANY_PURPOSES.includes(purpose) : false;
  const instant = config.autoConfirm.enabled && groupSize <= config.autoConfirm.maxGroupSize;

  const set = <K extends keyof typeof f>(k: K, v: string) => setF((p) => ({ ...p, [k]: v }));
  const canNext = [
    Boolean(purpose),
    Boolean(day),
    Boolean(slot && slot.remaining > 0),
    groupSize >= 1 && groupSize <= maxForSlot && f.name.trim().length >= 2 && /.+@.+\..+/.test(f.email) && f.phone.trim().length >= 7 && (!needsCompany || f.company.trim().length > 0),
    true,
  ][step];

  function go(n: number) {
    setStep(Math.max(0, Math.min(STEPS.length - 1, n)));
  }

  async function refresh() {
    const fresh = await refreshVisitAvailability();
    setDays(fresh);
    return fresh;
  }

  function submit() {
    if (!purpose || !startsAt) return;
    start(async () => {
      const res = await bookVisit({ purpose, startsAt, groupSize, name: f.name, email: f.email, phone: f.phone, company: needsCompany ? f.company : "", message: f.message });
      if (res.ok) {
        router.push(`/visit/${res.token}?booked=1`);
        return;
      }
      toast.error(res.error);
      if (/place|full|passed|ahead|closed|visiting times/i.test(res.error)) {
        const fresh = await refresh();
        const still = fresh.find((d) => d.day === day)?.slots.find((s) => s.startsAt === startsAt);
        if (!still) {
          setStartsAt(null);
          setDay(null);
          go(1);
        } else if (still.remaining === 0) {
          setStartsAt(null);
          go(2);
        } else if (still.remaining < groupSize) {
          go(3);
        }
      }
    });
  }

  const summary: [string, string][] = [
    ["Purpose", purpose ? PURPOSE_INFO[purpose].label : "—"],
    ["Date", day ? fmtDayLabel(day, { year: true }) : "—"],
    ["Time", slot ? `${fmtClock(slot.time)} · about ${config.slotMinutes} minutes` : "—"],
    ["Party", `${groupSize} ${groupSize === 1 ? "guest" : "guests"}`],
    ["Name", f.name],
    ["Email", f.email],
    ["Phone", f.phone],
    ...(needsCompany ? ([["Company", f.company]] as [string, string][]) : []),
    ...(f.message.trim() ? ([["Message", f.message.trim()]] as [string, string][]) : []),
  ];

  return (
    <div id="book" className="scroll-mt-28">
      {/* Progress */}
      <nav aria-label="Booking steps" className="mb-12">
        <ol className="grid grid-cols-5 gap-2">
          {STEPS.map((label, i) => {
            const reachable = i < step;
            return (
              <li key={label}>
                <button
                  type="button"
                  onClick={() => reachable && go(i)}
                  disabled={!reachable}
                  aria-current={i === step ? "step" : undefined}
                  className="group block w-full text-left disabled:cursor-default"
                >
                  <span className={cn("block h-px w-full transition-colors duration-700", i <= step ? "bg-gold" : "bg-line")} />
                  <span className={cn("mt-3 block text-[0.625rem] uppercase tracking-[0.2em] transition-colors", i === step ? "text-fg" : i < step ? "text-muted group-hover:text-gold" : "text-subtle")}>
                    <span className="tabular-nums">0{i + 1}</span>
                    <span className="hidden md:inline"> · {label}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <AnimatePresence mode="wait" initial={false}>
        <motion.section key={step} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.5, ease }} aria-labelledby="visit-step-heading">
          <h3 id="visit-step-heading" ref={headingRef} tabIndex={-1} className="display mb-8 text-4xl outline-none md:text-5xl">
            {["What brings you to us?", "Choose a day", "Choose a time", "Who’s coming?", "Review your visit"][step]}
          </h3>

          {step === 0 ? (
            <div role="radiogroup" aria-labelledby="visit-step-heading" className="grid gap-3 sm:grid-cols-2">
              {VISIT_PURPOSES.map((p) => {
                const on = purpose === p;
                return (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      setPurpose(p);
                      go(1);
                    }}
                    className={cn(
                      "flex flex-col items-start gap-2 border px-6 py-5 text-left transition-colors duration-500 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-gold",
                      on ? "border-gold bg-bg-elev" : "border-line hover:border-line-strong",
                    )}
                  >
                    <span className={cn("font-display text-2xl", on ? "text-gold" : "text-fg")}>{PURPOSE_INFO[p].label}</span>
                    <span className="text-sm leading-relaxed text-muted">{PURPOSE_INFO[p].blurb}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {step === 1 ? (
            days.length ? (
              <div className="max-w-xl">
                <VisitCalendar
                  days={days}
                  today={today}
                  selected={day}
                  onSelect={(d) => {
                    if (d !== day) setStartsAt(null);
                    setDay(d);
                    go(2);
                  }}
                />
              </div>
            ) : (
              <p className="text-muted">There are no visiting days open just now. Please write to us and we’ll find a time.</p>
            )
          ) : null}

          {step === 2 && dayData ? (
            <div>
              <p id={slotLabel} className="mb-6 text-muted">
                {fmtDayLabel(dayData.day, { year: true })}. Each visit lasts about {config.slotMinutes} minutes.
              </p>
              <SlotPicker slots={dayData.slots} value={startsAt} onChange={setStartsAt} labelledBy={slotLabel} durationMins={config.slotMinutes} />
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-10">
              <fieldset>
                <legend className="eyebrow mb-4 !text-muted">Party size</legend>
                <div className="flex items-center gap-6">
                  <button
                    type="button"
                    onClick={() => setGroupSize((n) => Math.max(1, n - 1))}
                    disabled={groupSize <= 1}
                    aria-label="One fewer guest"
                    className="inline-flex size-12 items-center justify-center border border-line-strong transition-colors hover:border-gold hover:text-gold disabled:opacity-30"
                  >
                    <Minus className="size-4" aria-hidden />
                  </button>
                  <output aria-live="polite" className="min-w-16 text-center font-display text-5xl font-light tabular-nums">
                    {groupSize}
                  </output>
                  <button
                    type="button"
                    onClick={() => setGroupSize((n) => Math.min(maxForSlot, n + 1))}
                    disabled={groupSize >= maxForSlot}
                    aria-label="One more guest"
                    className="inline-flex size-12 items-center justify-center border border-line-strong transition-colors hover:border-gold hover:text-gold disabled:opacity-30"
                  >
                    <Plus className="size-4" aria-hidden />
                  </button>
                  <span className="text-xs text-subtle">
                    Up to {maxForSlot} at this time.
                  </span>
                </div>
                {groupSize > maxForSlot ? <p className="mt-2 text-xs text-ember">Only {maxForSlot} places are left at this time.</p> : null}
              </fieldset>
              <div className="grid gap-8 sm:grid-cols-2">
                <Field label="Your name">
                  <Input value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} autoComplete="name" />
                </Field>
                <Field label="Email" hint="Your pass and any changes are sent here.">
                  <Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} required maxLength={200} autoComplete="email" />
                </Field>
                <Field label="Phone" hint="In case we need to reach you on the day.">
                  <Input type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} required maxLength={32} autoComplete="tel" inputMode="tel" />
                </Field>
                {needsCompany ? (
                  <Field label="Company">
                    <Input value={f.company} onChange={(e) => set("company", e.target.value)} required maxLength={160} autoComplete="organization" />
                  </Field>
                ) : null}
              </div>
              <Field label="Anything we should know? (optional)" hint={`${f.message.length}/1000`}>
                <Textarea
                  value={f.message}
                  onChange={(e) => set("message", e.target.value)}
                  maxLength={1000}
                  placeholder={purpose === "WHOLESALE" ? "Your stores, the lines you’re interested in, rough volumes…" : "Accessibility needs, an occasion, questions…"}
                />
              </Field>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="max-w-2xl">
              <dl className="divide-y divide-line border-y border-line">
                {summary.map(([k, v]) => (
                  <div key={k} className="grid gap-1 py-4 sm:grid-cols-[10rem_1fr] sm:gap-6">
                    <dt className="text-[0.625rem] uppercase tracking-[0.24em] text-subtle">{k}</dt>
                    <dd className="whitespace-pre-line break-words text-fg">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-6 text-sm text-muted">
                {instant
                  ? "Your visit will be confirmed straight away, and your visitor pass emailed to you."
                  : "We’ll confirm your visit by email, usually within one working day. Your places are held meanwhile."}
              </p>
            </div>
          ) : null}

          <div className="mt-12 flex flex-wrap items-center gap-4">
            {step > 0 ? (
              <Button type="button" variant="outline" onClick={() => go(step - 1)} disabled={pending}>
                Back
              </Button>
            ) : null}
            {step > 0 && step < 4 ? (
              <Button type="button" onClick={() => go(step + 1)} disabled={!canNext}>
                Continue
              </Button>
            ) : null}
            {step === 4 ? (
              <Button type="button" size="lg" onClick={submit} disabled={pending}>
                {pending ? "Booking…" : instant ? "Confirm my visit" : "Request my visit"}
              </Button>
            ) : null}
          </div>
        </motion.section>
      </AnimatePresence>
    </div>
  );
}
