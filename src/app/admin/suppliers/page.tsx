import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { InventoryTabs, hiddenTabs } from "@/components/admin/inventory/tabs";
import { SupplierForm } from "@/components/admin/inventory/supplier-form";
import { Empty, PageHeader, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { db } from "@/server/db";
import { can, requirePermission } from "@/server/roles";
import { supplierSpend } from "@/server/purchasing";
import { formatMoney } from "@/lib/money";
import { param } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suppliers" };

export default async function SuppliersPage(props: PageProps<"/admin/suppliers">) {
  const user = await requirePermission("purchasing.manage");
  const canManage = can(user, "purchasing.manage");
  const sp = await props.searchParams;
  const creating = canManage && param(sp.new) === "1";
  const editId = canManage ? param(sp.edit) : "";

  const [suppliers, spend] = await Promise.all([
    db.supplier.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: { _count: { select: { variants: true, orders: { where: { status: { in: ["ORDERED", "PARTIAL"] } } } } } },
    }),
    supplierSpend(),
  ]);
  const editing = editId ? suppliers.find((s) => s.id === editId) : undefined;

  return (
    <>
      <PageHeader
        eyebrow="Purchasing"
        title="Suppliers"
        actions={
          canManage && !creating && !editing ? (
            <Button asChild size="sm">
              <Link href="/admin/suppliers?new=1">
                <Plus className="size-3.5" aria-hidden /> New supplier
              </Link>
            </Button>
          ) : null
        }
      >
        {suppliers.filter((s) => s.isActive).length} active of {suppliers.length}
      </PageHeader>
      <InventoryTabs active="suppliers" hide={hiddenTabs(user)} />

      {creating || editing ? (
        <Section title={editing ? `Edit ${editing.name}` : "New supplier"} className="mb-8">
          <SupplierForm key={editing?.id ?? "new"} initial={editing} backHref="/admin/suppliers" />
        </Section>
      ) : null}

      <Section title="All suppliers">
        {suppliers.length ? (
          <Table className="min-w-[860px]">
            <thead>
              <tr>
                <Th>Supplier</Th>
                <Th>Contact</Th>
                <Th className="text-right">Lead time</Th>
                <Th className="text-right">Products</Th>
                <Th className="text-right">Open POs</Th>
                <Th className="text-right">Total spend</Th>
                <Th>Status</Th>
                {canManage ? <Th className="sr-only">Edit</Th> : null}
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <Link href={`/admin/suppliers/${s.id}`} className={linkClass}>
                      {s.name}
                    </Link>
                  </Td>
                  <Td className="text-xs text-muted">
                    {s.contactName ?? "—"}
                    {s.email ? <span className="block">{s.email}</span> : null}
                    {s.phone ? <span className="block">{s.phone}</span> : null}
                  </Td>
                  <Td className="text-right tabular-nums text-muted">{s.leadTimeDays} d</Td>
                  <Td className="text-right tabular-nums">{s._count.variants}</Td>
                  <Td className="text-right tabular-nums">{s._count.orders || "—"}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(spend.get(s.id) ?? 0)}</Td>
                  <Td>
                    <Badge tone={s.isActive ? "gold" : "muted"}>{s.isActive ? "Active" : "Inactive"}</Badge>
                  </Td>
                  {canManage ? (
                    <Td className="text-right">
                      <Link href={`/admin/suppliers?edit=${s.id}`} className="text-xs uppercase tracking-[0.18em] text-muted hover:text-gold" aria-label={`Edit ${s.name}`}>
                        Edit
                      </Link>
                    </Td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No suppliers yet.{canManage ? " Add the houses you buy from to start raising purchase orders." : ""}</Empty>
        )}
      </Section>
    </>
  );
}
