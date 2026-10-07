"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, fmtDayLabel, weekdayIndex, type DayAvailability } from "@/server/visit-schedule";
import { cn } from "@/lib/utils";

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEK_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const monthOf = (day: string) => day.slice(0, 7);
function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}
const monthLabel = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(y!, m! - 1, 1)));
};
/** Monday-first column 0–6. */
const col = (day: string) => (weekdayIndex(day) + 6) % 7;

/** 6×7 grid of days (some from adjacent months) for a month. */
function monthGrid(month: string) {
  const first = `${month}-01`;
  const start = addDays(first, -col(first));
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

/**
 * Month calendar following the WAI-ARIA date-grid pattern: one tab stop, arrows move by day/week,
 * Home/End to week edges, PageUp/PageDown by month, Enter/Space selects. Only days with free places are selectable.
 */
export function VisitCalendar({
  days,
  today,
  selected,
  onSelect,
  label = "Choose a date",
}: {
  days: DayAvailability[];
  today: string;
  selected: string | null;
  onSelect: (day: string) => void;
  label?: string;
}) {
  const byDay = useMemo(() => new Map(days.map((d) => [d.day, d])), [days]);
  const firstDay = days[0]?.day ?? today;
  const lastDay = days[days.length - 1]?.day ?? today;
  const minMonth = monthOf(firstDay);
  const maxMonth = monthOf(lastDay);

  const firstOpen = days.find((d) => d.slots.some((s) => s.remaining > 0))?.day ?? firstDay;
  const [focusDay, setFocusDay] = useState(selected ?? firstOpen);
  const [month, setMonth] = useState(monthOf(selected ?? firstOpen));
  const grid = useMemo(() => monthGrid(month), [month]);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const shouldFocus = useRef(false);
  const headingId = useId();

  useEffect(() => {
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    refs.current.get(focusDay)?.focus();
  }, [focusDay, month]);

  const state = (day: string) => {
    const d = byDay.get(day);
    const places = d ? d.slots.reduce((n, s) => n + s.remaining, 0) : 0;
    return { open: Boolean(d) && places > 0, full: Boolean(d) && places === 0, places };
  };

  function moveTo(day: string) {
    // Keep keyboard focus inside the bookable range.
    const clamped = day < `${minMonth}-01` ? `${minMonth}-01` : day > lastDayOfMonth(maxMonth) ? lastDayOfMonth(maxMonth) : day;
    shouldFocus.current = true;
    setFocusDay(clamped);
    if (monthOf(clamped) !== month) setMonth(monthOf(clamped));
  }

  function onKey(e: KeyboardEvent<HTMLButtonElement>, day: string) {
    const map: Record<string, () => string> = {
      ArrowLeft: () => addDays(day, -1),
      ArrowRight: () => addDays(day, 1),
      ArrowUp: () => addDays(day, -7),
      ArrowDown: () => addDays(day, 7),
      Home: () => addDays(day, -col(day)),
      End: () => addDays(day, 6 - col(day)),
      PageUp: () => sameDayIn(day, -1),
      PageDown: () => sameDayIn(day, 1),
    };
    const f = map[e.key];
    if (f) {
      e.preventDefault();
      moveTo(f());
    }
  }

  const canPrev = month > minMonth;
  const canNext = month < maxMonth;
  const navBtn =
    "inline-flex size-11 items-center justify-center border border-line text-fg transition-colors duration-500 hover:border-gold hover:text-gold disabled:pointer-events-none disabled:opacity-25";
  // Roving tab stop: the focused day if it's in view, else the first day of the visible month.
  const tabStop = monthOf(focusDay) === month ? focusDay : `${month}-01`;

  return (
    <div className="select-none">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h3 id={headingId} className="font-display text-3xl font-light text-fg md:text-4xl" aria-live="polite">
          {monthLabel(month)}
        </h3>
        <div className="flex gap-2">
          <button type="button" className={navBtn} onClick={() => setMonth(shiftMonth(month, -1))} disabled={!canPrev} aria-label="Previous month">
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button type="button" className={navBtn} onClick={() => setMonth(shiftMonth(month, 1))} disabled={!canNext} aria-label="Next month">
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <table role="grid" aria-labelledby={headingId} aria-describedby={`${headingId}-hint`} className="w-full table-fixed border-collapse">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {WEEK.map((d, i) => (
              <th key={d} scope="col" abbr={WEEK_LONG[i]} className="pb-3 text-center text-[0.625rem] font-normal uppercase tracking-[0.24em] text-subtle">
                {d.slice(0, 1)}
                <span className="hidden sm:inline">{d.slice(1)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((week) => (
            <tr key={week[0]}>
              {week.map((day) => {
                const inMonth = monthOf(day) === month;
                if (!inMonth) return <td key={day} aria-hidden className="p-0.5" />;
                const { open, full, places } = state(day);
                const isSel = selected === day;
                const isToday = day === today;
                const status = open ? `${places} place${places === 1 ? "" : "s"} available` : full ? "fully booked" : "not available";
                return (
                  <td key={day} className="p-0.5" role="gridcell" aria-selected={isSel}>
                    <button
                      ref={(el) => {
                        if (el) refs.current.set(day, el);
                        else refs.current.delete(day);
                      }}
                      type="button"
                      tabIndex={day === tabStop ? 0 : -1}
                      aria-disabled={!open}
                      aria-current={isToday ? "date" : undefined}
                      aria-label={`${fmtDayLabel(day, { year: true })}, ${status}`}
                      onClick={() => {
                        setFocusDay(day);
                        if (open) onSelect(day);
                      }}
                      onFocus={() => setFocusDay(day)}
                      onKeyDown={(e) => onKey(e, day)}
                      className={cn(
                        "relative flex aspect-square w-full flex-col items-center justify-center gap-1 border text-base transition-colors duration-500 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-gold sm:text-lg",
                        isSel
                          ? "border-gold bg-gold text-bg"
                          : open
                            ? "cursor-pointer border-line text-fg hover:border-gold hover:text-gold"
                            : "cursor-default border-transparent text-subtle/50",
                      )}
                    >
                      <span className={cn("font-display tabular-nums", full && "line-through decoration-1")}>{Number(day.slice(8))}</span>
                      {open ? <span aria-hidden className={cn("size-1 rounded-full", isSel ? "bg-bg" : "bg-gold")} /> : null}
                      {isToday && !isSel ? <span aria-hidden className="absolute inset-x-3 bottom-1 h-px bg-line-strong" /> : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p id={`${headingId}-hint`} className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-subtle">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="size-1 rounded-full bg-gold" /> Places available
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="line-through">14</span> Fully booked
        </span>
        <span className="sr-only">Use the arrow keys to move between days and Enter to choose.</span>
      </p>
    </div>
  );
}

function lastDayOfMonth(month: string) {
  return addDays(`${shiftMonth(month, 1)}-01`, -1);
}

function sameDayIn(day: string, n: number) {
  const target = shiftMonth(monthOf(day), n);
  const last = lastDayOfMonth(target);
  const d = `${target}-${day.slice(8)}`;
  return d > last ? last : d;
}
