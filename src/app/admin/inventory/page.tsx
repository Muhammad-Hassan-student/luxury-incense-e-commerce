import Link from "next/link";
import { Badge, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { StockAdjust } from "@/components/admin/stock-adjust";
import { Empty, PageHeader, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { db } from "@/server/db";
import { hasRole, requireRole } from "@/server/roles";
import { getSettings } from "@/server/settings";
import { fmtDateTime } from "@/lib/admin-shared";
import { param } from "@/lib/admin-queries";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inventory" };

export default async function InventoryPage(props: PageProps<"/admin/inventory">) {
  const user = await requireRole("SUPPORT");
  const canEdit = hasRole(user.role, "MANAGER");
  const sp = await props.searchParams;
  const q = param(sp.q);
  const lowOnly = param(sp.low) === "1";
  const { lowStockThreshold } = await getSettings();

  const [variants, logs] = await Promise.all([
    db.productVariant.findMany({
      where: q
        ? { OR: [{ sku: { contains: q, mode: "insensitive" } }, { label: { contains: q, mode: "insensitive" } }, { product: { name: { contains: q, mode: "insensitive" } } }] }
        : undefined,
      orderBy: [{ product: { name: "asc" } }, { position: "asc" }],
      select: { id: true, sku: true, label: true, stock: true, reserved: true, product: { select: { id: true, name: true, isActive: true } } },
    }),
    db.inventoryLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, delta: true, reason: true, orderId: true, actorId: true, createdAt: true, variant: { select: { sku: true, product: { select: { name: true } } } } },
    }),
  ]);

  const rows = lowOnly ? variants.filter((v) => v.stock - v.reserved <= lowStockThreshold) : variants;
  const actorIds = [...new Set(logs.map((l) => l.actorId).filter((x): x is string => Boolean(x)))];
  const actors = actorIds.length ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } }) : [];
  const actorEmail = new Map(actors.map((a) => [a.id, a.email]));
  const totals = variants.reduce((t, v) => ({ stock: t.stock + v.stock, reserved: t.reserved + v.reserved }), { stock: 0, reserved: 0 });

  return (
    <>
      <PageHeader eyebrow="Stock" title="Inventory">
        {variants.length} variants · {totals.stock} on hand · {totals.reserved} held for pending orders
      </PageHeader>

      <form method="get" role="search" className="mb-6 flex flex-wrap items-end gap-4">
        <label className="block min-w-60 flex-1">
          <span className="sr-only">Search variants</span>
          <Input type="search" name="q" defaultValue={q} placeholder="Search by product, SKU or label" />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" name="low" value="1" defaultChecked={lowOnly} className="size-4 accent-[var(--gold)]" />
          Low stock only (≤ {lowStockThreshold})
        </label>
        <Button type="submit" size="sm" variant="outline">
          Filter
        </Button>
      </form>

      <Section title="Variants" className="mb-8">
        {rows.length ? (
          <Table className={canEdit ? "min-w-[860px]" : undefined}>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>SKU</Th>
                <Th className="text-right">Stock</Th>
                <Th className="text-right">Reserved</Th>
                <Th className="text-right">Available</Th>
                {canEdit ? <Th>Adjust</Th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const free = v.stock - v.reserved;
                const low = free <= lowStockThreshold;
                return (
                  <tr key={v.id}>
                    <Td>
                      <Link href={`/admin/products/${v.product.id}`} className={linkClass}>
                        {v.product.name}
                      </Link>
                      <span className="ml-2 text-xs text-subtle">{v.label}</span>
                      {!v.product.isActive ? (
                        <Badge tone="muted" className="ml-2">
                          Hidden
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="font-mono text-xs text-muted">{v.sku}</Td>
                    <Td className="text-right tabular-nums">{v.stock}</Td>
                    <Td className="text-right tabular-nums text-muted">{v.reserved}</Td>
                    <Td className={cn("text-right tabular-nums", free <= 0 ? "text-ember" : low ? "text-gold" : undefined)}>{free}</Td>
                    {canEdit ? (
                      <Td>
                        <StockAdjust variantId={v.id} sku={v.sku} />
                      </Td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <Empty>No variants match.</Empty>
        )}
      </Section>

      <Section title="Recent movements">
        {logs.length ? (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Variant</Th>
                <Th>Reason</Th>
                <Th className="text-right">Δ</Th>
                <Th>By / order</Th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <Td className="whitespace-nowrap text-muted">{fmtDateTime(l.createdAt)}</Td>
                  <Td>
                    {l.variant.product.name} <span className="font-mono text-xs text-subtle">{l.variant.sku}</span>
                  </Td>
                  <Td>
                    <Badge tone={l.reason === "SALE" || l.reason === "RESERVE" ? "muted" : "gold"}>{l.reason.toLowerCase()}</Badge>
                  </Td>
                  <Td className={cn("text-right tabular-nums", l.delta < 0 ? "text-ember" : l.delta > 0 ? "text-gold" : "text-subtle")}>
                    {l.delta > 0 ? `+${l.delta}` : l.delta}
                  </Td>
                  <Td className="text-xs text-muted">
                    {l.orderId ? (
                      <Link href={`/admin/orders/${l.orderId}`} className={linkClass}>
                        order
                      </Link>
                    ) : l.actorId ? (
                      (actorEmail.get(l.actorId) ?? "staff")
                    ) : (
                      "system"
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No stock movements yet.</Empty>
        )}
      </Section>
    </>
  );
}
