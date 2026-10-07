import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { Badge, Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { InventoryTabs, hiddenTabs } from "@/components/admin/inventory/tabs";
import { Empty, PageHeader, Pagination, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { MOVEMENT_REASONS } from "@/server/inventory";
import { fmtDateTime } from "@/lib/admin-shared";
import { param, parsePage } from "@/lib/admin-queries";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stock movements" };

const PER_PAGE = 50;
const LABEL: Record<string, string> = {
  RESERVE: "Reserve",
  RELEASE: "Release",
  SALE: "Sale",
  RESTOCK: "Restock",
  ADJUST: "Adjust",
  RETURN: "Return",
  PO_RECEIVE: "PO receipt",
  STOCKTAKE: "Stocktake",
};

export default async function MovementsPage(props: PageProps<"/admin/inventory/movements">) {
  const user = await requirePermission("inventory.view");
  const sp = await props.searchParams;
  const reason = param(sp.reason);
  const variant = param(sp.variant);
  const page = parsePage(sp.page);

  const where: Prisma.InventoryLogWhereInput = {};
  if ((MOVEMENT_REASONS as readonly string[]).includes(reason)) where.reason = reason;
  else if (reason === "stock") where.delta = { not: 0 };
  if (variant) {
    const contains = { contains: variant, mode: "insensitive" as const };
    where.variant = { OR: [{ sku: contains }, { barcode: { equals: variant } }, { product: { name: contains } }] };
  }

  const [total, logs] = await Promise.all([
    db.inventoryLog.count({ where }),
    db.inventoryLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: { id: true, delta: true, reason: true, orderId: true, actorId: true, createdAt: true, variant: { select: { sku: true, label: true, product: { select: { name: true } } } } },
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const actorIds = [...new Set(logs.map((l) => l.actorId).filter((x): x is string => Boolean(x)))];
  const orderIds = [...new Set(logs.map((l) => l.orderId).filter((x): x is string => Boolean(x)))];
  const [actors, orders] = await Promise.all([
    actorIds.length ? db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } }) : [],
    orderIds.length ? db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, number: true } }) : [],
  ]);
  const actorEmail = new Map(actors.map((a) => [a.id, a.email]));
  const orderNumber = new Map(orders.map((o) => [o.id, o.number]));

  const href = (p: number) => {
    const s = new URLSearchParams();
    if (reason) s.set("reason", reason);
    if (variant) s.set("variant", variant);
    if (p > 1) s.set("page", String(p));
    const qs = s.toString();
    return qs ? `/admin/inventory/movements?${qs}` : "/admin/inventory/movements";
  };

  return (
    <>
      <PageHeader eyebrow="Stock control" title="Stock movements">
        {total} movement{total === 1 ? "" : "s"}
        {reason || variant ? " matching your filters" : ""}
      </PageHeader>
      <InventoryTabs active="movements" hide={hiddenTabs(user)} />

      <form method="get" role="search" className="mb-6 grid gap-4 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
        <label className="block">
          <span className="sr-only">Variant</span>
          <Input type="search" name="variant" defaultValue={variant} placeholder="Variant: SKU, barcode or product" />
        </label>
        <label className="block">
          <span className="sr-only">Reason</span>
          <Select name="reason" defaultValue={reason}>
            <option value="">All reasons</option>
            <option value="stock">Stock changes only</option>
            {MOVEMENT_REASONS.map((r) => (
              <option key={r} value={r}>
                {LABEL[r]}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" size="sm" variant="outline">
          Filter
        </Button>
      </form>

      <Section title="Movements">
        {logs.length ? (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Variant</Th>
                <Th>Reason</Th>
                <Th className="text-right">Δ Stock</Th>
                <Th>By / order</Th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <Td className="whitespace-nowrap text-muted">{fmtDateTime(l.createdAt)}</Td>
                  <Td>
                    {l.variant.product.name} <span className="text-xs text-subtle">{l.variant.label}</span>{" "}
                    <Link href={`/admin/inventory/movements?variant=${encodeURIComponent(l.variant.sku)}`} className="font-mono text-xs text-subtle hover:text-gold">
                      {l.variant.sku}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={l.reason === "SALE" || l.reason === "RESERVE" || l.reason === "RELEASE" ? "muted" : "gold"}>{LABEL[l.reason] ?? l.reason.toLowerCase()}</Badge>
                  </Td>
                  <Td className={cn("text-right tabular-nums", l.delta < 0 ? "text-ember" : l.delta > 0 ? "text-gold" : "text-subtle")}>{l.delta > 0 ? `+${l.delta}` : l.delta}</Td>
                  <Td className="text-xs text-muted">
                    {l.orderId && orderNumber.has(l.orderId) ? (
                      <Link href={`/admin/orders/${l.orderId}`} className={linkClass}>
                        {orderNumber.get(l.orderId)}
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
          <Empty>No stock movements match.</Empty>
        )}
        <Pagination page={page} pages={pages} href={href} />
      </Section>
    </>
  );
}
