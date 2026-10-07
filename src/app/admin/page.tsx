import Link from "next/link";
import { Badge } from "@/components/ui/field";
import { RevenueChart, type RevenuePoint } from "@/components/admin/revenue-chart";
import { Empty, Kpi, PageHeader, Section, StatusBadge, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { db } from "@/server/db";
import { redirect } from "next/navigation";
import { can, requireStaff } from "@/server/roles";
import { Sparkline } from "@/components/admin/reports/report-ui";
import { LANDING_ORDER } from "@/lib/permissions";
import { getSettings } from "@/server/settings";
import { formatMoney } from "@/lib/money";
import { brand } from "@/config/brand";
import { fmtDateTime } from "@/lib/admin-shared";
import { lowStockVariants, revenueWhere, toPackWhere } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

const DAY = 86_400_000;

export default async function AdminDashboard() {
  const access = await requireStaff();
  if (!access.permissions.includes("dashboard.view")) {
    // Narrow roles (e.g. warehouse) land on the first area they can use.
    const first = LANDING_ORDER.find(([p]) => access.permissions.includes(p));
    redirect(first?.[1] ?? "/");
  }
  const settings = await getSettings();

  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - 29 * DAY);

  // Zero-value exchange replacements aren't sales; keep them out of order counts and AOV.
  const exchangeOrderIds = (
    await db.returnRequest.findMany({ where: { exchangeOrderId: { not: null }, resolvedAt: { gte: start } }, select: { exchangeOrderId: true } })
  ).flatMap((r) => (r.exchangeOrderId ? [r.exchangeOrderId] : []));

  const [revenueOrders, newCustomers, toPack, toShip, lowStock, recent] = await Promise.all([
    db.order.findMany({ where: { AND: [revenueWhere, { placedAt: { gte: start } }, { id: { notIn: exchangeOrderIds } }] }, select: { total: true, placedAt: true } }),
    db.user.count({ where: { role: "CUSTOMER", createdAt: { gte: start } } }),
    db.order.findMany({ where: toPackWhere, orderBy: { placedAt: "asc" }, take: 10, select: { id: true, number: true, email: true, total: true, status: true, reservedUntil: true, placedAt: true } }),
    db.order.findMany({ where: { status: "PACKED" }, orderBy: { placedAt: "asc" }, take: 10, select: { id: true, number: true, email: true, total: true, status: true, reservedUntil: true, placedAt: true } }),
    lowStockVariants(settings.lowStockThreshold, 12),
    db.order.findMany({ orderBy: { placedAt: "desc" }, take: 8, select: { id: true, number: true, email: true, total: true, status: true, reservedUntil: true, placedAt: true } }),
  ]);

  const buckets = new Map<string, RevenuePoint>();
  for (let i = 0; i < 30; i++) {
    const date = new Date(start.getTime() + i * DAY).toISOString().slice(0, 10);
    buckets.set(date, { date, revenue: 0, orders: 0 });
  }
  for (const o of revenueOrders) {
    const b = buckets.get(o.placedAt.toISOString().slice(0, 10));
    if (b) {
      b.revenue += o.total;
      b.orders += 1;
    }
  }
  const series = [...buckets.values()];
  const revenue = revenueOrders.reduce((s, o) => s + o.total, 0);
  const aov = revenueOrders.length ? Math.round(revenue / revenueOrders.length) : 0;

  const queue = [...toPack.map((o) => ({ ...o, action: "Pack" })), ...toShip.map((o) => ({ ...o, action: "Ship" }))];

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Good day at the atelier"
        actions={
          can(access, "reports.view") ? (
            <Link href="/admin/reports" className="inline-flex h-9 items-center border border-line-strong px-4 text-[0.6875rem] uppercase tracking-[0.2em] transition-colors hover:border-gold hover:text-gold">
              View reports
            </Link>
          ) : undefined
        }
      >
        Last 30 days · amounts in {brand.baseCurrency}
      </PageHeader>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label="Revenue · 30d"
          value={formatMoney(revenue)}
          hint={<Sparkline values={series.map((d) => d.revenue)} label={`Daily revenue, last 30 days, total ${formatMoney(revenue)}`} className="mt-2 h-8" />}
        />
        <Kpi label="Orders · 30d" value={revenueOrders.length} />
        <Kpi label="Average order" value={formatMoney(aov)} />
        <Kpi label="New customers · 30d" value={newCustomers} />
      </div>

      <Section title="Revenue · last 30 days" className="mb-8">
        <div className="px-2 py-4 sm:px-4">
          <RevenueChart data={series} />
        </div>
      </Section>

      <div className="mb-8 grid gap-8 xl:grid-cols-2 [&>*]:min-w-0">
        <Section
          title={`Needs action · ${queue.length}`}
          actions={
            <Link href="/admin/orders?status=TO_PACK" className="text-xs text-muted hover:text-gold">
              All orders
            </Link>
          }
        >
          {queue.length ? (
            <Table className="min-w-[480px]">
              <thead>
                <tr>
                  <Th>Order</Th>
                  <Th>Status</Th>
                  <Th>Next</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {queue.map((o) => (
                  <tr key={o.id}>
                    <Td>
                      <Link href={`/admin/orders/${o.id}`} className={linkClass}>
                        {o.number}
                      </Link>
                      <p className="text-xs text-subtle">{fmtDateTime(o.placedAt)}</p>
                    </Td>
                    <Td>
                      <StatusBadge status={o.status} reservedUntil={o.reservedUntil} />
                    </Td>
                    <Td className="text-xs uppercase tracking-[0.18em] text-gold">{o.action}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(o.total)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty>Nothing waiting. Every order is on its way.</Empty>
          )}
        </Section>

        <Section
          title={`Low stock · ≤ ${settings.lowStockThreshold} available`}
          actions={
            <Link href="/admin/inventory?low=1" className="text-xs text-muted hover:text-gold">
              Inventory
            </Link>
          }
        >
          {lowStock.length ? (
            <Table className="min-w-[480px]">
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th>SKU</Th>
                  <Th className="text-right">Available</Th>
                </tr>
              </thead>
              <tbody>
                {lowStock.map((v) => {
                  const free = v.stock - v.reserved;
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
                      <Td className={free <= 0 ? "text-right tabular-nums text-ember" : "text-right tabular-nums"}>{free}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : (
            <Empty>All variants are comfortably stocked.</Empty>
          )}
        </Section>
      </div>

      <Section
        title="Recent orders"
        actions={
          <Link href="/admin/orders" className="text-xs text-muted hover:text-gold">
            View all
          </Link>
        }
      >
        {recent.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th>Placed</Th>
                <Th>Status</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((o) => (
                <tr key={o.id}>
                  <Td>
                    <Link href={`/admin/orders/${o.id}`} className={linkClass}>
                      {o.number}
                    </Link>
                  </Td>
                  <Td className="text-muted">{o.email}</Td>
                  <Td className="text-muted">{fmtDateTime(o.placedAt)}</Td>
                  <Td>
                    <StatusBadge status={o.status} reservedUntil={o.reservedUntil} />
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(o.total)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No orders yet.</Empty>
        )}
      </Section>
    </>
  );
}
