import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/field";
import { OrderNotes, OrderStatusActions, RefundAction } from "@/components/admin/order-actions";
import { PageHeader, Section, StatusBadge, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { db } from "@/server/db";
import { can, requirePermission } from "@/server/roles";
import { MarkTradeInvoicePaidButton } from "@/components/admin/trade/mark-paid-button";
import { nextStatuses, type ShippingAddress } from "@/server/orders";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/admin-shared";
import { RETURN_STATUS_LABEL, returnStatusTone } from "@/lib/returns";
import { OrderWhatsAppPanel } from "@/components/admin/order-whatsapp";
import { codHold } from "@/server/cod";
import { resendableNotices } from "@/server/whatsapp/admin";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/admin/orders/[id]">) {
  const { id } = await props.params;
  const o = await db.order.findUnique({ where: { id }, select: { number: true } });
  return { title: o ? `Order ${o.number}` : "Order" };
}

function asAddress(v: unknown): Partial<ShippingAddress> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Partial<ShippingAddress>) : {};
}

export default async function OrderDetailPage(props: PageProps<"/admin/orders/[id]">) {
  const user = await requirePermission("orders.view");
  const { id } = await props.params;
  const order = await db.order.findUnique({
    where: { id },
    include: {
      items: true,
      payments: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "desc" } },
      user: { select: { id: true, name: true, email: true, loyaltyPoints: true } },
      returns: { orderBy: { createdAt: "desc" }, select: { id: true, number: true, status: true, refundAmount: true, items: { select: { quantity: true } } } },
      whatsappMessages: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!order) notFound();

  const address = asAddress(order.shippingAddress);
  const canRefundPerm = can(user, "orders.refund");
  const awaitingPayment = order.status === "PENDING" && order.reservedUntil !== null;
  // Support can move orders forward and cancel unpaid ones; cancelling paid orders is for managers.
  const next = nextStatuses(order.status)
    .filter((s) => (s === "CANCELLED" ? can(user, "orders.cancel") && (canRefundPerm || order.status === "PENDING") : can(user, "orders.fulfil")))
    // COD awaiting the customer's confirmation can't be packed yet.
    .filter((s) => !(s === "PACKED" && codHold(order)));
  const hasCapture = order.payments.some((p) => p.status === "CAPTURED");
  // Once a return has paid money back, a full refund would pay it twice: remaining money goes through returns.
  const returnRefunded = order.returns.some((r) => r.status === "REFUNDED");
  const canRefund = canRefundPerm && !returnRefunded && order.status !== "REFUNDED" && order.status !== "PENDING" && (order.status !== "CANCELLED" || hasCapture);

  const rows: [string, number][] = [
    ["Subtotal", order.subtotal],
    ...(order.discount ? ([[`Discount${order.couponCode ? ` (${order.couponCode})` : ""}`, -order.discount]] as [string, number][]) : []),
    ...(order.pointsRedeemed ? ([["Points redeemed", -order.pointsRedeemed]] as [string, number][]) : []),
    [order.giftWrap ? "Shipping & gift wrap" : "Shipping", order.shipping],
    ["Tax", order.tax],
  ];

  return (
    <>
      <Link href="/admin/orders" className="mb-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted hover:text-gold">
        <ArrowLeft className="size-3.5" aria-hidden /> Orders
      </Link>
      <PageHeader
        eyebrow={`Placed ${fmtDateTime(order.placedAt)}`}
        title={order.number}
        actions={
          <div className="flex items-center gap-4">
            {!order.reservedUntil && (
              <Link href={`/admin/orders/${order.id}/invoice`} className={`text-xs uppercase tracking-[0.2em] ${linkClass}`} target="_blank">
                Invoice
              </Link>
            )}
            <StatusBadge status={order.status} reservedUntil={order.reservedUntil} codStatus={order.codStatus} />
          </div>
        }
      >
        {order.email}
        {order.user ? (
          <>
            {" · "}
            <Link href={`/admin/customers?q=${encodeURIComponent(order.user.email)}`} className={linkClass}>
              customer account
            </Link>
          </>
        ) : (
          " · guest checkout"
        )}
      </PageHeader>

      <div className="grid gap-8 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-8">
          <Section title="Fulfilment">
            <div className="space-y-6 p-5">
              <OrderStatusActions orderId={order.id} next={next} awaitingPayment={awaitingPayment} defaultCarrier={order.carrier ?? ""} />
              {order.trackingNumber ? (
                <p className="text-sm text-muted">
                  Tracking: <span className="font-mono text-fg">{order.trackingNumber}</span>
                  {order.carrier ? ` via ${order.carrier}` : ""}
                </p>
              ) : null}
              {canRefund ? (
                <div className="border-t border-line pt-6">
                  <RefundAction orderId={order.id} total={formatMoney(order.total)} />
                </div>
              ) : null}
            </div>
          </Section>

          <Section title={`Items · ${order.items.length}`}>
            <Table className="min-w-[520px]">
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th>SKU</Th>
                  <Th className="text-right">Qty</Th>
                  <Th className="text-right">Unit</Th>
                  <Th className="text-right">Line</Th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((i) => (
                  <tr key={i.id}>
                    <Td>
                      <p>{i.name}</p>
                      <p className="text-xs text-subtle">{i.label}</p>
                    </Td>
                    <Td className="font-mono text-xs text-muted">{i.sku}</Td>
                    <Td className="text-right tabular-nums">{i.quantity}</Td>
                    <Td className="text-right tabular-nums text-muted">{formatMoney(i.unitPrice)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(i.unitPrice * i.quantity)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <dl className="ml-auto max-w-sm space-y-2 px-5 py-5 text-sm">
              {rows.map(([label, v]) => (
                <div key={label} className="flex justify-between gap-6">
                  <dt className="text-muted">{label}</dt>
                  <dd className="tabular-nums">{v < 0 ? `−${formatMoney(-v)}` : formatMoney(v)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-6 border-t border-line pt-3">
                <dt className="eyebrow">Total</dt>
                <dd className="font-display text-xl font-light tabular-nums">{formatMoney(order.total)}</dd>
              </div>
            </dl>
          </Section>

          <Section title="Timeline">
            <ol className="space-y-0 px-5 py-4">
              {order.events.map((e) => (
                <li key={e.id} className="relative border-l border-line py-3 pl-6">
                  <span className="absolute -left-[3.5px] top-[1.15rem] size-1.5 bg-gold" aria-hidden />
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-[0.625rem] uppercase tracking-[0.2em] text-gold">{e.status.toLowerCase()}</span>
                    <span className="text-xs text-subtle">{fmtDateTime(e.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-sm text-fg">{e.message}</p>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <aside className="space-y-8">
          <Section title="Ship to">
            <address className="space-y-0.5 px-5 py-4 text-sm not-italic leading-relaxed text-fg">
              <p>{address.fullName ?? "—"}</p>
              <p className="text-muted">{address.line1}</p>
              {address.line2 ? <p className="text-muted">{address.line2}</p> : null}
              <p className="text-muted">
                {[address.city, address.state, address.postalCode].filter(Boolean).join(", ")}
              </p>
              <p className="text-muted">{address.country}</p>
              {address.phone ? <p className="pt-2 text-muted">{address.phone}</p> : null}
            </address>
            {order.giftWrap || order.giftNote || order.deliveryDate ? (
              <div className="space-y-2 border-t border-line px-5 py-4 text-sm">
                {order.giftWrap ? <Badge>Gift wrapped</Badge> : null}
                {order.deliveryDate ? <p className="text-muted">Requested delivery: {fmtDate(order.deliveryDate)}</p> : null}
                {order.giftNote ? <p className="italic text-fg">“{order.giftNote}”</p> : null}
              </div>
            ) : null}
          </Section>

          <OrderWhatsAppPanel
            orderId={order.id}
            status={order.status}
            codStatus={order.codStatus}
            codConfirmBy={order.codConfirmBy}
            codConfirmedAt={order.codConfirmedAt}
            codConfirmedVia={order.codConfirmedVia}
            riskScore={order.riskScore}
            riskReasons={order.riskReasons}
            whatsappOptIn={order.whatsappOptIn}
            messages={order.whatsappMessages}
            resendable={resendableNotices(order)}
            canFulfil={can(user, "orders.fulfil")}
            canCancel={can(user, "orders.cancel")}
          />

          <Section title="Payments">
            <ul className="divide-y divide-line">
              {order.payments.map((p) => (
                <li key={p.id} className="space-y-1 px-5 py-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="uppercase tracking-[0.15em]">{p.provider}</span>
                    <Badge tone={p.status === "FAILED" || p.status === "REFUNDED" ? "ember" : p.status === "CAPTURED" ? "gold" : "muted"}>
                      {p.status.toLowerCase()}
                    </Badge>
                  </div>
                  <p className="tabular-nums">{formatMoney(p.amount)}</p>
                  {p.providerRef ? <p className="break-all font-mono text-xs text-subtle">{p.providerRef}</p> : null}
                  <p className="text-xs text-subtle">{fmtDateTime(p.createdAt)}</p>
                </li>
              ))}
              {!order.payments.length ? <li className="px-5 py-4 text-sm text-muted">No payments recorded.</li> : null}
            </ul>
            {order.tradeAccountId ? (
              <div className="space-y-3 border-t border-line px-5 py-4 text-sm">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge>Trade order</Badge>
                  <Link href={`/admin/trade/${order.tradeAccountId}`} className={linkClass}>
                    View trade account
                  </Link>
                  {order.poNumber ? <span className="text-muted">PO {order.poNumber}</span> : null}
                </p>
                {order.paidAt ? (
                  <p className="text-xs text-subtle">Invoice paid {fmtDateTime(order.paidAt)}</p>
                ) : order.status !== "CANCELLED" && order.status !== "REFUNDED" && !order.reservedUntil && can(user, "trade.manage") ? (
                  <MarkTradeInvoicePaidButton orderId={order.id} amount={formatMoney(order.total)} dueDate={order.dueDate ? fmtDateTime(order.dueDate) : null} />
                ) : order.dueDate ? (
                  <p className="text-xs text-subtle">Invoice due {fmtDateTime(order.dueDate)}</p>
                ) : null}
              </div>
            ) : null}
          </Section>

          {order.returns.length ? (
            <Section
              title={`Returns · ${order.returns.length}`}
              actions={
                <Link href={`/admin/returns?q=${encodeURIComponent(order.number)}`} className={`text-[0.625rem] uppercase tracking-[0.2em] ${linkClass}`}>
                  All
                </Link>
              }
            >
              <ul className="divide-y divide-line">
                {order.returns.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span>
                      <Link href={`/admin/returns/${r.id}`} className={linkClass}>
                        {r.number}
                      </Link>
                      <span className="ml-2 text-xs text-subtle">
                        {r.items.reduce((n, i) => n + i.quantity, 0)} pc{r.refundAmount != null ? ` · ${formatMoney(r.refundAmount)}` : ""}
                      </span>
                    </span>
                    <Badge tone={returnStatusTone(r.status)}>{RETURN_STATUS_LABEL[r.status]}</Badge>
                  </li>
                ))}
              </ul>
              {returnRefunded ? <p className="border-t border-line px-5 py-3 text-xs text-subtle">Money has been returned through a return, so full refunds are disabled here.</p> : null}
            </Section>
          ) : null}

          <Section title="Notes">
            <div className="p-5">
              <OrderNotes orderId={order.id} notes={order.notes ?? ""} />
            </div>
          </Section>
        </aside>
      </div>
    </>
  );
}
