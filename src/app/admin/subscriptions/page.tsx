import Link from "next/link";
import type { Prisma, SubscriptionStatus } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Badge, Input, Select } from "@/components/ui/field";
import { Empty, Kpi, PageHeader, Pagination, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { SubscriptionRowActions, SubscriptionSettingsForm } from "@/components/admin/subscription-admin";
import { db } from "@/server/db";
import { can, requirePermission } from "@/server/roles";
import { discounted, getSubscriptionSettings, intervalLabel, subscriptionStats } from "@/server/subscriptions";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/admin-shared";
import { param, parsePage } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Subscriptions" };

const PER_PAGE = 25;
const STATUSES: SubscriptionStatus[] = ["ACTIVE", "PAUSED", "CANCELLED"];
const tone = (s: SubscriptionStatus) => (s === "ACTIVE" ? "gold" : s === "PAUSED" ? "muted" : "ember");

export default async function AdminSubscriptionsPage(props: PageProps<"/admin/subscriptions">) {
  const access = await requirePermission("subscriptions.manage");
  const sp = await props.searchParams;
  const status = param(sp.status);
  const q = param(sp.q);
  const page = parsePage(sp.page);

  const and: Prisma.SubscriptionWhereInput[] = [];
  if ((STATUSES as string[]).includes(status)) and.push({ status: status as SubscriptionStatus });
  if (q) and.push({ OR: [{ email: { contains: q, mode: "insensitive" } }, { user: { email: { contains: q, mode: "insensitive" } } }, { variant: { product: { name: { contains: q, mode: "insensitive" } } } }] });
  const where: Prisma.SubscriptionWhereInput = { AND: and };
  const now = new Date();

  const [stats, total, subs, upcoming, recent, settings] = await Promise.all([
    subscriptionStats(now),
    db.subscription.count({ where }),
    db.subscription.findMany({
      where,
      orderBy: [{ status: "asc" }, { nextRunAt: "asc" }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        user: { select: { email: true, name: true } },
        variant: { select: { label: true, price: true, product: { select: { name: true } } } },
        renewals: { where: { status: "PENDING" }, select: { id: true } },
      },
    }),
    db.subscription.findMany({
      where: { status: "ACTIVE", nextRunAt: { lte: new Date(now.getTime() + 14 * 86_400_000) } },
      orderBy: { nextRunAt: "asc" },
      take: 20,
      include: { user: { select: { email: true } }, variant: { select: { label: true, price: true, product: { select: { name: true } } } } },
    }),
    db.subscriptionRenewal.findMany({
      orderBy: { createdAt: "desc" },
      take: 15,
      include: { subscription: { select: { email: true, variant: { select: { product: { select: { name: true } } } } } } },
    }),
    getSubscriptionSettings(),
  ]);
  const orderNumbers = new Map(
    (await db.order.findMany({ where: { id: { in: recent.map((r) => r.orderId).filter((x): x is string => Boolean(x)) } }, select: { id: true, number: true } })).map((o) => [o.id, o.number]),
  );
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const href = (p: number) => {
    const s = new URLSearchParams();
    if (status) s.set("status", status);
    if (q) s.set("q", q);
    if (p > 1) s.set("page", String(p));
    const qs = s.toString();
    return qs ? `/admin/subscriptions?${qs}` : "/admin/subscriptions";
  };

  return (
    <>
      <PageHeader eyebrow="Recurring" title="Subscriptions">
        Subscribe &amp; Save · {settings.enabled ? `${settings.discountPercent}% off` : "not offered right now"} · renewals run daily (cron <code>subscriptions</code>) · pause after {settings.maxFailures} failed attempts
      </PageHeader>

      <div className="mb-8 grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-4">
        <Kpi label="MRR" value={formatMoney(stats.mrr)} hint="Active, normalised per month" />
        <Kpi label="Active" value={stats.active} hint={`${stats.paused} paused`} />
        <Kpi label="Churn · 30 days" value={`${(stats.churn30 * 100).toFixed(1)}%`} hint={`${stats.cancelled30} cancelled`} />
        <Kpi label="Renewing · 7 days" value={stats.upcoming7} />
      </div>

      <form method="get" className="mb-6 grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end" role="search">
        <label className="block">
          <span className="sr-only">Search subscriptions</span>
          <Input name="q" defaultValue={q} placeholder="Search by email or product" type="search" />
        </label>
        <label className="block">
          <span className="sr-only">Status</span>
          <Select name="status" defaultValue={status}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0] + s.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex gap-2">
          <Button type="submit" size="sm" variant="outline">
            Filter
          </Button>
          {status || q ? (
            <Button asChild size="sm" variant="ghost">
              <Link href="/admin/subscriptions">Clear</Link>
            </Button>
          ) : null}
        </div>
      </form>

      <Section title={`Subscriptions · ${total}`}>
        {subs.length ? (
          <Table className="min-w-[960px]">
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Piece</Th>
                <Th>Schedule</Th>
                <Th className="text-right">Per renewal</Th>
                <Th>Next</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id} className="align-top transition-colors hover:bg-bg-soft/50">
                  <Td className="max-w-[14rem]">
                    <Link href={`/admin/orders?q=${encodeURIComponent(s.user.email)}`} className={linkClass}>
                      {s.user.name ?? s.user.email}
                    </Link>
                    <p className="truncate text-xs text-subtle">{s.email || s.user.email}</p>
                  </Td>
                  <Td>
                    {s.variant.product.name}
                    <p className="text-xs text-subtle">
                      {s.variant.label} · × {s.quantity}
                    </p>
                  </Td>
                  <Td className="whitespace-nowrap text-muted">
                    {intervalLabel(s.intervalMonths)}
                    <p className="text-xs text-subtle">
                      {s.provider ?? "—"}
                      {s.paymentMethodRef ? " · saved card" : " · pay link"}
                    </p>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatMoney(discounted(s.variant.price, s.discountPercent) * s.quantity)}
                    {s.discountPercent ? <p className="text-xs text-subtle">−{s.discountPercent}%</p> : null}
                  </Td>
                  <Td className="whitespace-nowrap text-muted">
                    {s.status === "ACTIVE" ? fmtDate(s.nextRunAt) : "—"}
                    {s.renewals.length ? <p className="text-xs text-gold">awaiting payment</p> : null}
                    {s.failureCount ? <p className="text-xs text-ember">{s.failureCount} failed{s.lastError ? ` · ${s.lastError}` : ""}</p> : null}
                  </Td>
                  <Td>
                    <Badge tone={tone(s.status)}>{s.status === "PAUSED" && s.pauseReason === "payment_failed" ? "Paused · payment" : s.status[0] + s.status.slice(1).toLowerCase()}</Badge>
                  </Td>
                  <Td>
                    <SubscriptionRowActions id={s.id} status={s.status} processing={s.renewals.length > 0} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>{status || q ? "No subscriptions match." : "No subscriptions yet — they start when a customer pays for a “Subscribe & save” item."}</Empty>
        )}
        <Pagination page={page} pages={pages} href={href} />
      </Section>

      <div className="mt-8 grid gap-8 xl:grid-cols-2">
        <Section title="Upcoming renewals · 14 days">
          {upcoming.length ? (
            <ul className="divide-y divide-line">
              {upcoming.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-sm">
                  <span className="min-w-0">
                    {s.variant.product.name} × {s.quantity} <span className="text-subtle">· {s.email || s.user.email}</span>
                  </span>
                  <span className="whitespace-nowrap tabular-nums text-muted">
                    {fmtDate(s.nextRunAt)} · {formatMoney(discounted(s.variant.price, s.discountPercent) * s.quantity)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing renews in the next two weeks.</Empty>
          )}
        </Section>
        <Section title="Recent renewal attempts">
          {recent.length ? (
            <ul className="divide-y divide-line">
              {recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-sm">
                  <span className="min-w-0">
                    {r.subscription.variant.product.name}
                    {r.orderId && orderNumbers.get(r.orderId) ? (
                      <Link href={`/admin/orders/${r.orderId}`} className="ms-2 text-muted hover:text-gold">
                        {orderNumbers.get(r.orderId)}
                      </Link>
                    ) : null}
                    {r.error ? <span className="block text-xs text-ember">{r.error}</span> : null}
                  </span>
                  <span className="flex items-center gap-3 whitespace-nowrap text-xs text-muted">
                    {fmtDateTime(r.createdAt)}
                    <Badge tone={r.status === "PAID" ? "gold" : r.status === "FAILED" ? "ember" : "muted"}>{r.status.toLowerCase()}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No renewals yet.</Empty>
          )}
        </Section>
      </div>

      <Section title="Subscribe & Save settings" className="mt-8">
        <SubscriptionSettingsForm initial={settings} canEdit={can(access, "settings.manage")} />
      </Section>
    </>
  );
}
