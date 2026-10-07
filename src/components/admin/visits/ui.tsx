import Link from "next/link";
import { Badge } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { statusLabel, statusTone, type VisitStatusName } from "@/server/visit-schedule";

/** Server-safe bits shared by the visit admin pages. */

export function VisitStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={statusTone(status as VisitStatusName)} className={className}>
      {statusLabel(status)}
    </Badge>
  );
}

const TABS = [
  { key: "today", label: "Reception", href: "/admin/visits" },
  { key: "week", label: "Next 7 days", href: "/admin/visits?view=week" },
  { key: "list", label: "All visits", href: "/admin/visits?view=list" },
  { key: "settings", label: "Availability", href: "/admin/visits/settings" },
] as const;

export function VisitsTabs({ active, requested }: { active: (typeof TABS)[number]["key"]; requested?: number }) {
  return (
    <nav aria-label="Visits" className="-mt-2 mb-8 flex gap-1 overflow-x-auto border-b border-line no-scrollbar">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex h-12 shrink-0 items-center gap-2 border-b px-4 text-[0.6875rem] uppercase tracking-[0.2em] transition-colors",
            active === t.key ? "border-gold text-fg" : "border-transparent text-muted hover:text-gold",
          )}
        >
          {t.label}
          {t.key === "list" && requested ? (
            <span className="inline-flex min-w-5 items-center justify-center bg-gold px-1.5 text-[0.625rem] tracking-normal text-bg" title="Requests awaiting confirmation">
              {requested}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
