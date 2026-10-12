import Link from "next/link";
import type { TransferStatus } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/field";
import { InventoryTabs, hiddenTabs } from "@/components/admin/inventory/tabs";
import { TransferCreateForm } from "@/components/admin/warehouses/forms";
import { Empty, PageHeader, Pagination, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { db } from "@/server/db";
import { can, requirePermission } from "@/server/roles";
import { fmtDateTime } from "@/lib/admin-shared";
import { parsePage } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stock transfers" };

const PER_PAGE = 25;
const TRANSFER_TONE: Record<TransferStatus, "gold" | "muted" | "ember"> = { DRAFT: "gold", IN_TRANSIT: "gold", RECEIVED: "muted", CANCELLED: "ember" };

export default async function TransfersPage(props: PageProps<"/admin/transfers">) {
  const user = await requirePermission("inventory.view");
  const canAdjust = can(user, "inventory.adjust");
  const page = parsePage((await props.searchParams).page);
  const [total, transfers, warehouses] = await Promise.all([
    db.stockTransfer.count(),
    db.stockTransfer.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: { from: { select: { code: true } }, to: { select: { code: true } }, lines: { select: { quantity: true } } },
    }),
    db.warehouse.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { priority: "asc" }], select: { id: true, code: true, name: true } }),
  ]);

  return (
    <>
      <PageHeader eyebrow="Stock control" title="Transfers">
        Draft → dispatch (units leave the source) → receive (units become sellable at the destination).
      </PageHeader>
      <InventoryTabs active="transfers" hide={hiddenTabs(user)} />

      {canAdjust ? (
        <Section title="New transfer" className="mb-8">
          {warehouses.length > 1 ? <TransferCreateForm warehouses={warehouses} /> : <Empty>Add a second warehouse to move stock between locations.</Empty>}
        </Section>
      ) : null}

      <Section title={`Transfers · ${total}`}>
        {transfers.length ? (
          <Table className="min-w-[640px]">
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Route</Th>
                <Th className="text-right">Units</Th>
                <Th>Status</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <Link href={`/admin/transfers/${t.id}`} className={`${linkClass} font-mono text-xs`}>
                      {t.number}
                    </Link>
                  </Td>
                  <Td className="font-mono text-xs">
                    {t.from.code} → {t.to.code}
                  </Td>
                  <Td className="text-right tabular-nums">{t.lines.reduce((n, l) => n + l.quantity, 0)}</Td>
                  <Td>
                    <Badge tone={TRANSFER_TONE[t.status]}>{t.status.replace("_", " ").toLowerCase()}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(t.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No transfers yet.</Empty>
        )}
        <Pagination page={page} pages={Math.max(1, Math.ceil(total / PER_PAGE))} href={(p) => `/admin/transfers?page=${p}`} />
      </Section>
    </>
  );
}
