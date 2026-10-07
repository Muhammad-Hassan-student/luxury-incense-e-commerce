import Link from "next/link";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/field";
import { Empty, PageHeader, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { SalesChart } from "@/components/admin/reports/sales-chart";
import { Delta, DeltaKpi, RangePicker, SplitBars, fmtInt, fmtPct } from "@/components/admin/reports/report-ui";
import { RANGE_KEYS, RANGE_LABEL, SEGMENT_HINT, getSalesReport, pctChange, resolveRange, storeTimeZone, type MarginStats } from "@/server/analytics";
import { todayIn } from "@/server/visit-schedule";
import { can, requirePermission } from "@/server/roles";
import { param } from "@/lib/admin-queries";
import { fmtDate } from "@/lib/admin-shared";
import { formatMoney } from "@/lib/money";
import { brand } from "@/config/brand";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtDay = (iso: string) => dayFmt.format(new Date(`${iso}T00:00:00Z`));

function MarginCell({ s }: { s: MarginStats }) {
  if (s.marginRate == null) return <span className="text-xs text-subtle">Cost unknown</span>;
  const partial = s.costedRevenue < s.revenue;
  return (
    <span className="tabular-nums" title={partial ? `Cost known for ${fmtPct(s.costedRevenue / s.revenue)} of sales` : undefined}>
      {fmtPct(s.marginRate)}
      {partial ? <span className="text-subtle">*</span> : null}
    </span>
  );
}

export default async function ReportsPage(props: PageProps<"/admin/reports">) {
  const access = await requirePermission("reports.view");
  const sp = await props.searchParams;
  const tz = await storeTimeZone();
  const range = resolveRange({ range: param(sp.range), from: param(sp.from), to: param(sp.to) }, tz);
  const report = await getSalesReport(range);
  const { kpis: k, prevKpis: pk, prev } = report;
  const canOrders = can(access, "orders.view");
  const qs = range.key === "custom" ? `range=custom&from=${range.from}&to=${range.to}` : `range=${range.key}`;
  const hasSales = k.orders > 0 || k.refundedOrders > 0;
  const funnelMax = Math.max(1, ...report.funnel.map((f) => f.count));

  return (
    <>
      <PageHeader
        eyebrow="Analytics"
        title="Sales reports"
        actions={
          <>
            <a href={`/api/admin/export/report?${qs}&type=daily`} className="inline-flex h-9 items-center gap-2 border border-line-strong px-4 text-[0.6875rem] uppercase tracking-[0.2em] transition-colors hover:border-gold hover:text-gold">
              <Download className="size-3.5" strokeWidth={1.4} aria-hidden /> Sales by day
            </a>
            <a href={`/api/admin/export/report?${qs}&type=products`} className="inline-flex h-9 items-center gap-2 border border-line-strong px-4 text-[0.6875rem] uppercase tracking-[0.2em] transition-colors hover:border-gold hover:text-gold">
              <Download className="size-3.5" strokeWidth={1.4} aria-hidden /> Top products
            </a>
          </>
        }
      >
        {fmtDay(range.from)} – {fmtDay(range.to)} · compared with {fmtDay(prev.from)} – {fmtDay(prev.to)} · {tz} · {brand.baseCurrency}
      </PageHeader>

      <div className="mb-8">
        <RangePicker presets={RANGE_KEYS.filter((key) => key !== "custom").map((key) => ({ key, label: RANGE_LABEL[key] }))} current={range.key} from={range.from} to={range.to} max={todayIn(tz)} />
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <DeltaKpi
          label="Net revenue"
          value={formatMoney(k.netRevenue)}
          delta={<Delta change={pctChange(k.netRevenue, pk.netRevenue)} />}
          hint={k.refunds ? `${formatMoney(k.grossRevenue)} gross` : undefined}
        />
        <DeltaKpi label="Orders" value={fmtInt(k.orders)} delta={<Delta change={pctChange(k.orders, pk.orders)} />} />
        <DeltaKpi label="Average order" value={formatMoney(k.aov)} delta={<Delta change={pctChange(k.aov, pk.aov)} />} />
        <DeltaKpi label="Units sold" value={fmtInt(k.units)} delta={<Delta change={pctChange(k.units, pk.units)} />} />
        <DeltaKpi
          label="Gross margin"
          value={k.marginRate == null ? "—" : fmtPct(k.marginRate)}
          delta={k.marginRate != null && pk.marginRate != null ? <Delta change={k.marginRate - pk.marginRate} points /> : undefined}
          hint={k.merchandise ? (k.costCoverage < 0.9995 ? `Cost known for ${fmtPct(k.costCoverage)} of sales` : `${formatMoney(k.grossMargin)} on goods`) : "No sales yet"}
        />
        <DeltaKpi
          label="Customers"
          value={fmtInt(k.customers)}
          delta={<Delta change={pctChange(k.customers, pk.customers)} />}
          hint={`${fmtInt(k.newCustomers)} new · ${fmtInt(k.returningCustomers)} returning`}
        />
        <DeltaKpi
          label="Refunds · share of sales"
          value={fmtPct(k.refundRate)}
          delta={<Delta change={k.refundRate - pk.refundRate} invert points />}
          hint={
            k.refunds
              ? [
                  formatMoney(k.refunds),
                  k.refundedOrders ? `${fmtInt(k.refundedOrders)} order${k.refundedOrders === 1 ? "" : "s"}` : null,
                  k.returnsRefunded ? `${fmtInt(k.returnsRefunded)} return${k.returnsRefunded === 1 ? "" : "s"}${k.storeCredit ? ` (${formatMoney(k.storeCredit)} credit)` : ""}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : undefined
          }
        />
        <DeltaKpi
          label="Coupon discount"
          value={formatMoney(k.couponDiscount)}
          delta={<Delta change={pctChange(k.couponDiscount, pk.couponDiscount)} invert />}
          hint={`${fmtInt(k.couponOrders)} order${k.couponOrders === 1 ? "" : "s"}`}
        />
      </div>

      <Section title={`Net revenue · ${range.granularity === "week" ? "by week" : "by day"}`} className="mb-8">
        <div className="px-3 py-5 sm:px-5">
          <SalesChart data={report.series} previous={report.prevSeries} granularity={range.granularity} label={`Net revenue from ${fmtDay(range.from)} to ${fmtDay(range.to)}`} />
        </div>
      </Section>

      <div className="mb-8 grid gap-8 xl:grid-cols-[3fr_2fr] [&>*]:min-w-0">
        <Section title="Top products">
          {report.products.length ? (
            <Table className="min-w-[520px]">
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th className="text-right">Units</Th>
                  <Th className="text-right">Revenue</Th>
                  <Th className="text-right">Margin</Th>
                </tr>
              </thead>
              <tbody>
                {report.products.map((p, i) => (
                  <tr key={p.key}>
                    <Td>
                      <span className="me-3 inline-block w-4 text-xs tabular-nums text-subtle">{i + 1}</span>
                      {p.productId ? (
                        <Link href={`/admin/products/${p.productId}`} className={linkClass}>
                          {p.name}
                        </Link>
                      ) : (
                        <span>
                          {p.name} <Badge tone="muted">Removed</Badge>
                        </span>
                      )}
                    </Td>
                    <Td className="text-right tabular-nums">{fmtInt(p.units)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(p.revenue)}</Td>
                    <Td className="text-right">
                      <MarginCell s={p} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty>No products sold in this period.</Empty>
          )}
          {report.products.length ? <p className="px-5 py-3 text-xs text-subtle">Line value before order discounts. * cost known for part of the sales.</p> : null}
        </Section>

        <Section title="Categories">
          <SplitBars
            rows={report.categories.map((c) => ({
              key: c.key,
              label: c.name,
              value: formatMoney(c.revenue),
              share: c.share,
              detail: `${fmtInt(c.units)} units · margin ${c.marginRate == null ? "unknown" : fmtPct(c.marginRate)}`,
            }))}
          />
        </Section>
      </div>

      <Section title="Top variants" className="mb-8">
        {report.variants.length ? (
          <Table className="min-w-[600px]">
            <thead>
              <tr>
                <Th>Variant</Th>
                <Th>SKU</Th>
                <Th className="text-right">Units</Th>
                <Th className="text-right">Revenue</Th>
                <Th className="text-right">Gross profit</Th>
                <Th className="text-right">Margin</Th>
              </tr>
            </thead>
            <tbody>
              {report.variants.map((v) => (
                <tr key={v.sku}>
                  <Td>
                    {v.name} <span className="ms-1 text-xs text-subtle">{v.label}</span>
                  </Td>
                  <Td className="whitespace-nowrap font-mono text-xs text-muted">{v.sku}</Td>
                  <Td className="text-right tabular-nums">{fmtInt(v.units)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(v.revenue)}</Td>
                  <Td className="text-right tabular-nums">{v.margin == null ? <span className="text-xs text-subtle">—</span> : formatMoney(v.margin)}</Td>
                  <Td className="text-right">
                    <MarginCell s={v} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No variants sold in this period.</Empty>
        )}
      </Section>

      <div className="mb-8 grid gap-8 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
        <Section title="Channel">
          <SplitBars
            rows={report.channels.map((c) => ({ key: c.key, label: c.label, value: formatMoney(c.revenue), share: c.share, detail: `${fmtInt(c.orders)} order${c.orders === 1 ? "" : "s"}` }))}
          />
        </Section>
        <Section title="Payment method">
          <SplitBars
            rows={report.payments.map((c) => ({ key: c.key, label: c.label, value: formatMoney(c.revenue), share: c.share, detail: `${fmtInt(c.orders)} order${c.orders === 1 ? "" : "s"}` }))}
          />
        </Section>
        <Section title="Cart funnel" className="md:col-span-2 xl:col-span-1">
          <ol className="space-y-4 px-5 py-5">
            {report.funnel.map((f) => (
              <li key={f.key}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-fg">{f.label}</span>
                  <span className="tabular-nums text-fg">{fmtInt(f.count)}</span>
                </div>
                <div className="h-1.5 w-full bg-bg-soft" aria-hidden>
                  <div className="h-full bg-gold/70" style={{ width: `${(f.count / funnelMax) * 100}%` }} />
                </div>
                <p className="mt-1 text-xs text-subtle">{f.hint}</p>
              </li>
            ))}
          </ol>
          <p className="border-t border-line px-5 py-3 text-xs text-subtle">Best effort: bags aren’t linked to orders, so stages aren’t strictly nested.</p>
        </Section>
      </div>

      <div className="grid gap-8 xl:grid-cols-[2fr_3fr] [&>*]:min-w-0">
        <Section title="Customer segments">
          <div className="grid grid-cols-2 border-b border-line">
            <div className="border-e border-line px-5 py-4">
              <p className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">Repeat purchase rate</p>
              <p className="mt-2 font-display text-2xl font-light tabular-nums">{fmtPct(report.customers.repeatRate)}</p>
              <p className="text-xs text-muted">
                {fmtInt(report.customers.repeatCustomers)} of {fmtInt(report.customers.customers)} buyers
              </p>
            </div>
            <div className="px-5 py-4">
              <p className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">New this period</p>
              <p className="mt-2 font-display text-2xl font-light tabular-nums">{fmtPct(k.customers ? k.newCustomers / k.customers : null)}</p>
              <p className="text-xs text-muted">first order in range</p>
            </div>
          </div>
          <SplitBars
            empty="No customers yet."
            rows={report.customers.segments.map((s) => ({
              key: s.segment,
              label: s.segment,
              value: fmtInt(s.customers),
              share: s.share,
              detail: `${SEGMENT_HINT[s.segment]} · ${formatMoney(s.revenue)} lifetime`,
            }))}
          />
          <p className="border-t border-line px-5 py-3 text-xs text-subtle">All customers as of {fmtDay(range.to)}, by recency and number of orders.</p>
        </Section>

        <Section title="Top customers · lifetime value">
          {report.customers.top.length ? (
            <Table className="min-w-[560px]">
              <thead>
                <tr>
                  <Th>Customer</Th>
                  <Th>Segment</Th>
                  <Th className="text-right">Orders</Th>
                  <Th className="text-right">This period</Th>
                  <Th className="text-right">Lifetime</Th>
                </tr>
              </thead>
              <tbody>
                {report.customers.top.map((c) => (
                  <tr key={c.key}>
                    <Td className="max-w-[16rem]">
                      {canOrders ? (
                        <Link href={`/admin/orders?q=${encodeURIComponent(c.email)}`} className={`${linkClass} block truncate`}>
                          {c.name ?? c.email}
                        </Link>
                      ) : (
                        <span className="block truncate">{c.name ?? c.email}</span>
                      )}
                      <p className="truncate text-xs text-subtle">
                        {c.name ? `${c.email} · ` : ""}
                        {c.userId ? "" : "guest · "}last {fmtDate(c.lastOrderAt)}
                      </p>
                    </Td>
                    <Td>
                      <Badge tone={c.segment === "Champions" || c.segment === "Loyal" ? "gold" : c.segment === "At risk" || c.segment === "Lost" ? "ember" : "muted"}>{c.segment}</Badge>
                    </Td>
                    <Td className="text-right tabular-nums">{fmtInt(c.orders)}</Td>
                    <Td className="text-right tabular-nums text-muted">{formatMoney(c.rangeRevenue)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(c.lifetimeValue)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty>No customers bought in this period.</Empty>
          )}
        </Section>
      </div>

      {!hasSales ? <p className="mt-8 text-center text-sm text-muted">No confirmed sales in this period yet — pick a longer range above.</p> : null}
    </>
  );
}
