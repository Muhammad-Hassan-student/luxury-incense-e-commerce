import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/field";
import { Empty, PageHeader, Section, StatusBadge, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { RejectForm, SuspendControls, TradeStaffNotes, TradeTermsForm } from "@/components/admin/trade/account-actions";
import { MarkTradeInvoicePaidButton } from "@/components/admin/trade/mark-paid-button";
import { TradeStatementCard, InvoiceStateBadge } from "@/components/trade/statement";
import { QUOTE_STATUS_LABEL, TERMS_LABEL, TRADE_STATUS_LABEL, businessTypeLabel, invoiceState, minimumOrderFor, quoteStatusTone, tradeStatusTone } from "@/components/trade/trade-rules";
import { db } from "@/server/db";
import { can, requireAnyPermission } from "@/server/roles";
import { asTradeAddress, tradeStatement } from "@/server/trade";
import { expireQuotes } from "@/server/trade-quotes";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/admin-shared";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/admin/trade/[id]">) {
  const { id } = await props.params;
  const a = await db.tradeAccount.findUnique({ where: { id }, select: { businessName: true } });
  return { title: a ? a.businessName : "Trade account" };
}

export default async function TradeAccountPage(props: PageProps<"/admin/trade/[id]">) {
  const user = await requireAnyPermission("trade.view", "trade.manage");
  const canManage = can(user, "trade.manage");
  const { id } = await props.params;
  const account = await db.tradeAccount.findUnique({
    where: { id },
    include: { tier: true, user: { select: { id: true, email: true, name: true, createdAt: true } } },
  });
  if (!account) notFound();
  await expireQuotes({ tradeAccountId: id });

  const [statement, orders, quotes, tiers, reviewer] = await Promise.all([
    tradeStatement(account),
    db.order.findMany({ where: { tradeAccountId: id }, orderBy: { placedAt: "desc" }, take: 50 }),
    db.quote.findMany({ where: { tradeAccountId: id }, orderBy: { createdAt: "desc" }, take: 20, include: { _count: { select: { items: true } } } }),
    db.priceTier.findMany({ orderBy: { discountPercent: "asc" } }),
    account.reviewedById ? db.user.findUnique({ where: { id: account.reviewedById }, select: { name: true, email: true } }) : null,
  ]);
  const addr = asTradeAddress(account.address);
  const minimum = minimumOrderFor(account, account.tier);
  const now = new Date();

  const facts: [string, ReactNode][] = [
    ["Business type", businessTypeLabel(account.businessType)],
    ["Contact", `${account.contactName} · ${account.phone}`],
    ["Login email", account.user.email],
    ["GSTIN / tax ID", account.taxId ?? "—"],
    [
      "Website",
      account.website ? (
        <a href={account.website} target="_blank" rel="noreferrer noopener" className={linkClass}>
          {account.website.replace(/^https?:\/\//, "")}
        </a>
      ) : (
        "—"
      ),
    ],
    ["Expected volume", account.expectedMonthly ?? "—"],
    ["Address", addr ? [addr.line1, addr.line2, `${addr.city}, ${addr.state} ${addr.postalCode}`, addr.country].filter(Boolean).join(", ") : "—"],
    ["Applied", fmtDateTime(account.createdAt)],
    ["Reviewed", account.reviewedAt ? `${fmtDateTime(account.reviewedAt)}${reviewer ? ` by ${reviewer.name ?? reviewer.email}` : ""}` : "—"],
  ];

  return (
    <>
      <Link href="/admin/trade" className="mb-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted hover:text-gold">
        <ArrowLeft className="size-3.5" aria-hidden /> Trade accounts
      </Link>
      <PageHeader eyebrow="Trade account" title={account.businessName} actions={<Badge tone={tradeStatusTone(account.status)}>{TRADE_STATUS_LABEL[account.status]}</Badge>}>
        {account.status === "APPROVED" || account.status === "SUSPENDED"
          ? `${account.tier ? `${account.tier.name} (${account.tier.discountPercent}% off)` : "No tier"} · ${TERMS_LABEL[account.terms]} · minimum ${minimum ? formatMoney(minimum) : "none"}`
          : "Application"}
      </PageHeader>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_24rem] [&>*]:min-w-0">
        <div className="space-y-8">
          {account.status === "APPROVED" || account.status === "SUSPENDED" || statement.openInvoices ? (
            <TradeStatementCard statement={statement} terms={account.terms} />
          ) : null}

          <Section title="Application">
            <dl className="grid gap-x-8 gap-y-4 p-5 text-sm sm:grid-cols-2">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">{k}</dt>
                  <dd className="mt-1 text-fg">{v}</dd>
                </div>
              ))}
            </dl>
            {account.message ? (
              <div className="border-t border-line p-5">
                <p className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">Message</p>
                <p className="mt-2 whitespace-pre-wrap text-sm italic text-fg">“{account.message}”</p>
              </div>
            ) : null}
            {account.rejectionReason && account.status === "REJECTED" ? (
              <div className="border-t border-line p-5 text-sm">
                <p className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">Declined because</p>
                <p className="mt-2 text-ember">{account.rejectionReason}</p>
              </div>
            ) : null}
          </Section>

          <Section title={`Orders · ${orders.length}`}>
            {orders.length ? (
              <Table className="min-w-[760px]">
                <thead>
                  <tr>
                    <Th>Order</Th>
                    <Th>PO</Th>
                    <Th>Status</Th>
                    <Th>Invoice</Th>
                    <Th>Due</Th>
                    <Th className="text-right">Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const st = invoiceState(o, now);
                    return (
                      <tr key={o.id}>
                        <Td>
                          <Link href={`/admin/orders/${o.id}`} className={linkClass}>
                            {o.number}
                          </Link>
                          <p className="text-xs text-subtle">{fmtDate(o.placedAt)}</p>
                        </Td>
                        <Td className="text-xs text-muted">{o.poNumber ?? "—"}</Td>
                        <Td>
                          <StatusBadge status={o.status} reservedUntil={o.reservedUntil} />
                        </Td>
                        <Td>
                          <InvoiceStateBadge state={st} />
                          {canManage && st !== "paid" && st !== "void" && !o.reservedUntil ? (
                            <div className="mt-2">
                              <MarkTradeInvoicePaidButton orderId={o.id} amount={formatMoney(o.total)} />
                            </div>
                          ) : null}
                        </Td>
                        <Td className="whitespace-nowrap text-xs text-muted">{o.paidAt ? `paid ${fmtDate(o.paidAt)}` : fmtDate(o.dueDate)}</Td>
                        <Td className="text-right tabular-nums">{formatMoney(o.total)}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : (
              <Empty>No trade orders yet.</Empty>
            )}
          </Section>

          <Section title={`Quotes · ${quotes.length}`}>
            {quotes.length ? (
              <ul className="divide-y divide-line">
                {quotes.map((q) => (
                  <li key={q.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                    <Link href={`/admin/trade/quotes/${q.id}`} className={linkClass}>
                      {q.number}
                    </Link>
                    <span className="text-xs text-muted">
                      {q._count.items} lines · {fmtDate(q.createdAt)}
                    </span>
                    <Badge tone={quoteStatusTone(q.status)}>{QUOTE_STATUS_LABEL[q.status]}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No quotes.</Empty>
            )}
          </Section>
        </div>

        <aside className="space-y-8">
          {canManage ? (
            <>
              {account.status !== "SUSPENDED" ? (
                <Section title={account.status === "APPROVED" ? "Tier & terms" : "Approve"}>
                  <TradeTermsForm
                    id={account.id}
                    status={account.status}
                    tiers={tiers.map((t) => ({ id: t.id, name: t.name, discountPercent: t.discountPercent, minOrderValue: t.minOrderValue }))}
                    initial={{ tierId: account.tierId, terms: account.terms, creditLimit: account.creditLimit, minOrderValue: account.minOrderValue }}
                  />
                  {!tiers.length ? (
                    <p className="border-t border-line px-5 py-3 text-xs text-muted">
                      No price tiers yet —{" "}
                      <Link href="/admin/trade/tiers?new=1" className={linkClass}>
                        create one
                      </Link>
                      .
                    </p>
                  ) : null}
                </Section>
              ) : null}
              {account.status === "PENDING" ? (
                <Section title="Decline">
                  <div className="p-5">
                    <RejectForm id={account.id} />
                  </div>
                </Section>
              ) : null}
              {account.status === "APPROVED" || account.status === "SUSPENDED" ? (
                <Section title={account.status === "SUSPENDED" ? "Suspended" : "Suspend"}>
                  <div className="space-y-3 p-5">
                    {account.status === "SUSPENDED" ? <p className="text-sm text-muted">The buyer can’t place orders or request quotes. Reactivating restores their tier and terms.</p> : null}
                    <SuspendControls id={account.id} status={account.status} />
                  </div>
                </Section>
              ) : null}
            </>
          ) : (
            <Section title="Terms">
              <p className="p-5 text-sm text-muted">You can view this account. Approving and changing terms needs the “trade.manage” permission.</p>
            </Section>
          )}
          <Section title="Staff notes">
            <div className="p-5">
              <TradeStaffNotes id={account.id} notes={account.staffNotes ?? ""} canEdit={canManage} />
            </div>
          </Section>
        </aside>
      </div>
    </>
  );
}
