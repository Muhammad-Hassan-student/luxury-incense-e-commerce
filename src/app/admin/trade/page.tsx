import Link from "next/link";
import type { Prisma, TradeStatus } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/field";
import { Empty, Kpi, PageHeader, Pagination, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { db } from "@/server/db";
import { requireAnyPermission } from "@/server/roles";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/admin-shared";
import { param, parsePage } from "@/lib/admin-queries";
import { TERMS_LABEL, TRADE_STATUS_LABEL, businessTypeLabel, tradeStatusTone } from "@/components/trade/trade-rules";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trade accounts" };

const STATUSES: TradeStatus[] = ["PENDING", "APPROVED", "SUSPENDED", "REJECTED"];
const PER_PAGE = 30;

export default async function TradeAccountsPage(props: PageProps<"/admin/trade">) {
  await requireAnyPermission("trade.view", "trade.manage");
  const sp = await props.searchParams;
  const q = param(sp.q).slice(0, 100);
  const statusParam = param(sp.status).toUpperCase();
  const status = STATUSES.find((s) => s === statusParam);
  const page = parsePage(sp.page);

  const where: Prisma.TradeAccountWhereInput = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { businessName: { contains: q, mode: "insensitive" } },
            { contactName: { contains: q, mode: "insensitive" } },
            { taxId: { contains: q, mode: "insensitive" } },
            { user: { email: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [counts, total, accounts, openQuotes] = await Promise.all([
    db.tradeAccount.groupBy({ by: ["status"], _count: true }),
    db.tradeAccount.count({ where }),
    db.tradeAccount.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: { tier: { select: { name: true } }, user: { select: { email: true } } },
    }),
    db.quote.count({ where: { status: "REQUESTED" } }),
  ]);
  const balances = accounts.length
    ? await db.order.groupBy({
        by: ["tradeAccountId"],
        where: { tradeAccountId: { in: accounts.map((a) => a.id) }, paidAt: null, status: { notIn: ["CANCELLED", "REFUNDED"] } },
        _sum: { total: true },
      })
    : [];
  const balanceOf = new Map(balances.map((b) => [b.tradeAccountId, b._sum.total ?? 0]));
  const count = (s: TradeStatus) => counts.find((c) => c.status === s)?._count ?? 0;
  const href = (o: { status?: string; q?: string; page?: number }) => {
    const p = new URLSearchParams();
    if (o.status) p.set("status", o.status.toLowerCase());
    if (o.q) p.set("q", o.q);
    if (o.page && o.page > 1) p.set("page", String(o.page));
    const s = p.toString();
    return `/admin/trade${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        eyebrow="Trade"
        title="Trade accounts"
        actions={
          <div className="flex items-center gap-6 text-xs uppercase tracking-[0.2em]">
            <Link href="/admin/trade/tiers" className={linkClass}>
              Price tiers
            </Link>
            <Link href="/admin/trade/packs" className={linkClass}>
              Case packs
            </Link>
            <Link href="/admin/trade/quotes" className={linkClass}>
              Quotes{openQuotes ? ` (${openQuotes})` : ""}
            </Link>
          </div>
        }
      >
        Applications, approved buyers and their terms.
      </PageHeader>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Awaiting review" value={count("PENDING")} />
        <Kpi label="Approved" value={count("APPROVED")} />
        <Kpi label="Suspended" value={count("SUSPENDED")} />
        <Kpi label="Quote requests" value={openQuotes} hint="Waiting for a price" />
      </div>

      <Section
        title={status ? TRADE_STATUS_LABEL[status] : "All accounts"}
        actions={
          <form className="flex items-center gap-3" action="/admin/trade">
            {status ? <input type="hidden" name="status" value={status.toLowerCase()} /> : null}
            <label className="sr-only" htmlFor="trade-q">
              Search accounts
            </label>
            <input
              id="trade-q"
              name="q"
              defaultValue={q}
              placeholder="Business, contact, email, tax ID"
              className="h-8 w-56 border-0 border-b border-line-strong bg-transparent text-sm text-fg placeholder:text-subtle focus:border-gold focus:outline-none"
            />
          </form>
        }
      >
        <nav aria-label="Filter by status" className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
          {[undefined, ...STATUSES].map((s) => {
            const active = s === status;
            return (
              <Link
                key={s ?? "all"}
                href={href({ status: s, q })}
                aria-current={active ? "page" : undefined}
                className={`border px-3 py-1 text-[0.625rem] uppercase tracking-[0.2em] transition-colors ${active ? "border-gold text-gold" : "border-line text-muted hover:text-fg"}`}
              >
                {s ? `${TRADE_STATUS_LABEL[s]} · ${count(s)}` : "All"}
              </Link>
            );
          })}
        </nav>
        {accounts.length ? (
          <Table className="min-w-[900px]">
            <thead>
              <tr>
                <Th>Business</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th>Tier · terms</Th>
                <Th className="text-right">Outstanding</Th>
                <Th>Applied</Th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const owed = balanceOf.get(a.id) ?? 0;
                return (
                  <tr key={a.id}>
                    <Td>
                      <Link href={`/admin/trade/${a.id}`} className={linkClass}>
                        {a.businessName}
                      </Link>
                      <p className="text-xs text-subtle">
                        {a.contactName} · {a.user.email}
                      </p>
                    </Td>
                    <Td className="text-muted">{businessTypeLabel(a.businessType)}</Td>
                    <Td>
                      <Badge tone={tradeStatusTone(a.status)}>{TRADE_STATUS_LABEL[a.status]}</Badge>
                    </Td>
                    <Td className="text-xs text-muted">{a.status === "APPROVED" || a.status === "SUSPENDED" ? `${a.tier?.name ?? "No tier"} · ${TERMS_LABEL[a.terms]}` : "—"}</Td>
                    <Td className="text-right tabular-nums">
                      {owed ? formatMoney(owed) : <span className="text-subtle">—</span>}
                      {a.creditLimit && a.terms !== "PREPAID" ? <p className="text-xs text-subtle">of {formatMoney(a.creditLimit)}</p> : null}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(a.createdAt)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <Empty>{q || status ? "No accounts match." : "No trade applications yet."}</Empty>
        )}
        <Pagination page={page} pages={Math.ceil(total / PER_PAGE)} href={(p) => href({ status, q, page: p })} />
      </Section>
    </>
  );
}
