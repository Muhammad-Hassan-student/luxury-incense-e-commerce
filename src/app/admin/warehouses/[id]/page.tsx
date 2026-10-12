import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { LocationReorderPoint, MakeDefaultButton, WarehouseForm } from "@/components/admin/warehouses/forms";
import { Empty, Kpi, PageHeader, Pagination, Section, Table, Td, Th } from "@/components/admin/ui";
import { db } from "@/server/db";
import { can, requirePermission } from "@/server/roles";
import { warehouseStockRows } from "@/server/warehouses";
import { param, parsePage } from "@/lib/admin-queries";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PER_PAGE = 50;

export async function generateMetadata(props: PageProps<"/admin/warehouses/[id]">) {
  const { id } = await props.params;
  const w = await db.warehouse.findUnique({ where: { id }, select: { code: true } });
  return { title: w ? `Warehouse ${w.code}` : "Warehouse" };
}

export default async function WarehousePage(props: PageProps<"/admin/warehouses/[id]">) {
  const user = await requirePermission("inventory.view");
  const canAdjust = can(user, "inventory.adjust");
  const { id } = await props.params;
  const sp = await props.searchParams;
  const w = await db.warehouse.findUnique({ where: { id } });
  if (!w) notFound();
  const q = param(sp.q);
  const lowOnly = param(sp.low) === "1";
  const page = parsePage(sp.page);
  const all = await warehouseStockRows(id, { q });
  const rows = lowOnly ? all.filter((r) => r.low && r.active) : all;
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const shown = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const href = (over: Record<string, string | number>) => {
    const s = new URLSearchParams(Object.entries({ q, low: lowOnly ? "1" : "", ...over }).filter(([k, v]) => v !== "" && !(k === "page" && Number(v) === 1)).map(([k, v]) => [k, String(v)]));
    return `/admin/warehouses/${id}${s.size ? `?${s}` : ""}`;
  };

  return (
    <>
      <Link href="/admin/warehouses" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted hover:text-gold">
        <ArrowLeft className="size-3.5" aria-hidden /> Warehouses
      </Link>
      <PageHeader eyebrow={`Warehouse ${w.code}`} title={w.name} actions={canAdjust && !w.isDefault && w.active ? <MakeDefaultButton id={w.id} code={w.code} /> : null}>
        <span className="flex flex-wrap items-center gap-2">
          {w.isDefault ? <Badge>Default</Badge> : null}
          {!w.active ? <Badge tone="muted">Inactive</Badge> : null}
          <span>{[w.address, w.city, w.state, w.pincode].filter(Boolean).join(", ") || "No address yet"}</span>
        </span>
      </PageHeader>

      <div className="mb-8 grid grid-cols-2 gap-px lg:grid-cols-4">
        <Kpi label="Units on hand" value={all.reduce((n, r) => n + r.stock, 0).toLocaleString("en-IN")} />
        <Kpi label="Held for orders" value={all.reduce((n, r) => n + r.reserved, 0)} />
        <Kpi label="SKUs in stock" value={all.filter((r) => r.stock > 0).length} />
        <Kpi label="At / below low level" value={<Link href={href({ low: "1", page: 1 })} className={all.some((r) => r.low && r.active) ? "text-gold" : undefined}>{all.filter((r) => r.low && r.active).length}</Link>} />
      </div>

      {canAdjust ? (
        <Section title="Details" className="mb-8">
          <WarehouseForm
            key={w.updatedAt.toISOString()}
            isDefault={w.isDefault}
            initial={{ id: w.id, code: w.code, name: w.name, address: w.address, city: w.city, state: w.state, pincode: w.pincode, priority: w.priority, pickupLocation: w.pickupLocation, active: w.active }}
          />
        </Section>
      ) : null}

      <form method="get" className="mb-6 grid grid-cols-[1fr_auto] gap-4 sm:max-w-xl">
        <label className="block">
          <span className="sr-only">Search variants</span>
          <Input type="search" name="q" defaultValue={q} placeholder="Search product, SKU or label" />
        </label>
        {lowOnly ? <input type="hidden" name="low" value="1" /> : null}
        <Button type="submit" size="sm" variant="outline">
          Search
        </Button>
      </form>

      <Section title={`${lowOnly ? "Low stock" : "Stock"} here · ${rows.length}`} actions={lowOnly ? <Link href={href({ low: "", page: 1 })} className="text-xs uppercase tracking-[0.18em] text-muted hover:text-gold">Show all</Link> : null}>
        {shown.length ? (
          <Table className="min-w-[720px]">
            <thead>
              <tr>
                <Th>Variant</Th>
                <Th className="text-right">On hand</Th>
                <Th className="text-right">Held</Th>
                <Th className="text-right">Available</Th>
                <Th className="text-right">Low at</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.variantId}>
                  <Td>
                    {r.product} <span className="text-xs text-subtle">{r.label}</span>
                    <span className="block font-mono text-[0.6875rem] text-subtle">{r.sku}</span>
                  </Td>
                  <Td className="text-right tabular-nums">{r.stock}</Td>
                  <Td className="text-right tabular-nums text-muted">{r.reserved}</Td>
                  <Td className={cn("text-right tabular-nums", r.available <= 0 ? "text-ember" : r.low ? "text-gold" : undefined)}>{r.available}</Td>
                  <Td className="text-right">
                    {canAdjust ? <LocationReorderPoint warehouseId={id} variantId={r.variantId} sku={r.sku} value={r.ownReorderPoint} placeholder={r.reorderPoint} /> : <span className="tabular-nums">{r.reorderPoint}</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>{lowOnly ? "Nothing is low here." : "No variants match."}</Empty>
        )}
        <Pagination page={page} pages={pages} href={(p) => href({ page: p })} />
      </Section>
    </>
  );
}
