import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getIntlLocale } from "@/i18n/server";
import { db } from "@/server/db";
import { requireUser } from "@/server/roles";
import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";
import { formatOrderCharge, orderMoney } from "@/lib/money";
import { invoiceAvailable, selfCancelMode } from "@/server/invoices";
import { OrderStatusBadge } from "@/components/account/order-status";
import { BuyAgain, CancelOrder } from "@/components/account/order-actions";
import { RequestReturn } from "@/components/account/returns";
import { ReturnCard } from "@/components/account/return-card";
import { getReturnEligibility } from "@/server/returns";
import { ShipmentTracking } from "@/components/account/shipment-tracking";

const steps = ["step_confirmed", "step_packed", "step_shipped", "step_delivered"] as const;
const stepIndex: Record<string, number> = { PENDING: 0, PAID: 0, PACKED: 1, SHIPPED: 2, DELIVERED: 3 };

export default async function OrderPage(props: PageProps<"/account/orders/[number]">) {
  const { number } = await props.params;
  const user = await requireUser(`/account/orders/${number}`);
  const order = await db.order.findFirst({
    where: { number, userId: user.id },
    include: { items: true, events: { orderBy: { createdAt: "desc" } }, payments: true },
  });
  if (!order) notFound();
  // Shown in the currency the customer was charged in (frozen at checkout), not today's display currency.
  const money = orderMoney(order);
  const addr = order.shippingAddress as { fullName: string; line1: string; line2?: string; city: string; state: string; postalCode: string; country: string; phone: string };
  const current = stepIndex[order.status] ?? -1;
  const awaiting = order.status === "PENDING" && order.reservedUntil;
  const cancelMode = selfCancelMode(order);
  const hasInvoice = invoiceAvailable(order);
  const canBuyAgain = !awaiting && order.items.some((i) => !(i.meta as { giftCard?: unknown } | null)?.giftCard);
  // Latest cancellation/refund event, to explain the outcome.
  const closing = order.status === "CANCELLED" || order.status === "REFUNDED" ? order.events.find((e) => e.status === order.status) : undefined;
  const paidOnline = order.total - order.giftCardAmount;

  const [eligibility, returns] = await Promise.all([
    order.status === "DELIVERED" ? getReturnEligibility(order.id) : null,
    db.returnRequest.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: "desc" },
      include: { items: { orderBy: { id: "asc" }, include: { orderItem: { select: { name: true, label: true } } } } },
    }),
  ]);
  const [credits, replacements] = await Promise.all([
    db.giftCard.findMany({ where: { id: { in: returns.flatMap((r) => (r.giftCardId ? [r.giftCardId] : [])) } }, select: { id: true, code: true } }),
    db.order.findMany({ where: { id: { in: returns.flatMap((r) => (r.exchangeOrderId ? [r.exchangeOrderId] : [])) } }, select: { id: true, number: true } }),
  ]);
  const [t, locale] = await Promise.all([getTranslations("orders"), getIntlLocale()]);
  const longDate = (d: Date) => d.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="space-y-14">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <Link href="/account/orders" className="link-draw eyebrow">{t("allOrders")}</Link>
          <h2 className="mt-4 font-display text-5xl">{order.number}</h2>
          <p className="mt-2 text-sm text-muted">{t("placed", { date: longDate(order.placedAt) })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          {hasInvoice && (
            <Link href={`/account/orders/${order.number}/invoice`} className="link-draw eyebrow">
              {t("taxInvoice")}
            </Link>
          )}
          {awaiting ? <span className="text-sm text-muted">{t("awaitingPayment")}</span> : <OrderStatusBadge status={order.status} />}
        </div>
      </div>

      {closing && (
        <div role="status" className="border border-ember/40 p-6">
          <p className="eyebrow mb-2 !text-ember">{order.status === "REFUNDED" ? t("cancelledRefunded") : t("cancelled")}</p>
          <p className="text-sm text-muted">
            {t("closingNote", { message: closing.message, date: longDate(closing.createdAt) })}
            {order.status === "REFUNDED" && paidOnline > 0 && ` ${t("refundOnWay", { amount: formatOrderCharge(paidOnline, order) })}`}
            {order.giftCardAmount > 0 && ` ${t("giftCardReturned", { amount: money(order.giftCardAmount) })}`}
          </p>
        </div>
      )}

      {current >= 0 && (
        <ol className="grid grid-cols-4" aria-label={t("progress")}>
          {steps.map((s, i) => (
            <li key={s} className="relative">
              <div className={cn("h-px", i <= current ? "bg-gold" : "bg-line-strong")} />
              <span className={cn("absolute -top-1 size-2 rounded-full", i <= current ? "bg-gold" : "bg-line-strong")} />
              <p className={cn("mt-4 text-[0.6875rem] uppercase tracking-[0.2em]", i <= current ? "text-fg" : "text-subtle")}>{t(s)}</p>
            </li>
          ))}
        </ol>
      )}

      {order.trackingNumber && (
        <p className="border border-line p-5 text-sm">
          {t.rich("tracking", { carrier: order.carrier ?? "", number: order.trackingNumber, gold: (c) => <span className="text-gold">{c}</span> })}
        </p>
      )}

      <ShipmentTracking orderId={order.id} />

      {cancelMode && <CancelOrder number={order.number} refund={cancelMode === "refund"} amount={formatOrderCharge(paidOnline, order)} />}

      {eligibility && !eligibility.problem && eligibility.deadline && (
        <RequestReturn
          number={order.number}
          deadline={longDate(eligibility.deadline)}
          feePercent={eligibility.settings.restockingFeePercent}
          lines={eligibility.lines.map((l) => ({ orderItemId: l.orderItemId, name: l.name, label: l.label, returnable: l.returnable, returned: l.returned, blocked: l.blocked }))}
        />
      )}
      {eligibility?.problem && returns.length === 0 && <p className="text-xs text-subtle">{eligibility.problem}</p>}

      {returns.length > 0 && (
        <section className="space-y-6" aria-labelledby="returns-heading">
          <p id="returns-heading" className="eyebrow">
            {t("returns")}
          </p>
          {returns.map((r) => (
            <ReturnCard
              key={r.id}
              orderNumber={order.number}
              r={{
                ...r,
                giftCardCode: credits.find((c) => c.id === r.giftCardId)?.code ?? null,
                exchangeOrderNumber: replacements.find((o) => o.id === r.exchangeOrderId)?.number ?? null,
              }}
            />
          ))}
          {eligibility?.problem && <p className="text-xs text-subtle">{eligibility.problem}</p>}
        </section>
      )}

      <div className="grid gap-12 md:grid-cols-[1fr_18rem]">
        <div>
          <ul className="divide-y divide-line border-y border-line">
            {order.items.map((i) => (
              <li key={i.id} className="flex justify-between gap-4 py-5">
                <div>
                  <p className="font-display text-xl">{i.name}</p>
                  <p className="text-xs text-muted">
                    {i.label} × {i.quantity}
                    {(i.meta as { giftCard?: { recipientName: string; recipientEmail: string } } | null)?.giftCard &&
                      ` · ${t("emailedTo", { name: (i.meta as { giftCard: { recipientName: string; recipientEmail: string } }).giftCard.recipientName })}`}
                  </p>
                </div>
                {money(i.unitPrice * i.quantity)}
              </li>
            ))}
          </ul>
          <dl className="mt-6 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted">{t("subtotal")}</dt><dd>{money(order.subtotal)}</dd></div>
            {order.discount > 0 && <div className="flex justify-between text-gold"><dt>{order.couponCode ? t("discountCode", { code: order.couponCode }) : t("discount")}</dt><dd>−{money(order.discount)}</dd></div>}
            {order.pointsRedeemed > 0 && <div className="flex justify-between text-gold"><dt>{brand.loyalty.name}</dt><dd>−{money(order.pointsRedeemed * brand.loyalty.pointValue)}</dd></div>}
            <div className="flex justify-between"><dt className="text-muted">{t("shippingWrapping")}</dt><dd>{order.shipping ? money(order.shipping) : t("complimentary")}</dd></div>
            <div className="flex justify-between border-t border-line pt-3"><dt className="eyebrow !text-muted">{t("total")}</dt><dd className="font-display text-2xl">{order.giftCardAmount ? money(order.total) : formatOrderCharge(order.total, order)}</dd></div>
            {order.giftCardAmount > 0 && <div className="flex justify-between text-gold"><dt>{t("paidByGiftCard")}</dt><dd>−{money(order.giftCardAmount)}</dd></div>}
            <p className="text-xs text-subtle">
              {t.rich("includesTax", { price: () => <>{money(order.tax)}</> })} ·{" "}
              {!order.payments.length && order.total === 0
                ? t("exchangeNoCharge")
                : t("paidBy", { method: order.payments[0]?.provider === "COD" ? t("cashOnDelivery") : (order.payments[0]?.provider.toLowerCase() ?? "") })}
            </p>
          </dl>
        </div>
        <aside className="space-y-8 text-sm">
          <div>
            <p className="eyebrow mb-3">{t("deliveringTo")}</p>
            <p className="leading-relaxed text-muted">
              {addr.fullName}<br />{addr.line1}{addr.line2 && <>, {addr.line2}</>}<br />{addr.city}, {addr.state} {addr.postalCode}<br />{addr.country} · {addr.phone}
            </p>
          </div>
          {order.giftWrap && (
            <div>
              <p className="eyebrow mb-3">{t("giftNote")}</p>
              <p className="font-display text-lg italic text-muted">“{order.giftNote || "—"}”</p>
            </div>
          )}
          <div>
            <p className="eyebrow mb-3">{t("history")}</p>
            <ul className="space-y-3">
              {order.events.map((e) => (
                <li key={e.id}>
                  <p>{e.message}</p>
                  <p className="text-xs text-subtle">{e.createdAt.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}</p>
                </li>
              ))}
            </ul>
          </div>
          {canBuyAgain && <BuyAgain number={order.number} />}
          <p className="text-xs text-subtle">
            {t.rich("needHelp", {
              email: brand.email,
              link: (c) => (
                <a href={`mailto:${brand.email}?subject=${order.number}`} className="link-draw text-fg">
                  {c}
                </a>
              ),
            })}
          </p>
        </aside>
      </div>
    </div>
  );
}
