"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { inviteVisitorToTradeAction, rescheduleVisitAction, saveVisitNotesAction, setVisitStatusAction } from "@/actions/admin-visits";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { fmtClock, fmtDayLabel, type DayAvailability } from "@/server/visit-schedule";
import { useAdminAction } from "../use-admin-action";

type Panel = "none" | "decline" | "cancel" | "move";

/** Booking decisions on the visit detail page. Each change emails the visitor and is audited server-side. */
export function VisitDecisionActions({ id, status, groupSize, days }: { id: string; status: string; groupSize: number; days: DayAvailability[] }) {
  const { pending, run } = useAdminAction();
  const [panel, setPanel] = useState<Panel>("none");
  const [reason, setReason] = useState("");
  const [day, setDay] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [override, setOverride] = useState(false);
  const open = status === "REQUESTED" || status === "CONFIRMED";
  const dayData = days.find((d) => d.day === day);
  const slot = dayData?.slots.find((s) => s.startsAt === startsAt);
  const short = slot ? slot.remaining < groupSize : false;
  const reset = () => {
    setPanel("none");
    setReason("");
  };

  if (!open) return <p className="text-sm text-muted">No booking decisions left for this visit.</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        {status === "REQUESTED" ? (
          <Button size="sm" disabled={pending} onClick={() => run(() => setVisitStatusAction({ id, to: "CONFIRMED" }))}>
            Confirm visit
          </Button>
        ) : null}
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setPanel(panel === "move" ? "none" : "move")} aria-expanded={panel === "move"}>
          Reschedule
        </Button>
        {status === "REQUESTED" ? (
          <Button size="sm" variant="danger" disabled={pending} onClick={() => setPanel(panel === "decline" ? "none" : "decline")} aria-expanded={panel === "decline"}>
            Decline
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setPanel(panel === "cancel" ? "none" : "cancel")} aria-expanded={panel === "cancel"}>
          Cancel visit
        </Button>
      </div>

      {panel === "decline" || panel === "cancel" ? (
        <form
          className="space-y-4 border border-line p-5"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => setVisitStatusAction({ id, to: panel === "decline" ? "DECLINED" : "CANCELLED", reason }), { onSuccess: reset });
          }}
        >
          <Field label={panel === "decline" ? "Reason (sent to the visitor)" : "Note to the visitor (optional)"}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={600} required={panel === "decline"} autoFocus />
          </Field>
          <div className="flex gap-3">
            <Button size="sm" variant="danger" type="submit" disabled={pending || (panel === "decline" && !reason.trim())}>
              {panel === "decline" ? "Decline and email" : "Cancel and email"}
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={reset}>
              Back
            </Button>
          </div>
        </form>
      ) : null}

      {panel === "move" ? (
        <form
          className="grid gap-5 border border-line p-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!startsAt) return;
            run(() => rescheduleVisitAction({ id, startsAt, override }), { onSuccess: () => setPanel("none") });
          }}
        >
          <Field label="Day">
            <Select
              value={day}
              onChange={(e) => {
                setDay(e.target.value);
                setStartsAt("");
              }}
              required
            >
              <option value="">Choose…</option>
              {days.map((d) => (
                <option key={d.day} value={d.day}>
                  {fmtDayLabel(d.day, { weekday: "short" })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Time">
            <Select value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required disabled={!dayData}>
              <option value="">Choose…</option>
              {dayData?.slots.map((s) => (
                <option key={s.startsAt} value={s.startsAt}>
                  {fmtClock(s.time)} · {s.remaining} left
                </option>
              ))}
            </Select>
          </Field>
          {short ? (
            <label className="flex items-center gap-3 text-sm text-ember sm:col-span-2">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="size-4 accent-[var(--gold)]" />
              Only {slot?.remaining} places left for a party of {groupSize}. Book over capacity anyway.
            </label>
          ) : null}
          <p className="text-xs text-subtle sm:col-span-2">The visit becomes confirmed at the new time and the visitor is emailed.</p>
          <div className="flex gap-3 sm:col-span-2">
            <Button size="sm" type="submit" disabled={pending || !startsAt || (short && !override)}>
              Move visit
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setPanel("none")}>
              Back
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function VisitNotes({ id, initial }: { id: string; initial: string }) {
  const { pending, run } = useAdminAction();
  const [notes, setNotes] = useState(initial);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveVisitNotesAction({ id, notes }));
      }}
    >
      <Field label="Staff notes" hint="Only staff see these.">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} rows={5} />
      </Field>
      <Button size="sm" type="submit" disabled={pending || notes === initial}>
        Save notes
      </Button>
    </form>
  );
}

export function TradeInvite({ id, email }: { id: string; email: string }) {
  const { pending, run } = useAdminAction();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Email {email} an invitation to open a trade account, with a link to /trade.</p>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => inviteVisitorToTradeAction({ id }))}>
        <Send className="size-3.5" aria-hidden /> Invite to open a trade account
      </Button>
    </div>
  );
}
