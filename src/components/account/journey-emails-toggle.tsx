"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { setMyJourneyEmails } from "@/actions/marketing";
import { cn } from "@/lib/utils";

export function JourneyEmailsToggle({ allowed }: { allowed: boolean }) {
  const [pending, start] = useTransition();
  const [on, setOn] = useOptimistic(allowed);
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-4 text-xs uppercase tracking-[0.2em] text-muted">
      {on ? "On" : "Off"}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Journey emails"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setOn(!on);
            const r = await setMyJourneyEmails(!on);
            if (r.ok) toast.success(r.message);
            else toast.error(r.error);
          })
        }
        className={cn(
          "relative inline-flex h-6 w-11 items-center border transition-colors duration-300 disabled:opacity-60",
          on ? "border-gold bg-gold/20" : "border-line-strong bg-transparent",
        )}
      >
        <span className={cn("absolute size-4 transition-transform duration-300", on ? "translate-x-[1.375rem] bg-gold" : "translate-x-[0.2rem] bg-subtle")} />
      </button>
    </label>
  );
}
