import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/field";
import { PageHeader, Section, StatusBadge, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { ReceiveReturn, ResolveReturn, ReturnNote, ReviewReturn } from "@/components/admin/return-actions";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { previewReturnRefund } from "@/server/returns";
import { formatMoney } from "@/lib/money";
import { fmtDateTime } from "@/lib/admin-shared";
import { CONDITION_LABEL, RESOLUTION_LABEL, RETURN_STATUS_LABEL, refundMethodText, returnStatusTone, returnTimeline } from "@/lib/returns";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/admin/returns/[id]">) {
  const { id } = await props.params;
  const r = await db.returnRequest.findUnique({ where: { id }, select: { number: true } });
  return { title: r ? `Return ${r.number}` : "Return" };
}

export default async function ReturnDetailPage(props: PageProps<"/admin/returns/[id]">) {
  await requirePermission("returns.manage");
  const { id } = await props.params;
  const r = await db.returnRequest.findUnique({
    where: { id },
    include: {
      items: { orderBy: { id: "asc" }, include: { orderItem: true } },
      order: { include: { payments: { orderBy: { createdAt: "asc" } }, user: { select: { name: true, email: true } } } },
    },
  });
  if (!r) notFound();

  const [card, replacement, quote, waived, others] = await Promise.all([
    r.giftCardId ? db.giftCard.findUnique({ where: { id: r.giftCardId }, select: { id: true, code: true, balance: true } }) : null,
    r.exchangeOrderId ? db.order.findUnique({ where: { id: r.exchangeOrderId }, select: { id: true, number: true, status: true, reservedUntil: true } }) : null,
    r.status === "RECEIVED" ? previewReturnRefund(r.id, false) : null,
    r.status === "RECEIVED" ? previewReturnRefund(r.id, true) : null,
    db.returnRequest.findMany({ where: { orderId: r.orderId, id: { not: r.id } }, orderBy: { createdAt: "asc" }, select: { id: true, number: true, status: true } }),
  ]);

  const o = r.order;
  const payment = o.payments.find((p) => p.status === "CAPTURED") ?? o.payments[0];
  const refundTo = [
    payment && o.total - o.giftCardAmount > 0
      ? payment.provider === "STRIPE" || payment.provider === "RAZORPAY"
        ? `${payment.provider.toLowerCase()} (partial refund at the provider)`
        : `manual transfer — ${payment.provider === "COD" ? "cash on delivery" : "trade invoice"} order`
      : null,
    o.giftCardAmount > 0 ? `gift card ${o.giftCardCode} (its share)` : null,
  ]
    .filter(Boolean)
    .join(" then ");
  const steps = returnTimeline(r);
  const units = r.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <>
      <Link href="/admin/returns" className="mb-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted hover:text-gold">
        <ArrowLeft className="size-3.5" aria-hidden /> Returns
      </Link>
      <PageHeader eyebrow={`Requested ${fmtDateTime(r.requestedAt)}`} title={r.number} actions={<Badge tone={returnStatusTone(r.status)}>{RETURN_STATUS_LABEL[r.status]}</Badge>}>
        Order{" "}
        <Link href={`/admin/orders/${o.id}`} className={linkClass}>
          {o.number}
        </Link>{" "}
        · {o.email} · {units} piece{units === 1 ? "" : "s"} · wants {RESOLUTION_LABEL[r.preferred].toLowerCase()}
      </PageHeader>

      <div className="grid gap-8 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-8">
          <Section title={r.status === "REQUESTED" ? "Review" : r.status === "APPROVED" ? "Receive & inspect" : r.status === "RECEIVED" ? "Resolve" : "Outcome"}>
            <div className="p-5">
              {r.status === "REQUESTED" ? <ReviewReturn id={r.id} /> : null}
              {r.status === "APPROVED" ? (
                <ReceiveReturn
                  id={r.id}
                  items={r.items.map((i) => ({ id: i.id, name: i.orderItem.name, label: i.orderItem.label, quantity: i.quantity, canRestock: Boolean(i.orderItem.variantId || i.orderItem.components.length) }))}
                />
              ) : null}
              {r.status === "RECEIVED" && quote && waived ? (
                <ResolveReturn
                  id={r.id}
                  preferred={r.preferred}
                  refundTo={refundTo || "manual transfer"}
                  quote={{ feePercent: quote.feePercent, hasFee: quote.fee > 0, gross: formatMoney(quote.gross), fee: formatMoney(quote.fee), amount: formatMoney(quote.amount), waived: formatMoney(waived.amount) }}
                />
              ) : null}
              {r.status === "REFUNDED" ? (
                <div className="space-y-2 text-sm">
                  <p>
                    <span className="font-display text-2xl font-light tabular-nums">{formatMoney(r.refundAmount ?? 0)}</span>{" "}
                    <span className="text-muted">{r.resolution === "STORE_CREDIT" ? "issued as store credit" : `refunded — ${refundMethodText(r.refundMethod)}`}</span>
                  </p>
                  {r.restockingFee ? <p className="text-muted">Restocking fee kept: {formatMoney(r.restockingFee)}</p> : null}
                  {r.refundMethod?.includes("MANUAL") ? <p className="text-ember">Cash on delivery / invoice order: transfer {formatMoney(r.providerAmount)} to the customer by hand.</p> : null}
                  {card ? (
                    <p className="text-muted">
                      Gift card <span className="font-mono text-fg">{card.code}</span> · balance {formatMoney(card.balance)}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {r.status === "EXCHANGED" && replacement ? (
                <p className="flex flex-wrap items-center gap-3 text-sm">
                  Replacement order
                  <Link href={`/admin/orders/${replacement.id}`} className={linkClass}>
                    {replacement.number}
                  </Link>
                  <StatusBadge status={replacement.status} reservedUntil={replacement.reservedUntil} />
                </p>
              ) : null}
              {r.status === "REJECTED" ? <p className="text-sm text-ember">Declined: {r.rejectionReason}</p> : null}
              {r.status === "CANCELLED" ? <p className="text-sm text-muted">Cancelled by the customer.</p> : null}
            </div>
          </Section>

          <Section title={`Items · ${r.items.length}`}>
            <Table className="min-w-[560px]">
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th>SKU</Th>
                  <Th className="text-right">Returned</Th>
                  <Th className="text-right">Unit paid</Th>
                  <Th>Condition</Th>
                  <Th>Restocked</Th>
                </tr>
              </thead>
              <tbody>
                {r.items.map((i) => (
                  <tr key={i.id}>
                    <Td>
                      <p>{i.orderItem.name}</p>
                      <p className="text-xs text-subtle">{i.orderItem.label}</p>
                    </Td>
                    <Td className="font-mono text-xs text-muted">{i.orderItem.sku}</Td>
                    <Td className="text-right tabular-nums">
                      {i.quantity} <span className="text-subtle">/ {i.orderItem.quantity}</span>
                    </Td>
                    <Td className="text-right tabular-nums text-muted">{formatMoney(i.orderItem.unitPrice)}</Td>
                    <Td className="text-muted">{i.condition ? CONDITION_LABEL[i.condition] : "—"}</Td>
                    <Td className="text-muted">{r.receivedAt ? (i.restock ? "Yes" : "No") : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Section>

          <Section title="Progress">
            <ol className="space-y-0 px-5 py-4">
              {steps.map((s) => (
                <li key={s.key} className="relative border-l border-line py-3 pl-6">
                  <span className={`absolute -left-[3.5px] top-[1.15rem] size-1.5 ${s.tone === "done" ? "bg-gold" : s.tone === "stop" ? "bg-ember" : "bg-line-strong"}`} aria-hidden />
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className={`text-[0.625rem] uppercase tracking-[0.2em] ${s.tone === "todo" ? "text-subtle" : s.tone === "stop" ? "text-ember" : "text-gold"}`}>{s.label}</span>
                    <span className="text-xs text-subtle">{s.at ? fmtDateTime(s.at) : "pending"}</span>
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <aside className="space-y-8">
          <Section title="Customer’s request">
            <div className="space-y-3 px-5 py-4 text-sm">
              <p>{r.reason}</p>
              {r.customerNote ? <p className="italic text-muted">“{r.customerNote}”</p> : <p className="text-subtle">No note.</p>}
              <p className="text-xs text-subtle">
                {o.user?.name ?? "—"} · {o.email}
              </p>
            </div>
          </Section>

          <Section title="Order">
            <dl className="space-y-2 px-5 py-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Order</dt>
                <dd>
                  <Link href={`/admin/orders/${o.id}`} className={linkClass}>
                    {o.number}
                  </Link>
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Total</dt>
                <dd className="tabular-nums">{formatMoney(o.total)}</dd>
              </div>
              {o.giftCardAmount ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Gift card</dt>
                  <dd className="tabular-nums">{formatMoney(o.giftCardAmount)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Payment</dt>
                <dd className="text-xs uppercase tracking-[0.15em]">{payment ? `${payment.provider} · ${payment.status.toLowerCase()}` : "—"}</dd>
              </div>
              {others.length ? (
                <div className="border-t border-line pt-2">
                  <dt className="text-muted">Other returns</dt>
                  <dd className="mt-1 flex flex-wrap gap-x-3">
                    {others.map((x) => (
                      <Link key={x.id} href={`/admin/returns/${x.id}`} className={linkClass}>
                        {x.number} <span className="text-xs text-subtle">({RETURN_STATUS_LABEL[x.status].toLowerCase()})</span>
                      </Link>
                    ))}
                  </dd>
                </div>
              ) : null}
            </dl>
          </Section>

          <Section title="Notes">
            <div className="p-5">
              <ReturnNote id={r.id} note={r.staffNote ?? ""} />
            </div>
          </Section>
        </aside>
      </div>
    </>
  );
}
