import Link from "next/link";
import { Badge } from "@/components/ui/field";
import { InventoryTabs, hiddenTabs } from "@/components/admin/inventory/tabs";
import { WarehouseForm } from "@/components/admin/warehouses/forms";
import { Empty, Kpi, PageHeader, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { can, requirePermission } from "@/server/roles";
import { inTransitUnits, listWarehouses, lowStockCounts, splitOrders } from "@/server/warehouses";

export const dynamic = "force-dynamic";
export const metadata = { title: "Warehouses" };

export default async function WarehousesPage() {
  const user = await requirePermission("inventory.view");
  const canAdjust = can(user, "inventory.adjust");
  const [list, low, split, transit] = await Promise.all([listWarehouses(), lowStockCounts(), splitOrders(), inTransitUnits()]);
  const active = list.filter((w) => w.active);

  return (
    <>
      <PageHeader eyebrow="Stock control" title="Warehouses">
        Orders ship from the nearest warehouse that can send everything; otherwise they are split. The storefront sells the total across active warehouses.
      </PageHeader>
      <InventoryTabs active="warehouses" hide={hiddenTabs(user)} />

      <div className="mb-8 grid grid-cols-2 gap-px lg:grid-cols-4">
        <Kpi label="Active warehouses" value={active.length} hint={`${list.length - active.length} inactive`} />
        <Kpi label="Units on hand" value={list.reduce((n, w) => n + w.units, 0).toLocaleString("en-IN")} />
        <Kpi label="In transit" value={transit.toLocaleString("en-IN")} hint={<Link href="/admin/transfers" className="hover:text-gold">Transfers →</Link>} />
        <Kpi label="Split orders" value={<span className={split.length ? "text-gold" : undefined}>{split.length}</span>} hint="Open orders held in 2+ warehouses" />
      </div>

      <Section title={`Locations · ${list.length}`} className="mb-8">
        {list.length ? (
          <Table className="min-w-[760px]">
            <thead>
              <tr>
                <Th>Warehouse</Th>
                <Th>Pincode</Th>
                <Th className="text-right">Priority</Th>
                <Th className="text-right">On hand</Th>
                <Th className="text-right">Held</Th>
                <Th className="text-right">Low stock</Th>
                <Th>Pickup</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((w) => (
                <tr key={w.id}>
                  <Td>
                    <Link href={`/admin/warehouses/${w.id}`} className={linkClass}>
                      <span className="font-mono text-xs">{w.code}</span> {w.name}
                    </Link>
                    <span className="ml-2 inline-flex gap-1">
                      {w.isDefault ? <Badge>Default</Badge> : null}
                      {!w.active ? <Badge tone="muted">Inactive</Badge> : null}
                    </span>
                    {w.city ? <span className="block text-xs text-subtle">{[w.city, w.state].filter(Boolean).join(", ")}</span> : null}
                  </Td>
                  <Td className="font-mono text-xs">{w.pincode || "—"}</Td>
                  <Td className="text-right tabular-nums">{w.priority}</Td>
                  <Td className="text-right tabular-nums">{w.units}</Td>
                  <Td className="text-right tabular-nums text-muted">{w.reserved}</Td>
                  <Td className="text-right tabular-nums">
                    {low.get(w.id) ? (
                      <Link href={`/admin/warehouses/${w.id}?low=1`} className="text-gold hover:underline">
                        {low.get(w.id)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="text-xs text-muted">{w.pickupLocation || "Default"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No warehouses.</Empty>
        )}
      </Section>

      {split.length ? (
        <Section title="Split orders — consolidate with a transfer or ship separately" className="mb-8">
          <ul className="divide-y divide-line">
            {split.map((o) => (
              <li key={o.orderId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <Link href={`/admin/orders/${o.orderId}`} className={linkClass}>
                  {o.number}
                </Link>
                <span className="text-xs text-muted">{o.status.toLowerCase()}</span>
                <span className="font-mono text-xs">{o.warehouses.join(" + ")}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {canAdjust ? (
        <Section title="Add a warehouse">
          <WarehouseForm />
        </Section>
      ) : null}
    </>
  );
}
