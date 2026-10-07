"use client";

import { Check, CircleSlash, Flag, Undo2 } from "lucide-react";
import { setVisitStatusAction } from "@/actions/admin-visits";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAdminAction } from "../use-admin-action";

type Target = "CHECKED_IN" | "NO_SHOW" | "COMPLETED" | "CONFIRMED";

/** Front-desk buttons sized for a tablet: check in, no-show, complete, undo. */
export function ReceptionActions({ id, name, status, size = "lg" }: { id: string; name: string; status: string; size?: "lg" | "sm" }) {
  const { pending, run } = useAdminAction();
  const go = (to: Target) => run(() => setVisitStatusAction({ id, to, notify: false }));
  const big = size === "lg";
  const cls = cn(big && "h-14 min-w-36 px-6");

  if (status === "REQUESTED" || status === "CONFIRMED") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size={big ? "lg" : "sm"} className={cls} disabled={pending} onClick={() => go("CHECKED_IN")} aria-label={`Check in ${name}`}>
          <Check className="size-4" aria-hidden /> Check in
        </Button>
        <Button size={big ? "lg" : "sm"} variant="outline" className={cls} disabled={pending} onClick={() => go("NO_SHOW")} aria-label={`Mark ${name} as no-show`}>
          <CircleSlash className="size-4" aria-hidden /> No-show
        </Button>
      </div>
    );
  }
  if (status === "CHECKED_IN") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size={big ? "lg" : "sm"} className={cls} disabled={pending} onClick={() => go("COMPLETED")} aria-label={`Complete visit for ${name}`}>
          <Flag className="size-4" aria-hidden /> Complete
        </Button>
        <Button size={big ? "lg" : "sm"} variant="ghost" className={cls} disabled={pending} onClick={() => go("CONFIRMED")} aria-label={`Undo check-in for ${name}`}>
          <Undo2 className="size-4" aria-hidden /> Undo
        </Button>
      </div>
    );
  }
  if (status === "NO_SHOW") {
    return (
      <Button size={big ? "lg" : "sm"} variant="outline" className={cls} disabled={pending} onClick={() => go("CHECKED_IN")} aria-label={`${name} arrived late: check in`}>
        <Check className="size-4" aria-hidden /> Arrived late
      </Button>
    );
  }
  return null;
}
