import Link from "next/link";
import type { OrderStatus, Prisma } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Empty, PageHeader, Pagination, Section, StatusBadge, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { db } from "@/server/db";
import { can, requirePermission } from "@/server/roles";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUSES, fmtDateTime } from "@/lib/admin-shared";
import { param, parsePage, toPackWhere } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders" };

const PER_PAGE = 25;

/** Extra pseudo-filters on top of raw statuses. */
const VIEWS = {
  TO_PACK: { label: "To pack", where: toPackWhere },
  AWAITING_PAYMENT: { label: "Awaiting payment", where: { status: "PENDING", reservedUntil: { not: null } } },
} satisfies Record<string, { label: string; where: Prisma.OrderWhereInput }>;

export default async function OrdersPage(props: PageProps<"/admin/orders">) {
  const access = await requirePermission("orders.view");
  const sp = await props.searchParams;
  const status = param(sp.status);
  const q = param(sp.q);
  const page = parsePage(sp.page);

  const where: Prisma.OrderWhereInput = { AND: [] };
  const and = where.AND as Prisma.OrderWhereInput[];
  if (status in VIEWS) and.push(VIEWS[status as keyof typeof VIEWS].where);
  else if ((ORDER_STATUSES as string[]).includes(status)) and.push({ status: status as OrderStatus });
  if (q) {
    and.push({
      OR: [{ number: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }],
    });
  }

  const [total, orders] = await Promise.all([
    db.order.count({ where }),
    db.order.findMany({
      where,
      orderBy: { placedAt: "desc" },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true,
        number: true,
        email: true,
        status: true,
        reservedUntil: true,
        total: true,
        placedAt: true,
        _count: { select: { items: true } },
        payments: { select: { provider: true }, take: 1 },
      },
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  const href = (p: number) => {
    const s = new URLSearchParams();
    if (status) s.set("status", status);
    if (q) s.set("q", q);
    if (p > 1) s.set("page", String(p));
    const qs = s.toString();
    return qs ? `/admin/orders?${qs}` : "/admin/orders";
  };

  return (
    <>
      <PageHeader
        eyebrow="Fulfilment"
        title="Orders"
        actions={
          can(access, "orders.export") ? (
            <Button asChild size="sm" variant="outline">
              <a href={`/api/admin/export/orders${ORDER_STATUSES.includes(status as never) ? `?status=${status}` : ""}`} download>
                Export CSV
              </a>
            </Button>
          ) : null
        }
      >
        {total} order{total === 1 ? "" : "s"}
        {status || q ? " matching your filters" : ""}
      </PageHeader>

      <form method="get" className="mb-6 grid gap-4 sm:grid-cols-[1fr_14rem_auto] sm:items-end" role="search">
        <label className="block">
          <span className="sr-only">Search orders</span>
          <Input name="q" defaultValue={q} placeholder="Search by order number or email" type="search" />
        </label>
        <label className="block">
          <span className="sr-only">Status</span>
          <Select name="status" defaultValue={status}>
            <option value="">All statuses</option>
            {Object.entries(VIEWS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
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
              <Link href="/admin/orders">Clear</Link>
            </Button>
          ) : null}
        </div>
      </form>

      <Section title="Orders">
        {orders.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th>Placed</Th>
                <Th>Items</Th>
                <Th>Payment</Th>
                <Th>Status</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="transition-colors hover:bg-bg-soft/50">
                  <Td>
                    <Link href={`/admin/orders/${o.id}`} className={linkClass}>
                      {o.number}
                    </Link>
                  </Td>
                  <Td className="max-w-[16rem] truncate text-muted">{o.email}</Td>
                  <Td className="whitespace-nowrap text-muted">{fmtDateTime(o.placedAt)}</Td>
                  <Td className="tabular-nums text-muted">{o._count.items}</Td>
                  <Td className="text-xs uppercase tracking-[0.15em] text-muted">{o.payments[0]?.provider ?? "—"}</Td>
                  <Td>
                    <StatusBadge status={o.status} reservedUntil={o.reservedUntil} />
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(o.total)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No orders match.</Empty>
        )}
        <Pagination page={page} pages={pages} href={href} />
      </Section>
    </>
  );
}
