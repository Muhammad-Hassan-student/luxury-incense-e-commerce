"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DoorOpen, X } from "lucide-react";
import { walkInAction } from "@/actions/admin-create";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { notify } from "@/components/admin/use-admin-action";
import { PURPOSE_INFO, VISIT_PURPOSES, type VisitPurpose } from "@/server/visit-schedule";

const EMPTY = { name: "", groupSize: "1", purpose: "TOUR" as VisitPurpose, phone: "", email: "" };

/** Reception: someone at the gate without a booking. Records the visit against the running slot and checks them in. */
export function WalkInButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [f, setF] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="h-11" onClick={() => setOpen(true)}>
        <DoorOpen className="size-4" aria-hidden /> Walk-in
      </Button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-6"
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      onClick={(e) => e.target === e.currentTarget && setOpen(false)}
    >
    <form
      role="dialog"
      aria-modal="true"
      className="max-h-[90dvh] w-full overflow-y-auto border-t border-gold/40 bg-bg-elev p-5 shadow-[var(--shadow)] sm:w-[34rem] sm:border sm:p-6"
      aria-label="Check in a walk-in visitor"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          try {
            const res = await walkInAction({ ...f, groupSize: Math.floor(Number(f.groupSize) || 0) });
            if (res.ok) {
              notify.success(res.message);
              setF(EMPTY);
              setErrors({});
              setOpen(false);
              router.refresh();
            } else {
              setErrors(res.fieldErrors ?? {});
              notify.error(res.error);
            }
          } catch (err) {
            if (err && typeof err === "object" && "digest" in err) throw err;
            notify.error("Something went wrong. Please try again.");
          }
        });
      }}
    >
      <div className="mb-4 flex items-center justify-between">
        <p className="eyebrow">Walk-in · check in now</p>
        <button type="button" onClick={() => setOpen(false)} className="text-muted hover:text-gold" aria-label="Close walk-in form">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <Field label="Name" error={errors.name} className="sm:col-span-2">
          <Input value={f.name} onChange={set("name")} required minLength={2} maxLength={120} autoFocus disabled={pending} aria-invalid={Boolean(errors.name) || undefined} />
        </Field>
        <Field label="Party size" error={errors.groupSize}>
          <Input value={f.groupSize} onChange={set("groupSize")} type="number" min={1} max={500} inputMode="numeric" required disabled={pending} />
        </Field>
        <Field label="Purpose">
          <Select value={f.purpose} onChange={set("purpose")} disabled={pending}>
            {VISIT_PURPOSES.map((p) => (
              <option key={p} value={p}>
                {PURPOSE_INFO[p].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Phone (optional)" error={errors.phone}>
          <Input value={f.phone} onChange={set("phone")} type="tel" maxLength={32} disabled={pending} />
        </Field>
        <Field label="Email (optional)" error={errors.email}>
          <Input value={f.email} onChange={set("email")} type="email" maxLength={200} disabled={pending} />
        </Field>
      </div>
      <div className="mt-6 flex gap-3">
        <Button type="submit" size="sm" disabled={pending || f.name.trim().length < 2}>
          {pending ? "Checking in…" : "Check in now"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
    </div>
  );
}
