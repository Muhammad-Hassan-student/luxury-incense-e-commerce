import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getIntlLocale } from "@/i18n/server";
import { db } from "@/server/db";
import { approvedBuyer } from "@/server/trade-portal";
import { tradeStatement } from "@/server/trade";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { OrderStatusBadge } from "@/components/account/order-status";
import { InvoiceStateBadge, TradeStatementCard } from "@/components/trade/statement";
import { invoiceState } from "@/components/trade/trade-rules";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tradePortal.orders");
  return { title: t("title") };
}

export default async function TradeOrdersPage() {
  const account = await approvedBuyer("/trade/portal/orders");
  if (!account) return null;
  const [statement, orders] = await Promise.all([
    tradeStatement(account),
    db.order.findMany({
      where: { tradeAccountId: account.id, reservedUntil: null },
      orderBy: { placedAt: "desc" },
      take: 200,
      include: { items: { select: { quantity: true } }, quote: { select: { number: true } } },
    }),
  ]);
  const now = new Date();
  const t = await getTranslations("tradePortal.orders");
  const intl = await getIntlLocale();
  const day = (d: Date) => d.toLocaleDateString(intl, { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="space-y-14">
      <section aria-labelledby="statement">
        <h2 id="statement" className="mb-6 font-display text-3xl">
          {t("statement")}
        </h2>
        <TradeStatementCard statement={statement} terms={account.terms} />
      </section>

      <section aria-labelledby="orders">
        <h2 id="orders" className="mb-6 font-display text-3xl">
          {t("title")}
        </h2>
        {orders.length ? (
          <ul className="divide-y divide-line border-y border-line">
            {orders.map((o) => {
              const state = invoiceState(o, now);
              const units = o.items.reduce((s, i) => s + i.quantity, 0);
              return (
                <li key={o.id} className="grid gap-4 py-6 md:grid-cols-[11rem_1fr_auto_8rem_auto] md:items-center md:gap-8">
                  <div>
                    <Link href={`/trade/portal/orders/${o.number}`} className="font-display text-2xl transition-colors hover:text-gold">
                      {o.number}
                    </Link>
                    <p className="text-xs text-subtle">{day(o.placedAt)}</p>
                  </div>
                  <div className="text-sm text-muted">
                    <p>
                      {[t("units", { count: units }), o.poNumber ? t("po", { po: o.poNumber }) : null, o.quote ? t("fromQuote", { number: o.quote.number }) : null].filter(Boolean).join(" · ")}
                    </p>
                    <p className={cn("text-xs", state === "overdue" ? "text-ember" : "text-subtle")}>
                      {state === "paid" && o.paidAt ? t("paidOn", { date: day(o.paidAt) }) : state === "void" ? t("cancelled") : o.dueDate ? t("dueOn", { date: day(o.dueDate) }) : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <OrderStatusBadge status={o.status} />
                    <InvoiceStateBadge state={state} />
                  </div>
                  <p className="tabular-nums md:text-end">{formatMoney(o.total)}</p>
                  <div className="flex gap-6">
                    <Link href={`/trade/portal/orders/${o.number}`} className="link-draw eyebrow">
                      {t("invoice")}
                    </Link>
                    <Link href={`/trade/portal/order?reorder=${encodeURIComponent(o.number)}`} className="link-draw eyebrow !text-muted">
                      {t("reorder")}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="border-y border-line py-8 text-sm text-muted">
            {t.rich("empty", { link: (c) => <Link href="/trade/portal/order" className="link-draw text-gold">{c}</Link> })}
          </p>
        )}
      </section>
    </div>
  );
}
