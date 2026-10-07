import Link from "next/link";
import type { Prisma, ReturnStatus } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Badge, Input, Select } from "@/components/ui/field";
import { Empty, PageHeader, Pagination, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { ReturnPolicyForm } from "@/components/admin/return-actions";
import { db } from "@/server/db";
import { can, requirePermission } from "@/server/roles";
import { getReturnSettings } from "@/server/returns";
import { formatMoney } from "@/lib/money";
import { fmtDateTime } from "@/lib/admin-shared";
import { param, parsePage } from "@/lib/admin-queries";
import { OPEN_STATUSES, RESOLUTION_LABEL, RETURN_STATUSES, RETURN_STATUS_LABEL, returnStatusTone } from "@/lib/returns";

export const dynamic = "force-dynamic";
export const metadata = { title: "Returns" };

const PER_PAGE = 25;

export default async function ReturnsPage(props: PageProps<"/admin/returns">) {
  const access = await requirePermission("returns.manage");
  const sp = await props.searchParams;
  const status = param(sp.status);
  const q = param(sp.q);
  const page = parsePage(sp.page);

  const and: Prisma.ReturnRequestWhereInput[] = [];
  if (status === "OPEN") and.push({ status: { in: OPEN_STATUSES } });
  else if ((RETURN_STATUSES as string[]).includes(status)) and.push({ status: status as ReturnStatus });
  if (q) {
    and.push({
      OR: [
        { number: { contains: q, mode: "insensitive" } },
        { order: { number: { contains: q, mode: "insensitive" } } },
        { order: { email: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  const where: Prisma.ReturnRequestWhereInput = { AND: and };

  const canPolicy = can(access, "settings.manage");
  const [total, returns, counts, settings, categories] = await Promise.all([
    db.returnRequest.count({ where }),
    db.returnRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        order: { select: { id: true, number: true, email: true } },
        items: { select: { quantity: true } },
      },
    }),
    db.returnRequest.groupBy({ by: ["status"], where: { status: { in: OPEN_STATUSES } }, _count: true }),
    getReturnSettings(),
    canPolicy ? db.category.findMany({ orderBy: { position: "asc" }, select: { slug: true, name: true } }) : [],
  ]);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const open = Object.fromEntries(counts.map((c) => [c.status, c._count])) as Partial<Record<ReturnStatus, number>>;

  const href = (p: number) => {
    const s = new URLSearchParams();
    if (status) s.set("status", status);
    if (q) s.set("q", q);
    if (p > 1) s.set("page", String(p));
    const qs = s.toString();
    return qs ? `/admin/returns?${qs}` : "/admin/returns";
  };

  return (
    <>
      <PageHeader eyebrow="Fulfilment" title="Returns">
        {open.REQUESTED ?? 0} to review · {open.APPROVED ?? 0} awaiting parcel · {open.RECEIVED ?? 0} to resolve · {settings.windowDays}-day window
        {settings.restockingFeePercent ? ` · ${settings.restockingFeePercent}% restocking fee` : ""}
        {settings.enabled ? "" : " · online returns paused"}
      </PageHeader>

      <form method="get" className="mb-6 grid gap-4 sm:grid-cols-[1fr_14rem_auto] sm:items-end" role="search">
        <label className="block">
          <span className="sr-only">Search returns</span>
          <Input name="q" defaultValue={q} placeholder="Search by RMA, order number or email" type="search" />
        </label>
        <label className="block">
          <span className="sr-only">Status</span>
          <Select name="status" defaultValue={status}>
            <option value="">All statuses</option>
            <option value="OPEN">Open (needs action)</option>
            {RETURN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {RETURN_STATUS_LABEL[s]}
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
              <Link href="/admin/returns">Clear</Link>
            </Button>
          ) : null}
        </div>
      </form>

      <Section title={`Returns · ${total}`}>
        {returns.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Return</Th>
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th>Requested</Th>
                <Th className="text-right">Pieces</Th>
                <Th>Wants</Th>
                <Th>Status</Th>
                <Th className="text-right">Refunded</Th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-bg-soft/50">
                  <Td>
                    <Link href={`/admin/returns/${r.id}`} className={linkClass}>
                      {r.number}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/admin/orders/${r.order.id}`} className="text-muted hover:text-gold">
                      {r.order.number}
                    </Link>
                  </Td>
                  <Td className="max-w-[14rem] truncate text-muted">{r.order.email}</Td>
                  <Td className="whitespace-nowrap text-muted">{fmtDateTime(r.requestedAt)}</Td>
                  <Td className="text-right tabular-nums text-muted">{r.items.reduce((s, i) => s + i.quantity, 0)}</Td>
                  <Td className="text-xs uppercase tracking-[0.15em] text-muted">{RESOLUTION_LABEL[r.resolution ?? r.preferred]}</Td>
                  <Td>
                    <Badge tone={returnStatusTone(r.status)}>{RETURN_STATUS_LABEL[r.status]}</Badge>
                  </Td>
                  <Td className="text-right tabular-nums">{r.refundAmount != null ? formatMoney(r.refundAmount) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>{status || q ? "No returns match." : "No returns yet."}</Empty>
        )}
        <Pagination page={page} pages={pages} href={href} />
      </Section>

      {canPolicy ? (
        <Section title="Return policy" className="mt-8">
          <ReturnPolicyForm settings={settings} categories={categories} />
        </Section>
      ) : null}
    </>
  );
}
