import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PoStatusBadge } from "@/components/admin/inventory/po-status";
import { DraftLines, PoDetailsForm, PoLineAdder, PoReceiveForm, PoStatusActions } from "@/components/admin/inventory/po-forms";
import { Empty, PageHeader, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { db } from "@/server/db";
import { can, requirePermission } from "@/server/roles";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/admin-shared";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/admin/purchasing/[id]">) {
  const { id } = await props.params;
  const po = await db.purchaseOrder.findUnique({ where: { id }, select: { number: true } });
  return { title: po ? po.number : "Purchase order" };
}

export default async function PurchaseOrderPage(props: PageProps<"/admin/purchasing/[id]">) {
  const user = await requirePermission("purchasing.manage");
  const canManage = can(user, "purchasing.manage");
  const { id } = await props.params;
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, email: true, leadTimeDays: true } },
      createdBy: { select: { email: true, name: true } },
      items: {
        orderBy: { variant: { sku: "asc" } },
        include: { variant: { select: { sku: true, label: true, product: { select: { name: true } } } } },
      },
    },
  });
  if (!po) notFound();

  const receipts = await db.auditLog.findMany({
    where: { entity: "PurchaseOrder", entityId: po.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, action: true, createdAt: true, actor: { select: { email: true } } },
  });

  const items = po.items.map((i) => ({ id: i.id, sku: i.variant.sku, product: i.variant.product.name, label: i.variant.label, quantity: i.quantity, received: i.received, unitCost: i.unitCost }));
  const total = items.reduce((t, i) => t + i.quantity * i.unitCost, 0);
  const receivedValue = items.reduce((t, i) => t + i.received * i.unitCost, 0);
  const units = items.reduce((t, i) => t + i.quantity, 0);
  const isDraft = po.status === "DRAFT";
  const receivable = po.status === "ORDERED" || po.status === "PARTIAL";

  return (
    <>
      <Link href="/admin/purchasing" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted hover:text-gold">
        <ArrowLeft className="size-3.5" aria-hidden /> Purchasing
      </Link>
      <PageHeader
        eyebrow={`Purchase order · ${po.supplier.name}`}
        title={po.number}
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link href={`/admin/purchasing/${po.id}/print`} target="_blank">
                <Printer className="size-3.5" aria-hidden /> Print
              </Link>
            </Button>
            {canManage ? <PoStatusActions poId={po.id} number={po.number} canOrder={isDraft && items.length > 0} canCancel={po.status === "DRAFT" || po.status === "ORDERED"} /> : null}
          </>
        }
      >
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <PoStatusBadge status={po.status} />
          <span>
            Supplier{" "}
            <Link href={`/admin/suppliers/${po.supplier.id}`} className={linkClass}>
              {po.supplier.name}
            </Link>
          </span>
          <span>Created {fmtDate(po.createdAt)} by {po.createdBy.name ?? po.createdBy.email}</span>
          {po.orderedAt ? <span>Ordered {fmtDate(po.orderedAt)}</span> : null}
          {po.receivedAt ? <span>Received {fmtDate(po.receivedAt)}</span> : null}
        </span>
      </PageHeader>

      <div className="mb-8 grid gap-px sm:grid-cols-3">
        <div className="border border-line bg-bg-elev px-5 py-5">
          <p className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">Order value</p>
          <p className="mt-3 font-display text-3xl font-light tabular-nums">{formatMoney(total)}</p>
          <p className="mt-1 text-xs text-muted">
            {items.length} line{items.length === 1 ? "" : "s"} · {units} units
          </p>
        </div>
        <div className="border border-line bg-bg-elev px-5 py-5">
          <p className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">Received</p>
          <p className="mt-3 font-display text-3xl font-light tabular-nums">{formatMoney(receivedValue)}</p>
          <p className="mt-1 text-xs text-muted">{items.reduce((t, i) => t + i.received, 0)} units in</p>
        </div>
        <div className="border border-line bg-bg-elev px-5 py-5">
          <p className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">Expected</p>
          <p className="mt-3 font-display text-3xl font-light">{fmtDate(po.expectedAt)}</p>
          <p className="mt-1 text-xs text-muted">Lead time {po.supplier.leadTimeDays} days</p>
        </div>
      </div>

      {isDraft && canManage ? (
        <>
          <Section title="Lines" className="mb-8">
            <DraftLines items={items} />
            <div className="border-t border-line">
              <PoLineAdder poId={po.id} supplierId={po.supplier.id} />
            </div>
          </Section>
        </>
      ) : receivable && canManage ? (
        <Section title="Receive goods" className="mb-8">
          <PoReceiveForm poId={po.id} items={items} />
        </Section>
      ) : (
        <Section title="Lines" className="mb-8">
          {items.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Variant</Th>
                  <Th className="text-right">Ordered</Th>
                  <Th className="text-right">Received</Th>
                  <Th className="text-right">Unit cost</Th>
                  <Th className="text-right">Line total</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <Td>
                      {i.product} <span className="text-xs text-subtle">{i.label}</span>
                      <span className="block font-mono text-xs text-subtle">{i.sku}</span>
                    </Td>
                    <Td className="text-right tabular-nums">{i.quantity}</Td>
                    <Td className={cn("text-right tabular-nums", i.received < i.quantity ? "text-gold" : "text-muted")}>{i.received}</Td>
                    <Td className="text-right tabular-nums text-muted">{formatMoney(i.unitCost)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(i.quantity * i.unitCost)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty>No lines.</Empty>
          )}
        </Section>
      )}

      <Section title="Details" className="mb-8">
        <PoDetailsForm poId={po.id} notes={po.notes} expectedAt={po.expectedAt} readOnly={!canManage || po.status === "CANCELLED" || po.status === "RECEIVED"} />
      </Section>

      <Section title="History">
        {receipts.length ? (
          <ul className="divide-y divide-line text-sm">
            {receipts.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 px-5 py-3">
                <span>{r.action.replace(/^po\./, "").replace(/\./g, " ")}</span>
                <span className="text-xs text-muted">
                  {r.actor.email} · {fmtDateTime(r.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No activity recorded.</Empty>
        )}
      </Section>
    </>
  );
}
