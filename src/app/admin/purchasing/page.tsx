import Link from "next/link";
import { Plus } from "lucide-react";
import type { Prisma, PurchaseOrderStatus } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { InventoryTabs, hiddenTabs } from "@/components/admin/inventory/tabs";
import { PO_STATUSES, PO_STATUS_LABEL, PoStatusBadge } from "@/components/admin/inventory/po-status";
import { ReorderDraftButton } from "@/components/admin/inventory/po-forms";
import { Empty, PageHeader, Pagination, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { db } from "@/server/db";
import { can, requirePermission } from "@/server/roles";
import { reorderSuggestions } from "@/server/purchasing";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/admin-shared";
import { param, parsePage } from "@/lib/admin-queries";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Purchasing" };

const PER_PAGE = 25;

export default async function PurchasingPage(props: PageProps<"/admin/purchasing">) {
  const user = await requirePermission("purchasing.manage");
  const canManage = can(user, "purchasing.manage");
  const sp = await props.searchParams;
  const statusParam = param(sp.status);
  const status = (PO_STATUSES as string[]).includes(statusParam) ? (statusParam as PurchaseOrderStatus) : null;
  const openOnly = statusParam === "open";
  const page = parsePage(sp.page);

  const where: Prisma.PurchaseOrderWhereInput = status ? { status } : openOnly ? { status: { in: ["DRAFT", "ORDERED", "PARTIAL"] } } : {};
  const [total, orders, suggestions, counts] = await Promise.all([
    db.purchaseOrder.count({ where }),
    db.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true,
        number: true,
        status: true,
        createdAt: true,
        expectedAt: true,
        supplier: { select: { id: true, name: true } },
        items: { select: { quantity: true, received: true, unitCost: true } },
      },
    }),
    reorderSuggestions(),
    db.purchaseOrder.groupBy({ by: ["status"], _count: true }),
  ]);
  const countOf = new Map(counts.map((c) => [c.status, c._count]));
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const href = (p: number) => {
    const s = new URLSearchParams();
    if (statusParam) s.set("status", statusParam);
    if (p > 1) s.set("page", String(p));
    const qs = s.toString();
    return qs ? `/admin/purchasing?${qs}` : "/admin/purchasing";
  };
  const suggestedLines = suggestions.reduce((n, g) => n + g.lines.length, 0);
  const now = new Date();

  return (
    <>
      <PageHeader
        eyebrow="Stock control"
        title="Purchasing"
        actions={
          canManage ? (
            <Button asChild size="sm">
              <Link href="/admin/purchasing/new">
                <Plus className="size-3.5" aria-hidden /> New purchase order
              </Link>
            </Button>
          ) : null
        }
      >
        {(countOf.get("ORDERED") ?? 0) + (countOf.get("PARTIAL") ?? 0)} open · {countOf.get("DRAFT") ?? 0} draft · {suggestedLines} variant{suggestedLines === 1 ? "" : "s"} to reorder
      </PageHeader>
      <InventoryTabs active="purchasing" hide={hiddenTabs(user)} />

      <Section title="Reorder suggestions" className="mb-8">
        {suggestions.length ? (
          <div className="divide-y divide-line">
            {suggestions.map((g) => (
              <div key={g.supplier?.id ?? "none"}>
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <h3 className="font-display text-xl font-light">
                      {g.supplier ? (
                        <Link href={`/admin/suppliers/${g.supplier.id}`} className="hover:text-gold">
                          {g.supplier.name}
                        </Link>
                      ) : (
                        "No preferred supplier"
                      )}
                    </h3>
                    <p className="text-xs text-muted">
                      {g.lines.length} variant{g.lines.length === 1 ? "" : "s"} · est. {formatMoney(g.total)}
                      {g.lines.some((l) => l.unitCost === null) ? " (some without a cost)" : ""}
                    </p>
                  </div>
                  {canManage && g.supplier?.isActive ? (
                    <ReorderDraftButton supplierId={g.supplier.id} supplierName={g.supplier.name} />
                  ) : g.supplier ? (
                    <span className="text-xs text-subtle">{g.supplier.isActive ? "" : "Supplier inactive"}</span>
                  ) : (
                    <Link href="/admin/inventory?supplier=none&filter=low" className="text-xs uppercase tracking-[0.18em] text-muted hover:text-gold">
                      Assign suppliers →
                    </Link>
                  )}
                </div>
                <Table>
                  <thead>
                    <tr>
                      <Th>Variant</Th>
                      <Th className="text-right">Available</Th>
                      <Th className="text-right">Reorder at</Th>
                      <Th className="text-right">On order</Th>
                      <Th className="text-right">Suggested</Th>
                      <Th className="text-right">Last cost</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.lines.map((l) => (
                      <tr key={l.variantId}>
                        <Td>
                          {l.product} <span className="text-xs text-subtle">{l.label}</span> <span className="font-mono text-xs text-subtle">{l.sku}</span>
                        </Td>
                        <Td className={cn("text-right tabular-nums", l.available <= 0 ? "text-ember" : "text-gold")}>{l.available}</Td>
                        <Td className="text-right tabular-nums text-muted">{l.reorderPoint}</Td>
                        <Td className="text-right tabular-nums text-muted">{l.onOrder || "—"}</Td>
                        <Td className="text-right tabular-nums text-fg">{l.suggested}</Td>
                        <Td className="text-right tabular-nums text-muted">{l.unitCost === null ? "—" : formatMoney(l.unitCost)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ))}
          </div>
        ) : (
          <Empty>Nothing needs reordering. Every variant is above its reorder point or already covered by open orders.</Empty>
        )}
      </Section>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-4">
        <label className="block w-56">
          <span className="sr-only">Status</span>
          <Select name="status" defaultValue={statusParam}>
            <option value="">All purchase orders</option>
            <option value="open">Open (draft, ordered, partial)</option>
            {PO_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PO_STATUS_LABEL[s]} ({countOf.get(s) ?? 0})
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" size="sm" variant="outline">
          Filter
        </Button>
      </form>

      <Section title={`Purchase orders · ${total}`}>
        {orders.length ? (
          <Table className="min-w-[760px]">
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Supplier</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th>Expected</Th>
                <Th className="text-right">Units</Th>
                <Th className="text-right">Value</Th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const units = o.items.reduce((t, i) => t + i.quantity, 0);
                const received = o.items.reduce((t, i) => t + i.received, 0);
                const late = o.expectedAt && o.expectedAt < now && (o.status === "ORDERED" || o.status === "PARTIAL");
                return (
                  <tr key={o.id}>
                    <Td>
                      <Link href={`/admin/purchasing/${o.id}`} className={cn(linkClass, "font-mono")}>
                        {o.number}
                      </Link>
                    </Td>
                    <Td>{o.supplier.name}</Td>
                    <Td>
                      <PoStatusBadge status={o.status} />
                    </Td>
                    <Td className="text-muted">{fmtDate(o.createdAt)}</Td>
                    <Td className={late ? "text-ember" : "text-muted"}>
                      {fmtDate(o.expectedAt)}
                      {late ? <span className="sr-only"> (overdue)</span> : null}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {o.status === "PARTIAL" ? `${received} / ` : ""}
                      {units}
                    </Td>
                    <Td className="text-right tabular-nums">{formatMoney(o.items.reduce((t, i) => t + i.quantity * i.unitCost, 0))}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <Empty>No purchase orders{status || openOnly ? " with that status" : " yet"}.</Empty>
        )}
        <Pagination page={page} pages={pages} href={href} />
      </Section>
    </>
  );
}
