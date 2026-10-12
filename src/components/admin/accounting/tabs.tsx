import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "overview", href: "/admin/accounting", label: "GST & exports" },
  { key: "reconciliation", href: "/admin/accounting/reconciliation", label: "Payouts" },
  { key: "hsn", href: "/admin/accounting/hsn", label: "HSN codes" },
  { key: "settings", href: "/admin/accounting/settings", label: "Settings" },
] as const;

export type AccountingTab = (typeof TABS)[number]["key"];

/** Secondary navigation for the accounting pages. HSN and settings need accounting.manage. */
export function AccountingTabs({ active, canManage }: { active: AccountingTab; canManage: boolean }) {
  return (
    <nav aria-label="Accounting" className="-mt-4 mb-8 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.filter((t) => canManage || (t.key !== "hsn" && t.key !== "settings")).map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "-mb-px whitespace-nowrap border-b px-4 py-3 text-[0.6875rem] uppercase tracking-[0.2em] transition-colors",
            t.key === active ? "border-gold text-gold" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Exact rupees with paise (accounting screens never round). */
export const money2 = (minor: number) => inr.format(minor / 100);
