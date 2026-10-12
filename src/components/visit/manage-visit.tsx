"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Printer } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { cancelVisitByToken, rescheduleVisitByToken } from "@/actions/visits";
import { Button } from "@/components/ui/button";
import { useIntlLocale } from "@/i18n/format";
import { type DayAvailability } from "@/server/visit-schedule";
import { fmtClockIn, fmtDayLabelIn } from "./format";
import { SlotPicker } from "./slot-picker";
import { VisitCalendar } from "./visit-calendar";

/** Visitor self-service actions on /visit/[token]: print, add to calendar, reschedule, cancel. */
export function ManageVisit({
  token,
  canChange,
  days,
  today,
  groupSize,
  slotMinutes,
  willAutoConfirm,
  showCalendar,
}: {
  token: string;
  canChange: boolean;
  days: DayAvailability[];
  today: string;
  groupSize: number;
  slotMinutes: number;
  willAutoConfirm: boolean;
  showCalendar: boolean;
}) {
  const t = useTranslations("visit.manage");
  const intl = useIntlLocale();
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "move" | "cancel">("idle");
  const [day, setDay] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const slotLabel = useId();
  const openDays = days.filter((d) => d.slots.some((s) => s.remaining >= groupSize));
  const dayData = days.find((d) => d.day === day);
  const chosen = dayData?.slots.find((s) => s.startsAt === startsAt);

  const linkBtn =
    "inline-flex h-12 items-center gap-3 border border-line-strong px-6 text-[0.6875rem] uppercase tracking-[0.28em] text-fg transition-colors duration-500 hover:border-gold hover:text-gold";

  return (
    <div className="visit-noprint space-y-10">
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => window.print()} className={linkBtn}>
          <Printer className="size-3.5" aria-hidden /> {t("print")}
        </button>
        {showCalendar ? (
          <a href={`/api/visits/${token}/ics`} className={linkBtn} download>
            <CalendarPlus className="size-3.5" aria-hidden /> {t("addToCalendar")}
          </a>
        ) : null}
        {canChange && mode === "idle" ? (
          <>
            <Button type="button" variant="outline" onClick={() => setMode("move")}>
              {t("change")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("cancel")}>
              {t("cancel")}
            </Button>
          </>
        ) : null}
      </div>

      {mode === "cancel" ? (
        <div role="alertdialog" aria-labelledby="cancel-title" aria-describedby="cancel-desc" className="border border-ember/40 p-6 md:p-8">
          <h3 id="cancel-title" className="font-display text-3xl font-light">
            {t("cancelTitle")}
          </h3>
          <p id="cancel-desc" className="mt-3 text-sm text-muted">
            {t("cancelBody")}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              type="button"
              variant="danger"
              autoFocus
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await cancelVisitByToken({ token });
                  if (res.ok) {
                    toast(res.message ?? t("cancelled"));
                    setMode("idle");
                    router.refresh();
                  } else toast.error(res.error);
                })
              }
            >
              {pending ? t("cancelling") : t("yesCancel")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("idle")}>
              {t("keep")}
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "move" ? (
        <section aria-labelledby="move-title" className="border border-line p-6 md:p-10">
          <h3 id="move-title" className="font-display text-3xl font-light">
            {t("moveTitle")}
          </h3>
          <p className="mt-2 text-sm text-muted">
            {willAutoConfirm ? t("moveInstant") : t("moveRequest")}
          </p>
          {openDays.length ? (
            <div className="mt-8 grid gap-10 lg:grid-cols-2">
              <VisitCalendar
                days={openDays}
                today={today}
                selected={day}
                onSelect={(d) => {
                  setDay(d);
                  setStartsAt(null);
                }}
                label={t("chooseNewDate")}
              />
              <div>
                {dayData ? (
                  <>
                    <p id={slotLabel} className="eyebrow mb-4 !text-muted">
                      {fmtDayLabelIn(intl, dayData.day)}
                    </p>
                    <SlotPicker slots={dayData.slots} value={startsAt} onChange={setStartsAt} need={groupSize} labelledBy={slotLabel} durationMins={slotMinutes} />
                  </>
                ) : (
                  <p className="text-sm text-muted">{t("pickDay")}</p>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-6 text-sm text-muted">{t("noRoom")}</p>
          )}
          <div className="mt-10 flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={!chosen || pending}
              onClick={() =>
                chosen &&
                start(async () => {
                  const res = await rescheduleVisitByToken({ token, startsAt: chosen.startsAt });
                  if (res.ok) {
                    toast(res.message ?? t("moved"));
                    setMode("idle");
                    router.refresh();
                  } else toast.error(res.error);
                })
              }
            >
              {pending ? t("saving") : chosen ? t("moveTo", { day: fmtDayLabelIn(intl, day!, { weekday: "short" }), time: fmtClockIn(intl, chosen.time) }) : t("move")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("idle")}>
              {t("neverMind")}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
