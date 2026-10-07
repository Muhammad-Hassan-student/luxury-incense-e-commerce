import Link from "next/link";
import { Download, Upload } from "lucide-react";
import { Badge, Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { StockAdjust } from "@/components/admin/stock-adjust";
import { InventoryTabs, hiddenTabs } from "@/components/admin/inventory/tabs";
import { VariantSettingsForm } from "@/components/admin/inventory/variant-settings-form";
import { Empty, Kpi, PageHeader, Pagination, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { db } from "@/server/db";
import { can, requirePermission } from "@/server/roles";
import { getSettings } from "@/server/settings";
import { STOCK_FILTERS, stockKpis, stockRows, type StockFilter } from "@/server/stock-report";
import { formatMoney } from "@/lib/money";
import { param, parsePage } from "@/lib/admin-queries";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inventory" };

const PER_PAGE = 50;
const FILTER_LABEL: Record<StockFilter, string> = { all: "All variants", low: "At/below reorder point", out: "Out of stock", nocost: "Missing cost price" };

export default async function InventoryPage(props: PageProps<"/admin/inventory">) {
  const user = await requirePermission("inventory.view");
  const canAdjust = can(user, "inventory.adjust");
  const sp = await props.searchParams;
  const q = param(sp.q);
  const filterParam = param(sp.filter);
  const filter: StockFilter = (STOCK_FILTERS as readonly string[]).includes(filterParam) ? (filterParam as StockFilter) : "all";
  const supplierId = param(sp.supplier);
  const editId = canAdjust ? param(sp.edit) : "";
  const page = parsePage(sp.page);
  const { lowStockThreshold } = await getSettings();

  const [kpis, rows, suppliers] = await Promise.all([
    stockKpis(lowStockThreshold),
    stockRows({ q, filter, supplierId, threshold: lowStockThreshold }),
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, isActive: true } }),
  ]);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const shown = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const editing = editId
    ? await db.productVariant.findUnique({
        where: { id: editId },
        select: { id: true, sku: true, label: true, costPrice: true, reorderPoint: true, reorderQty: true, barcode: true, supplierId: true, product: { select: { name: true } } },
      })
    : null;

  const query = (over: Record<string, string | number | undefined>) => {
    const s = new URLSearchParams();
    const all = { q, filter: filter === "all" ? "" : filter, supplier: supplierId, page: page > 1 ? page : "", ...over };
    for (const [k, v] of Object.entries(all)) if (v !== undefined && v !== "" && v !== 1) s.set(k, String(v));
    const qs = s.toString();
    return qs ? `/admin/inventory?${qs}` : "/admin/inventory";
  };
  const backHref = query({ edit: undefined });

  return (
    <>
      <PageHeader
        eyebrow="Stock control"
        title="Inventory"
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <a href="/api/admin/export/inventory" download>
                <Download className="size-3.5" aria-hidden /> Export CSV
              </a>
            </Button>
            {canAdjust ? (
              <Button asChild size="sm" variant="outline">
                <Link href="/admin/inventory/import">
                  <Upload className="size-3.5" aria-hidden /> Import CSV
                </Link>
              </Button>
            ) : null}
          </>
        }
      >
        {kpis.variants} stocked variants · default reorder point {lowStockThreshold}
      </PageHeader>
      <InventoryTabs active="stock" hide={hiddenTabs(user)} />

      <div className="mb-8 grid gap-px sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Units on hand" value={kpis.units.toLocaleString("en-IN")} />
        <Kpi
          label="Value at cost"
          value={formatMoney(kpis.costValue)}
          hint={kpis.missingCost ? <Link href={query({ filter: "nocost", page: undefined })} className="hover:text-gold">{kpis.missingCost} variant{kpis.missingCost === 1 ? "" : "s"} without a cost</Link> : "All variants costed"}
        />
        <Kpi label="Retail value" value={formatMoney(kpis.retailValue)} hint={kpis.costValue && kpis.retailValue ? `Cost is ${Math.round((kpis.costValue / kpis.retailValue) * 100)}% of retail (costed only: approximate)` : undefined} />
        <Kpi label="Below reorder point" value={<Link href={query({ filter: "low", page: undefined })} className={kpis.belowReorder ? "text-gold" : undefined}>{kpis.belowReorder}</Link>} hint={<Link href="/admin/purchasing" className="hover:text-gold">Reorder suggestions →</Link>} />
        <Kpi label="Out of stock" value={<Link href={query({ filter: "out", page: undefined })} className={kpis.outOfStock ? "text-ember" : undefined}>{kpis.outOfStock}</Link>} hint="Nothing available to sell" />
      </div>

      {editing ? (
        <Section title={`Stock settings · ${editing.product.name} ${editing.label}`} className="mb-8">
          <VariantSettingsForm
            key={editing.id}
            initial={{ id: editing.id, sku: editing.sku, costPrice: editing.costPrice, reorderPoint: editing.reorderPoint, reorderQty: editing.reorderQty, barcode: editing.barcode, supplierId: editing.supplierId }}
            suppliers={suppliers}
            defaultReorderPoint={lowStockThreshold}
            backHref={backHref}
          />
        </Section>
      ) : null}

      <form method="get" role="search" className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_14rem_14rem_auto] lg:items-end">
        <label className="block">
          <span className="sr-only">Search variants</span>
          <Input type="search" name="q" defaultValue={q} placeholder="Search product, SKU, label or barcode" />
        </label>
        <label className="block">
          <span className="sr-only">Stock filter</span>
          <Select name="filter" defaultValue={filter}>
            {STOCK_FILTERS.map((f) => (
              <option key={f} value={f}>
                {FILTER_LABEL[f]}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="sr-only">Supplier</span>
          <Select name="supplier" defaultValue={supplierId}>
            <option value="">Any supplier</option>
            <option value="none">No supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" size="sm" variant="outline">
          Filter
        </Button>
      </form>

      <Section title={`${FILTER_LABEL[filter]} · ${rows.length}`} className="mb-8">
        {shown.length ? (
          <Table className={canAdjust ? "min-w-[1360px]" : "min-w-[1100px]"}>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>SKU / barcode</Th>
                <Th className="text-right">Stock</Th>
                <Th className="text-right">Reserved</Th>
                <Th className="text-right">Available</Th>
                <Th className="text-right">Reorder at</Th>
                <Th className="text-right">On order</Th>
                <Th className="text-right">Cost</Th>
                <Th>Supplier</Th>
                {canAdjust ? <Th>Adjust</Th> : null}
                {canAdjust ? <Th className="sr-only">Settings</Th> : null}
              </tr>
            </thead>
            <tbody>
              {shown.map((v) => (
                <tr key={v.id} className={cn(v.id === editId && "bg-gold/5")}>
                  <Td className="whitespace-nowrap">
                    <Link href={`/admin/products/${v.product.id}`} className={linkClass}>
                      {v.product.name}
                    </Link>
                    <span className="block text-xs text-subtle">{v.label}</span>
                    {!v.product.isActive ? (
                      <Badge tone="muted" className="ml-2">
                        Hidden
                      </Badge>
                    ) : null}
                    {v.isGiftCard ? (
                      <Badge tone="muted" className="ml-2">
                        Digital
                      </Badge>
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap font-mono text-[0.6875rem] text-muted">
                    {v.sku}
                    {v.barcode ? <span className="block text-subtle">{v.barcode}</span> : null}
                  </Td>
                  <Td className="text-right tabular-nums">{v.stock}</Td>
                  <Td className="text-right tabular-nums text-muted">{v.reserved}</Td>
                  <Td className={cn("text-right tabular-nums", v.isGiftCard ? undefined : v.out ? "text-ember" : v.low ? "text-gold" : undefined)}>{v.available}</Td>
                  <Td className={cn("text-right tabular-nums", v.reorderPointIsDefault ? "text-subtle" : "text-muted")} title={v.reorderPointIsDefault ? "Store default" : undefined}>
                    {v.reorderPoint}
                    {v.reorderQty ? <span className="block text-xs text-subtle">qty {v.reorderQty}</span> : null}
                  </Td>
                  <Td className={cn("text-right tabular-nums", v.onOrder ? "text-gold" : "text-subtle")}>{v.onOrder || "—"}</Td>
                  <Td className="text-right tabular-nums text-muted">{v.costPrice === null ? <span className="text-subtle">—</span> : formatMoney(v.costPrice)}</Td>
                  <Td className="text-xs text-muted">{v.supplier ? <Link href={`/admin/suppliers/${v.supplier.id}`} className={linkClass}>{v.supplier.name}</Link> : "—"}</Td>
                  {canAdjust ? (
                    <Td>
                      <StockAdjust variantId={v.id} sku={v.sku} stock={v.stock} reserved={v.reserved} />
                    </Td>
                  ) : null}
                  {canAdjust ? (
                    <Td className="text-right">
                      <Link href={query({ edit: v.id })} scroll className="text-xs uppercase tracking-[0.18em] text-muted hover:text-gold" aria-label={`Edit stock settings for ${v.sku}`}>
                        Edit
                      </Link>
                    </Td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No variants match.</Empty>
        )}
        <Pagination page={page} pages={pages} href={(p) => query({ page: p })} />
      </Section>

      <p className="text-sm text-muted">
        <Link href="/admin/inventory/movements" className={linkClass}>
          See all stock movements
        </Link>
      </p>
    </>
  );
}
