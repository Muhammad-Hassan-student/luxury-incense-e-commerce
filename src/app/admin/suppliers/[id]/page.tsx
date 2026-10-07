import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { SupplierActiveButton, SupplierForm } from "@/components/admin/inventory/supplier-form";
import { PoStatusBadge } from "@/components/admin/inventory/po-status";
import { Empty, Kpi, PageHeader, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { db } from "@/server/db";
import { can, requirePermission } from "@/server/roles";
import { onOrderByVariant, supplierSpend } from "@/server/purchasing";
import { getSettings } from "@/server/settings";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/admin-shared";
import { param } from "@/lib/admin-queries";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/admin/suppliers/[id]">) {
  const { id } = await props.params;
  const s = await db.supplier.findUnique({ where: { id }, select: { name: true } });
  return { title: s ? s.name : "Supplier" };
}

export default async function SupplierPage(props: PageProps<"/admin/suppliers/[id]">) {
  const user = await requirePermission("purchasing.manage");
  const canManage = can(user, "purchasing.manage");
  const { id } = await props.params;
  const sp = await props.searchParams;
  const editing = canManage && param(sp.edit) === "1";

  const supplier = await db.supplier.findUnique({
    where: { id },
    include: {
      variants: {
        orderBy: [{ product: { name: "asc" } }, { position: "asc" }],
        select: { id: true, sku: true, label: true, stock: true, reserved: true, costPrice: true, reorderPoint: true, product: { select: { id: true, name: true } } },
      },
      orders: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, number: true, status: true, createdAt: true, expectedAt: true, items: { select: { quantity: true, received: true, unitCost: true } } },
      },
    },
  });
  if (!supplier) notFound();

  const [spend, onOrder, { lowStockThreshold }] = await Promise.all([
    supplierSpend(id),
    onOrderByVariant(db, supplier.variants.map((v) => v.id)),
    getSettings(),
  ]);
  const open = supplier.orders.filter((o) => o.status === "ORDERED" || o.status === "PARTIAL" || o.status === "DRAFT");
  const openValue = open.reduce((t, o) => t + o.items.reduce((s, i) => s + Math.max(0, i.quantity - i.received) * i.unitCost, 0), 0);

  return (
    <>
      <Link href="/admin/suppliers" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted hover:text-gold">
        <ArrowLeft className="size-3.5" aria-hidden /> Suppliers
      </Link>
      <PageHeader
        eyebrow="Supplier"
        title={supplier.name}
        actions={
          canManage ? (
            <>
              {supplier.isActive ? (
                <Button asChild size="sm">
                  <Link href={`/admin/purchasing/new?supplier=${supplier.id}`}>
                    <Plus className="size-3.5" aria-hidden /> New PO
                  </Link>
                </Button>
              ) : null}
              {!editing ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/admin/suppliers/${supplier.id}?edit=1`}>Edit</Link>
                </Button>
              ) : null}
              <SupplierActiveButton id={supplier.id} name={supplier.name} isActive={supplier.isActive} />
            </>
          ) : null
        }
      >
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {!supplier.isActive ? <Badge tone="muted">Inactive</Badge> : null}
          {supplier.contactName ? <span>{supplier.contactName}</span> : null}
          {supplier.email ? (
            <a href={`mailto:${supplier.email}`} className={linkClass}>
              {supplier.email}
            </a>
          ) : null}
          {supplier.phone ? <a href={`tel:${supplier.phone}`}>{supplier.phone}</a> : null}
          <span>Lead time {supplier.leadTimeDays} days</span>
        </span>
      </PageHeader>

      {editing ? (
        <Section title="Edit supplier" className="mb-8">
          <SupplierForm initial={supplier} backHref={`/admin/suppliers/${supplier.id}`} />
        </Section>
      ) : null}

      <div className="mb-8 grid gap-px sm:grid-cols-3">
        <Kpi label="Total spend" value={formatMoney(spend.get(supplier.id) ?? 0)} hint="Value of goods received" />
        <Kpi label="Open POs" value={open.length} hint={openValue ? `${formatMoney(openValue)} still to arrive` : undefined} />
        <Kpi label="Products supplied" value={supplier.variants.length} />
      </div>

      {supplier.notes ? (
        <Section title="Notes" className="mb-8">
          <p className="whitespace-pre-line p-5 text-sm text-muted">{supplier.notes}</p>
        </Section>
      ) : null}

      <Section title="Purchase orders" className="mb-8">
        {supplier.orders.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th>Expected</Th>
                <Th className="text-right">Value</Th>
              </tr>
            </thead>
            <tbody>
              {supplier.orders.map((o) => (
                <tr key={o.id}>
                  <Td>
                    <Link href={`/admin/purchasing/${o.id}`} className={cn(linkClass, "font-mono")}>
                      {o.number}
                    </Link>
                  </Td>
                  <Td>
                    <PoStatusBadge status={o.status} />
                  </Td>
                  <Td className="text-muted">{fmtDate(o.createdAt)}</Td>
                  <Td className="text-muted">{fmtDate(o.expectedAt)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(o.items.reduce((t, i) => t + i.quantity * i.unitCost, 0))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No purchase orders yet.</Empty>
        )}
      </Section>

      <Section title="Products supplied">
        {supplier.variants.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Variant</Th>
                <Th className="text-right">Available</Th>
                <Th className="text-right">Reorder at</Th>
                <Th className="text-right">On order</Th>
                <Th className="text-right">Cost</Th>
              </tr>
            </thead>
            <tbody>
              {supplier.variants.map((v) => {
                const available = v.stock - v.reserved;
                const rp = v.reorderPoint ?? lowStockThreshold;
                return (
                  <tr key={v.id}>
                    <Td>
                      <Link href={`/admin/products/${v.product.id}`} className={linkClass}>
                        {v.product.name}
                      </Link>{" "}
                      <span className="text-xs text-subtle">{v.label}</span> <span className="font-mono text-xs text-subtle">{v.sku}</span>
                    </Td>
                    <Td className={cn("text-right tabular-nums", available <= 0 ? "text-ember" : available <= rp ? "text-gold" : undefined)}>{available}</Td>
                    <Td className="text-right tabular-nums text-muted">{rp}</Td>
                    <Td className="text-right tabular-nums text-muted">{onOrder.get(v.id) || "—"}</Td>
                    <Td className="text-right tabular-nums text-muted">{v.costPrice === null ? "—" : formatMoney(v.costPrice)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <Empty>No variants name this supplier as preferred yet. Set it from Inventory → Edit.</Empty>
        )}
      </Section>
    </>
  );
}
