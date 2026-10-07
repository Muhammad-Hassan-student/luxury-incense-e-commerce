import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "stock", href: "/admin/inventory", label: "Stock" },
  { key: "movements", href: "/admin/inventory/movements", label: "Movements" },
  { key: "import", href: "/admin/inventory/import", label: "Import CSV" },
  { key: "purchasing", href: "/admin/purchasing", label: "Purchasing" },
  { key: "suppliers", href: "/admin/suppliers", label: "Suppliers" },
  { key: "stocktakes", href: "/admin/stocktakes", label: "Stocktakes" },
] as const;

export type InventoryTab = (typeof TABS)[number]["key"];

const NEEDS: Partial<Record<InventoryTab, string>> = {
  import: "inventory.adjust",
  purchasing: "purchasing.manage",
  suppliers: "purchasing.manage",
  stocktakes: "stocktake.manage",
};

/** Tabs to hide for someone with these permissions (mirrors the page gates). */
export function hiddenTabs(user: { permissions: readonly string[] }): InventoryTab[] {
  return (Object.keys(NEEDS) as InventoryTab[]).filter((k) => !user.permissions.includes(NEEDS[k]!));
}

/** Secondary navigation shared by the stock-control pages. Hides tabs the user can't use. */
export function InventoryTabs({ active, hide = [] }: { active: InventoryTab; hide?: InventoryTab[] }) {
  return (
    <nav aria-label="Stock control" className="-mt-4 mb-8 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.filter((t) => !hide.includes(t.key)).map((t) => (
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
