import Link from "next/link";
import type { QuoteStatus } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/field";
import { Empty, PageHeader, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { QUOTE_STATUS_LABEL, quoteStatusTone } from "@/components/trade/trade-rules";
import { db } from "@/server/db";
import { requireAnyPermission } from "@/server/roles";
import { expireQuotes } from "@/server/trade-quotes";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/admin-shared";
import { param } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trade quotes" };

const STATUSES: QuoteStatus[] = ["REQUESTED", "QUOTED", "ACCEPTED", "DECLINED", "EXPIRED", "CANCELLED"];

export default async function TradeQuotesAdminPage(props: PageProps<"/admin/trade/quotes">) {
  await requireAnyPermission("trade.view", "trade.manage");
  await expireQuotes();
  const sp = await props.searchParams;
  const statusParam = param(sp.status).toUpperCase();
  const status = STATUSES.find((s) => s === statusParam);
  const [quotes, counts] = await Promise.all([
    db.quote.findMany({
      where: status ? { status } : {},
      orderBy: [{ createdAt: "desc" }],
      take: 200,
      include: {
        tradeAccount: { select: { id: true, businessName: true } },
        items: { select: { quantity: true, quotedPrice: true, variantId: true } },
        order: { select: { id: true, number: true } },
      },
    }),
    db.quote.groupBy({ by: ["status"], _count: true }),
  ]);
  const count = (s: QuoteStatus) => counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <>
      <PageHeader eyebrow="Trade" title="Quotes" actions={<Link href="/admin/trade" className={`text-xs uppercase tracking-[0.2em] ${linkClass}`}>Trade accounts</Link>}>
        Requests for quotation from trade buyers. Price every line, map custom lines to a catalogue variant, and send.
      </PageHeader>
      <Section title={status ? QUOTE_STATUS_LABEL[status] : "All quotes"}>
        <nav aria-label="Filter by status" className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
          {[undefined, ...STATUSES].map((s) => {
            const active = s === status;
            return (
              <Link
                key={s ?? "all"}
                href={s ? `/admin/trade/quotes?status=${s.toLowerCase()}` : "/admin/trade/quotes"}
                aria-current={active ? "page" : undefined}
                className={`border px-3 py-1 text-[0.625rem] uppercase tracking-[0.2em] transition-colors ${active ? "border-gold text-gold" : "border-line text-muted hover:text-fg"}`}
              >
                {s ? `${QUOTE_STATUS_LABEL[s]} · ${count(s)}` : "All"}
              </Link>
            );
          })}
        </nav>
        {quotes.length ? (
          <Table className="min-w-[820px]">
            <thead>
              <tr>
                <Th>Quote</Th>
                <Th>Buyer</Th>
                <Th>Status</Th>
                <Th className="text-right">Lines</Th>
                <Th className="text-right">Value</Th>
                <Th>Valid until</Th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => {
                const value = q.items.every((i) => i.quotedPrice != null) ? q.items.reduce((s, i) => s + (i.quotedPrice ?? 0) * i.quantity, 0) : null;
                const unmapped = q.items.filter((i) => !i.variantId).length;
                return (
                  <tr key={q.id}>
                    <Td>
                      <Link href={`/admin/trade/quotes/${q.id}`} className={linkClass}>
                        {q.number}
                      </Link>
                      <p className="text-xs text-subtle">{fmtDate(q.createdAt)}</p>
                    </Td>
                    <Td>
                      <Link href={`/admin/trade/${q.tradeAccount.id}`} className="hover:text-gold">
                        {q.tradeAccount.businessName}
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={quoteStatusTone(q.status)}>{QUOTE_STATUS_LABEL[q.status]}</Badge>
                      {q.order ? (
                        <p className="mt-1 text-xs">
                          <Link href={`/admin/orders/${q.order.id}`} className={linkClass}>
                            {q.order.number}
                          </Link>
                        </p>
                      ) : null}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {q.items.length}
                      {unmapped ? <p className="text-xs text-ember">{unmapped} unmapped</p> : null}
                    </Td>
                    <Td className="text-right tabular-nums">{value != null ? formatMoney(value) : "—"}</Td>
                    <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(q.validUntil)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <Empty>No quotes{status ? " with this status" : " yet"}.</Empty>
        )}
      </Section>
    </>
  );
}
