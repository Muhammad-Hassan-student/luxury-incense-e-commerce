"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { setMyJourneyEmails } from "@/actions/marketing";
import { cn } from "@/lib/utils";

export function JourneyEmailsToggle({ allowed }: { allowed: boolean }) {
  const t = useTranslations("journeyEmails");
  const [pending, start] = useTransition();
  const [on, setOn] = useOptimistic(allowed);
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-4 text-xs uppercase tracking-[0.2em] text-muted">
      {on ? t("on") : t("off")}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={t("title")}
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
        <span className={cn("absolute start-0 size-4 transition-transform duration-300", on ? "translate-x-[1.375rem] bg-gold rtl:-translate-x-[1.375rem]" : "translate-x-[0.2rem] bg-subtle rtl:-translate-x-[0.2rem]")} />
      </button>
    </label>
  );
}
