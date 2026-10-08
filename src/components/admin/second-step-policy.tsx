"use client";

import { useState } from "react";
import { saveSecondStepPolicy } from "@/actions/admin-security";
import { cn } from "@/lib/utils";
import { useAdminAction } from "./use-admin-action";

const options = [
  { value: "nobody", label: "Nobody", hint: "Members choose for themselves." },
  { value: "staff", label: "All staff", hint: "Owners, managers, support and every custom role, including new roles." },
  { value: "everyone", label: "Everyone", hint: "Every account, customers included." },
] as const;

/** The policy is checked on existing sessions as well as new sign-ins. */
export function SecondStepPolicy({ initial }: { initial: "nobody" | "staff" | "everyone" }) {
  const [value, setValue] = useState(initial);
  const { pending, run } = useAdminAction();
  return (
    <div className="space-y-4 px-5 py-5">
      <p className="text-xs text-subtle">
        Applies to new sign-ins and existing sessions that have not completed a lock check. Members without a saved lock must set one up before continuing. Required locks can’t be switched off.
      </p>
      <div role="radiogroup" aria-label="Require Face ID / phone lock" className="grid gap-3 sm:grid-cols-3">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={pending}
            onClick={() => {
              const prev = value;
              setValue(o.value);
              run(() => saveSecondStepPolicy({ require: o.value }).then((r) => (r.ok ? r : (setValue(prev), r))));
            }}
            className={cn("border p-4 text-start transition-colors", value === o.value ? "border-gold bg-gold/10" : "border-line hover:border-line-strong")}
          >
            <span className="block text-sm text-fg">{o.label}</span>
            <span className="block text-xs text-subtle">{o.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
