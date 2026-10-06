import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { OrderStatus } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/field";
import { statusLabel, statusTone } from "@/lib/admin-shared";
import { cn } from "@/lib/utils";

/** Server-safe presentational primitives for the admin. */

export function PageHeader({ eyebrow, title, actions, children }: { eyebrow?: string; title: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
        <h1 className="font-display text-3xl font-light tracking-tight text-fg sm:text-4xl">{title}</h1>
        {children ? <div className="mt-2 text-sm text-muted">{children}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}

export function Section({ title, actions, children, className }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("border border-line bg-bg-elev", className)}>
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
        <h2 className="eyebrow">{title}</h2>
        {actions}
      </div>
      <div>{children}</div>
    </section>
  );
}

export function Table({ className, children, ...props }: ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full min-w-[640px] border-collapse text-left text-sm", className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return <th scope="col" className={cn("border-b border-line px-4 py-3 text-[0.625rem] font-normal uppercase tracking-[0.2em] text-subtle", className)} {...props} />;
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("border-b border-line px-4 py-3 align-middle text-fg", className)} {...props} />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-10 text-center text-sm text-muted">{children}</p>;
}

export function StatusBadge({ status, reservedUntil = null }: { status: OrderStatus; reservedUntil?: Date | null }) {
  return <Badge tone={statusTone(status)}>{statusLabel(status, reservedUntil)}</Badge>;
}

export function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="border border-line bg-bg-elev px-5 py-5">
      <p className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">{label}</p>
      <p className="mt-3 font-display text-3xl font-light tabular-nums text-fg">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Pagination({ page, pages, href }: { page: number; pages: number; href: (page: number) => string }) {
  if (pages <= 1) return null;
  const link = "inline-flex h-9 items-center border border-line px-4 text-[0.6875rem] uppercase tracking-[0.2em] transition-colors hover:border-gold hover:text-gold";
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 px-5 py-4 text-sm text-muted">
      <span>
        Page {page} of {pages}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className={link} href={href(page - 1)} rel="prev">
            Previous
          </Link>
        ) : null}
        {page < pages ? (
          <Link className={link} href={href(page + 1)} rel="next">
            Next
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

export const linkClass = "text-fg underline decoration-line-strong underline-offset-4 transition-colors hover:text-gold hover:decoration-gold";
