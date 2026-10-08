"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { saveMonthlyGoal } from "@/actions/admin-dashboard";
import { Button } from "@/components/ui/button";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { toMajor } from "@/lib/admin-shared";

/** Inline editor for the monthly revenue goal (settings.manage). Amount in ₹; 0 clears it. */
export function GoalEditor({ target }: { target: number }) {
  const { pending, run } = useAdminAction();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(target ? String(toMajor(target)) : "");

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-gold">
        <Pencil className="size-3" aria-hidden /> {target ? "Edit goal" : "Set a monthly goal"}
      </button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveMonthlyGoal({ target: Number(value || 0) }), { onSuccess: () => setOpen(false) });
      }}
    >
      <label className="sr-only" htmlFor="monthly-goal">
        Monthly revenue goal in rupees
      </label>
      <span className="text-sm text-muted" aria-hidden>
        ₹
      </span>
      <input
        id="monthly-goal"
        type="number"
        min={0}
        step={1000}
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        disabled={pending}
        className="h-9 w-32 border-0 border-b border-line-strong bg-transparent text-sm tabular-nums text-fg focus:border-gold focus:outline-none"
      />
      <Button type="submit" size="sm" disabled={pending}>
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}
