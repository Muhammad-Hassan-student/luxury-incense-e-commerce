import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/field";
import { Empty, PageHeader, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { GiftCardActiveToggle, IssueGiftCardForm } from "@/components/admin/gift-card-admin";
import { db } from "@/server/db";
import { can, requireAnyPermission } from "@/server/roles";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/admin-shared";
import { param } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Gift cards" };

const isExpired = (d: Date | null) => Boolean(d && d.getTime() < Date.now());

export default async function GiftCardsPage(props: PageProps<"/admin/gift-cards">) {
  const user = await requireAnyPermission("promotions.view", "promotions.manage");
  const canEdit = can(user, "promotions.manage");
  const q = param((await props.searchParams).q)?.trim();

  const where: Prisma.GiftCardWhereInput = q
    ? { OR: [{ code: { contains: q.toUpperCase() } }, { recipientEmail: { contains: q, mode: "insensitive" } }, { recipient: { contains: q, mode: "insensitive" } }] }
    : {};
  const [cards, totals] = await Promise.all([
    db.giftCard.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }),
    db.giftCard.aggregate({ where: { isActive: true }, _sum: { balance: true, initial: true }, _count: true }),
  ]);
  const orders = await db.order.findMany({
    where: { id: { in: cards.map((c) => c.sourceOrderId).filter((x): x is string => Boolean(x)) } },
    select: { id: true, number: true },
  });
  const orderNumber = new Map(orders.map((o) => [o.id, o.number]));

  return (
    <>
      <PageHeader eyebrow="Promotions" title="Gift cards">
        {totals._count} active · {formatMoney(totals._sum.balance ?? 0)} outstanding of {formatMoney(totals._sum.initial ?? 0)} issued
      </PageHeader>

      {canEdit && (
        <Section title="Issue a gift card">
          <IssueGiftCardForm />
        </Section>
      )}

      <Section
        title="All cards"
        actions={
          <form className="flex items-center gap-2">
            <input name="q" defaultValue={q} placeholder="Code, name or email" aria-label="Search gift cards" className="h-9 w-56 border-b border-line-strong bg-transparent text-sm focus:border-gold focus:outline-none" />
          </form>
        }
      >
        {cards.length === 0 ? (
          <Empty>{q ? "No gift cards match that search." : "No gift cards yet."}</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Recipient</Th>
                <Th className="text-end">Balance</Th>
                <Th>Source</Th>
                <Th>Expires</Th>
                <Th>Status</Th>
                <Th>Active</Th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id}>
                  <Td className="font-mono text-xs tracking-wider">{c.code}</Td>
                  <Td>
                    {c.recipient ?? "—"}
                    {c.recipientEmail && <span className="block text-xs text-subtle">{c.recipientEmail}</span>}
                  </Td>
                  <Td className="text-end tabular-nums">
                    {formatMoney(c.balance)}
                    <span className="block text-xs text-subtle">of {formatMoney(c.initial)}</span>
                  </Td>
                  <Td>
                    {c.sourceOrderId && orderNumber.get(c.sourceOrderId) ? (
                      <Link href={`/admin/orders/${c.sourceOrderId}`} className={linkClass}>
                        {orderNumber.get(c.sourceOrderId)}
                      </Link>
                    ) : (
                      <span className="text-muted">Issued by staff</span>
                    )}
                  </Td>
                  <Td className="text-muted">{fmtDate(c.expiresAt)}</Td>
                  <Td>
                    {!c.isActive ? (
                      <Badge tone="muted">Inactive</Badge>
                    ) : isExpired(c.expiresAt) ? (
                      <Badge tone="ember">Expired</Badge>
                    ) : c.balance === 0 ? (
                      <Badge tone="muted">Spent</Badge>
                    ) : (
                      <Badge>Live</Badge>
                    )}
                  </Td>
                  <Td>
                    <GiftCardActiveToggle id={c.id} code={c.code} isActive={c.isActive} canEdit={canEdit} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
