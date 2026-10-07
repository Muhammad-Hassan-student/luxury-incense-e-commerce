"use client";

import { useRef, type KeyboardEvent } from "react";
import { fmtClock, type SlotAvailability } from "@/server/visit-schedule";
import { cn } from "@/lib/utils";

/**
 * Radio group of time slots with remaining places. Arrow keys move between open slots; full slots are announced but skipped.
 * `need` greys out slots that can't fit the party (when the size is already known, e.g. rescheduling).
 */
export function SlotPicker({
  slots,
  value,
  onChange,
  need = 1,
  labelledBy,
  durationMins,
}: {
  slots: SlotAvailability[];
  value: string | null;
  onChange: (startsAt: string) => void;
  need?: number;
  labelledBy?: string;
  durationMins?: number;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const fits = (s: SlotAvailability) => s.remaining >= need;
  const openIdx = slots.map((s, i) => (fits(s) ? i : -1)).filter((i) => i >= 0);
  const selIdx = slots.findIndex((s) => s.startsAt === value);
  const tabIdx = selIdx >= 0 && fits(slots[selIdx]!) ? selIdx : (openIdx[0] ?? -1);

  function onKey(e: KeyboardEvent, i: number) {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir || !openIdx.length) return;
    e.preventDefault();
    const pos = openIdx.indexOf(i);
    const next = openIdx[(pos + dir + openIdx.length) % openIdx.length]!;
    refs.current[next]?.focus();
    onChange(slots[next]!.startsAt);
  }

  if (!slots.length) return <p className="text-sm text-muted">No visiting times on this day.</p>;

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid gap-3 sm:grid-cols-3">
      {slots.map((s, i) => {
        const ok = fits(s);
        const checked = s.startsAt === value;
        const left = s.remaining === 0 ? "Fully booked" : `${s.remaining} place${s.remaining === 1 ? "" : "s"} left`;
        return (
          <button
            key={s.startsAt}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={!ok}
            tabIndex={i === tabIdx ? 0 : -1}
            onClick={() => ok && onChange(s.startsAt)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "group flex min-h-24 flex-col items-start justify-between border px-5 py-4 text-left transition-colors duration-500 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-gold",
              checked ? "border-gold bg-bg-elev" : ok ? "border-line hover:border-line-strong" : "cursor-not-allowed border-line opacity-40",
            )}
          >
            <span className={cn("font-display text-3xl font-light tabular-nums", checked ? "text-gold" : "text-fg")}>{fmtClock(s.time)}</span>
            <span className="mt-2 flex w-full items-center justify-between gap-3 text-[0.6875rem] uppercase tracking-[0.2em] text-muted">
              <span>{ok || s.remaining === 0 ? left : `${left} · too few`}</span>
              {durationMins ? <span className="text-subtle normal-case tracking-normal">{durationMins} min</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
