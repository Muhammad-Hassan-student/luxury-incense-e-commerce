import Link from "next/link";
import type { StockTakeStatus } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/field";
import { InventoryTabs, hiddenTabs } from "@/components/admin/inventory/tabs";
import { StockTakeCreateForm } from "@/components/admin/inventory/stocktake-forms";
import { Empty, PageHeader, Pagination, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { db } from "@/server/db";
import { can, requirePermission } from "@/server/roles";
import { fmtDateTime } from "@/lib/admin-shared";
import { parsePage } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stocktakes" };

const PER_PAGE = 25;
const TONE: Record<StockTakeStatus, "gold" | "muted" | "ember"> = { OPEN: "gold", COMPLETED: "muted", CANCELLED: "ember" };

export default async function StockTakesPage(props: PageProps<"/admin/stocktakes">) {
  const user = await requirePermission("stocktake.manage");
  const canManage = can(user, "stocktake.manage");
  const sp = await props.searchParams;
  const page = parsePage(sp.page);

  const [total, takes, categories, suppliers] = await Promise.all([
    db.stockTake.count(),
    db.stockTake.findMany({
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: { id: true, name: true, status: true, note: true, createdAt: true, completedAt: true, createdBy: { select: { email: true } }, _count: { select: { lines: true } } },
    }),
    canManage ? db.category.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true } }) : [],
    canManage ? db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  const ids = takes.map((t) => t.id);
  const countedRows = ids.length ? await db.stockTakeLine.groupBy({ by: ["stockTakeId"], where: { stockTakeId: { in: ids }, counted: { not: null } }, _count: true }) : [];
  const counted = new Map(countedRows.map((r) => [r.stockTakeId, r._count]));
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <>
      <PageHeader eyebrow="Stock control" title="Stocktakes">
        Physical counts. Starting one snapshots current stock; completing it applies the differences.
      </PageHeader>
      <InventoryTabs active="stocktakes" hide={hiddenTabs(user)} />

      {canManage ? (
        <Section title="Start a stocktake" className="mb-8">
          <StockTakeCreateForm categories={categories} suppliers={suppliers} />
        </Section>
      ) : null}

      <Section title={`History · ${total}`}>
        {takes.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Status</Th>
                <Th className="text-right">Counted</Th>
                <Th>Started</Th>
                <Th>Completed</Th>
              </tr>
            </thead>
            <tbody>
              {takes.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <Link href={`/admin/stocktakes/${t.id}`} className={linkClass}>
                      {t.name}
                    </Link>
                    {t.note ? <span className="block text-xs text-subtle">{t.note}</span> : null}
                  </Td>
                  <Td>
                    <Badge tone={TONE[t.status]}>{t.status.toLowerCase()}</Badge>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {counted.get(t.id) ?? 0} / {t._count.lines}
                  </Td>
                  <Td className="text-xs text-muted">
                    {fmtDateTime(t.createdAt)}
                    <span className="block">{t.createdBy.email}</span>
                  </Td>
                  <Td className="text-xs text-muted">{fmtDateTime(t.completedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No stocktakes yet.</Empty>
        )}
        <Pagination page={page} pages={pages} href={(p) => (p > 1 ? `/admin/stocktakes?page=${p}` : "/admin/stocktakes")} />
      </Section>
    </>
  );
}
