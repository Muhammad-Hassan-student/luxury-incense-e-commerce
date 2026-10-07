import Link from "next/link";
import type { Prisma, Role } from "@/generated/prisma/client";
import { Role as Roles } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Badge, Input, Select } from "@/components/ui/field";
import { Empty, PageHeader, Pagination, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { db } from "@/server/db";
import { can, requirePermission } from "@/server/roles";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/admin-shared";
import { param, parsePage, revenueWhere } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customers" };

const PER_PAGE = 30;

export default async function CustomersPage(props: PageProps<"/admin/customers">) {
  const me = await requirePermission("customers.view");
  const canManageStaff = can(me, "staff.manage");
  const sp = await props.searchParams;
  const q = param(sp.q);
  const roleParam = param(sp.role);
  const role = (Object.values(Roles) as string[]).includes(roleParam) ? (roleParam as Role) : undefined;
  const page = parsePage(sp.page);

  const where: Prisma.UserWhereInput = {
    ...(q && { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] }),
    ...(role && { role }),
  };

  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: { id: true, email: true, name: true, role: true, loyaltyPoints: true, createdAt: true, _count: { select: { orders: true } } },
    }),
  ]);
  const spent = users.length
    ? await db.order.groupBy({
        by: ["userId"],
        where: { AND: [revenueWhere, { userId: { in: users.map((u) => u.id) } }] },
        _sum: { total: true },
      })
    : [];
  const spentBy = new Map(spent.map((s) => [s.userId, s._sum.total ?? 0]));
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  const href = (p: number) => {
    const s = new URLSearchParams();
    if (q) s.set("q", q);
    if (role) s.set("role", role);
    if (p > 1) s.set("page", String(p));
    const qs = s.toString();
    return qs ? `/admin/customers?${qs}` : "/admin/customers";
  };

  return (
    <>
      <PageHeader eyebrow="People" title="Customers">
        {total} account{total === 1 ? "" : "s"}
        {canManageStaff ? " · give someone staff access from the Staff page" : ""}
      </PageHeader>

      <form method="get" role="search" className="mb-6 grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <label className="block">
          <span className="sr-only">Search customers</span>
          <Input type="search" name="q" defaultValue={q} placeholder="Search by email or name" />
        </label>
        <label className="block">
          <span className="sr-only">Role</span>
          <Select name="role" defaultValue={role ?? ""}>
            <option value="">All roles</option>
            {Object.values(Roles).map((r) => (
              <option key={r} value={r}>
                {r.toLowerCase()}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" size="sm" variant="outline">
          Filter
        </Button>
      </form>

      <Section title="Accounts">
        {users.length ? (
          <Table className="min-w-[760px]">
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Joined</Th>
                <Th className="text-right">Orders</Th>
                <Th className="text-right">Spent</Th>
                <Th className="text-right">Points</Th>
                <Th>Role</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <Td>
                    <p>{u.name ?? <span className="text-subtle">No name</span>}</p>
                    <p className="text-xs text-muted">{u.email}</p>
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{fmtDate(u.createdAt)}</Td>
                  <Td className="text-right tabular-nums">
                    {u._count.orders ? (
                      <Link href={`/admin/orders?q=${encodeURIComponent(u.email)}`} className={linkClass}>
                        {u._count.orders}
                      </Link>
                    ) : (
                      0
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{formatMoney(spentBy.get(u.id) ?? 0)}</Td>
                  <Td className="text-right tabular-nums text-muted">{u.loyaltyPoints}</Td>
                  <Td>
                    <Badge tone={u.role === "CUSTOMER" ? "muted" : "gold"}>
                      {u.role.toLowerCase()}
                      {u.id === me.id ? " · you" : ""}
                    </Badge>
                    {canManageStaff && u.id !== me.id && (
                      <Link href={`/admin/staff?user=${u.id}`} className={`ms-3 text-xs ${linkClass}`}>
                        {u.role === "CUSTOMER" ? "Make staff" : "Manage"}
                      </Link>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No accounts match.</Empty>
        )}
        <Pagination page={page} pages={pages} href={href} />
      </Section>
    </>
  );
}
