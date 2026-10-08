import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/field";
import { Empty, PageHeader, StatusBadge, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { SalesChart } from "@/components/admin/reports/sales-chart";
import { SplitBars, fmtInt } from "@/components/admin/reports/report-ui";
import { AutoRefresh } from "@/components/admin/dashboard/auto-refresh";
import { GoalEditor } from "@/components/admin/dashboard/goal-editor";
import { ActivityFeed, AttentionInbox, GoalRing, Panel, PulseTile, SalesHeatmap, TopMovers, Versus } from "@/components/admin/dashboard/widgets";
import { db } from "@/server/db";
import { can, requireStaff } from "@/server/roles";
import { getSettings } from "@/server/settings";
import { getChannelSplit, getKpis, getSalesSeries, makeRange, previousRange, resolveRange, storeTimeZone } from "@/server/analytics";
import { getActivity, getAttention, getDashboardSettings, getPulse, getSalesHeatmap, getTodayVisits, getTopMovers, getTradeReceivables, storeClock } from "@/server/dashboard";
import { fmtVisitTime, zonedParts } from "@/server/visit-schedule";
import { LANDING_ORDER } from "@/lib/permissions";
import { goalProjection, relativeTime } from "@/lib/dashboard";
import { formatMoney } from "@/lib/money";
import { brand } from "@/config/brand";
import { fmtDateTime } from "@/lib/admin-shared";
import { lowStockVariants, toPackWhere } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

const DAY = 86_400_000;
const orderSelect = { id: true, number: true, email: true, total: true, status: true, reservedUntil: true, placedAt: true } as const;
const none = <T,>(v: T) => Promise.resolve(v);

export default async function AdminDashboard() {
  const access = await requireStaff();
  if (!access.permissions.includes("dashboard.view")) {
    // Narrow roles (e.g. warehouse) land on the first area they can use.
    const first = LANDING_ORDER.find(([p]) => access.permissions.includes(p));
    redirect(first?.[1] ?? "/");
  }
  const perms = access.permissions;
  const canOrders = can(access, "orders.view");
  const canStock = can(access, "inventory.view");
  const canVisits = can(access, "visits.manage");
  const canTrade = can(access, "trade.view");

  const now = new Date();
  const [settings, tz, dash] = await Promise.all([getSettings(), storeTimeZone(), getDashboardSettings()]);
  const clock = storeClock(tz, now);
  const r30 = resolveRange({ range: "30d" }, tz, now);
  const month = makeRange("custom", clock.monthFirst, clock.today, tz);

  const [kpis, monthSeries, series, prevSeries, channels, newCustomers, pulse, heat, movers, attention, activity, visitsToday, receivables, toPack, toShip, lowStock, recent] = await Promise.all([
    getKpis(r30),
    // Net revenue per day this month; the sum equals getKpis(month).netRevenue (kept orders less return refunds).
    getSalesSeries(month),
    getSalesSeries(r30),
    getSalesSeries(previousRange(r30)),
    getChannelSplit(r30),
    db.user.count({ where: { role: "CUSTOMER", createdAt: { gte: new Date(now.getTime() - 30 * DAY) } } }),
    getPulse(tz, now),
    getSalesHeatmap(tz, now),
    getTopMovers(tz, now),
    getAttention(perms, settings.lowStockThreshold, now),
    getActivity(perms, 15),
    canVisits ? getTodayVisits(tz, now) : none(null),
    canTrade ? getTradeReceivables(now) : none(null),
    canOrders ? db.order.findMany({ where: toPackWhere, orderBy: { placedAt: "asc" }, take: 8, select: orderSelect }) : none([]),
    canOrders ? db.order.findMany({ where: { status: "PACKED" }, orderBy: { placedAt: "asc" }, take: 8, select: orderSelect }) : none([]),
    canStock ? lowStockVariants(settings.lowStockThreshold, 8) : none([]),
    canOrders ? db.order.findMany({ orderBy: { placedAt: "desc" }, take: 8, select: orderSelect }) : none([]),
  ]);

  const goal = goalProjection({ revenue: monthSeries.reduce((sum, d) => sum + d.revenue, 0), target: dash.monthlyTarget, now, monthStart: clock.monthStart, monthEnd: clock.monthEnd });
  const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: tz }).format(now);
  const hour = Number(zonedParts(now, tz).time.slice(0, 2));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = access.name?.split(" ")[0];
  const dateLine = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(now);
  const queue = [...toPack.map((o) => ({ ...o, action: "Pack" })), ...toShip.map((o) => ({ ...o, action: "Ship" }))];
  const last = pulse.lastOrder;

  return (
    <>
      <PageHeader
        eyebrow="Command centre"
        title={`${greeting}${firstName ? `, ${firstName}` : ""}`}
        actions={
          can(access, "reports.view") ? (
            <Link href="/admin/reports" className="inline-flex h-9 items-center border border-line-strong px-4 text-[0.6875rem] uppercase tracking-[0.2em] transition-colors hover:border-gold hover:text-gold">
              View reports
            </Link>
          ) : undefined
        }
      >
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            {dateLine} · {tz} · {brand.baseCurrency}
          </span>
          <AutoRefresh updatedLabel={fmtVisitTime(now, tz)} />
        </span>
      </PageHeader>

      {/* ── Today ── */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5 max-md:[&>*:last-child:nth-child(odd)]:col-span-2">
        <PulseTile label="Revenue today" value={formatMoney(pulse.todayRevenue)} accent sub={<Versus cur={pulse.todayRevenue} prev={pulse.yesterdayRevenue} label="this time yesterday" money />} />
        <PulseTile label="Orders today" value={fmtInt(pulse.todayOrders)} sub={<Versus cur={pulse.todayOrders} prev={pulse.yesterdayOrders} label="yesterday" />} />
        <PulseTile
          label="Last order"
          value={last ? relativeTime(last.placedAt, now) : "—"}
          href={last && canOrders ? `/admin/orders/${last.id}` : undefined}
          sub={last ? `${last.number}${last.trade ? " · trade" : ""} · ${formatMoney(last.total)}` : "No orders yet"}
        />
        {visitsToday ? (
          <PulseTile
            label="Visitors today"
            value={fmtInt(visitsToday.guests)}
            href="/admin/visits"
            sub={visitsToday.bookings ? `${visitsToday.arrived} arrived${visitsToday.next ? ` · next ${fmtVisitTime(visitsToday.next.startsAt, tz)}` : ""}` : "No bookings today"}
          />
        ) : null}
        {receivables ? (
          <PulseTile
            label="Trade invoices open"
            value={fmtInt(receivables.open)}
            href="/admin/trade?status=approved"
            sub={receivables.open ? <span className={receivables.overdue ? "text-ember" : undefined}>{formatMoney(receivables.amount)}{receivables.overdue ? ` · ${receivables.overdue} overdue` : ""}</span> : "Nothing awaiting payment"}
          />
        ) : null}
      </div>

      {/* ── Goal + 30-day trend ── */}
      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <Panel title={`${monthLabel} goal`}>
          <GoalRing g={goal} monthLabel={monthLabel} editor={can(access, "settings.manage") ? <GoalEditor target={dash.monthlyTarget} /> : undefined} />
        </Panel>
        <Panel
          title="Net revenue · last 30 days"
          actions={
            can(access, "reports.view") ? (
              <Link href="/admin/reports?range=30d" className="text-xs text-muted hover:text-gold">
                Full report
              </Link>
            ) : undefined
          }
        >
          <div className="grid grid-cols-2 border-b border-line sm:grid-cols-4">
            {[
              ["Revenue", formatMoney(kpis.netRevenue)],
              ["Orders", fmtInt(kpis.orders)],
              ["Average order", formatMoney(kpis.aov)],
              ["New customers", fmtInt(newCustomers)],
            ].map(([k, v], i) => (
              <div key={k} className={`min-w-0 px-5 py-3 ${i % 2 ? "border-l border-line" : ""} ${i >= 2 ? "border-t border-line sm:border-t-0" : ""} ${i === 2 ? "sm:border-l" : ""}`}>
                <p className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">{k}</p>
                <p className="mt-1 truncate font-display text-xl font-light tabular-nums text-fg">{v}</p>
              </div>
            ))}
          </div>
          <div className="px-2 py-4 sm:px-4">
            <SalesChart data={series} previous={prevSeries} granularity="day" label="Net revenue per day, last 30 days" />
          </div>
        </Panel>
      </div>

      {/* ── Inbox + activity ── */}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Panel title={`Needs attention · ${attention.reduce((s, i) => s + i.count, 0)}`}>
          <AttentionInbox items={attention} />
        </Panel>
        <Panel title="Latest activity">
          <div className="lg:max-h-[30rem] lg:overflow-y-auto">
            <ActivityFeed items={activity} now={now} />
          </div>
        </Panel>
      </div>

      {/* ── Rhythm, movers, channels ── */}
      <div className="mb-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Panel title={`When orders arrive · last ${heat.weeks} weeks`}>
          <SalesHeatmap grid={heat.grid} maxOrders={heat.maxOrders} total={heat.total} peak={heat.peak} weeks={heat.weeks} tz={tz} />
        </Panel>
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-1">
          <Panel title="Top movers · this week">
            <TopMovers movers={movers} />
          </Panel>
          <Panel title="Channels · 30 days">
            <SplitBars rows={channels.map((c) => ({ key: c.key, label: c.label, value: formatMoney(c.revenue), share: c.share, detail: `${fmtInt(c.orders)} order${c.orders === 1 ? "" : "s"}` }))} />
          </Panel>
        </div>
      </div>

      {/* ── Work queues (unchanged behaviour) ── */}
      {canOrders || canStock ? (
        <div className="mb-6 grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
          {canOrders ? (
            <Panel
              title={`Fulfilment queue · ${queue.length}`}
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
            </Panel>
          ) : null}
          {canStock ? (
            <Panel
              title={`Low stock · ≤ ${settings.lowStockThreshold} available`}
              actions={
                <Link href="/admin/inventory?filter=low" className="text-xs text-muted hover:text-gold">
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
            </Panel>
          ) : null}
        </div>
      ) : null}

      {canOrders ? (
        <Panel
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
        </Panel>
      ) : null}
    </>
  );
}
