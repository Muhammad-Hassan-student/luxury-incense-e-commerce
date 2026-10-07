import Link from "next/link";
import { ArrowRight, Download } from "lucide-react";
import { db } from "@/server/db";
import { approvedBuyer } from "@/server/trade-portal";
import { tradeStatement } from "@/server/trade";
import { expireQuotes } from "@/server/trade-quotes";
import { formatMoney } from "@/lib/money";
import { brand } from "@/config/brand";
import { Badge } from "@/components/ui/field";
import { OrderStatusBadge } from "@/components/account/order-status";
import { InvoiceStateBadge, TradeStatementCard } from "@/components/trade/statement";
import { QUOTE_STATUS_LABEL, invoiceState, minimumOrderFor, quoteStatusTone } from "@/components/trade/trade-rules";

export default async function TradePortalPage() {
  const account = await approvedBuyer("/trade/portal");
  if (!account) return null;
  await expireQuotes({ tradeAccountId: account.id });
  const [statement, orders, quotes] = await Promise.all([
    tradeStatement(account),
    db.order.findMany({ where: { tradeAccountId: account.id, reservedUntil: null }, orderBy: { placedAt: "desc" }, take: 5 }),
    db.quote.findMany({ where: { tradeAccountId: account.id, status: { in: ["REQUESTED", "QUOTED"] } }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  const minimum = minimumOrderFor(account, account.tier);
  const now = new Date();

  return (
    <div className="space-y-16">
      <TradeStatementCard statement={statement} terms={account.terms} />

      <section className="grid gap-px border border-line bg-line md:grid-cols-3" aria-label="Shortcuts">
        <Shortcut href="/trade/portal/order" title="Quick order" body={`Restock by SKU in cases.${minimum ? ` Minimum order ${formatMoney(minimum)}.` : ""}`} />
        <Shortcut href="/trade/portal/quotes/new" title="Request a quote" body="Large volumes, private label or a custom blend." />
        <a href="/api/trade/price-list" className="group flex flex-col justify-between gap-6 bg-bg p-8 transition-colors hover:bg-bg-elev" download>
          <div>
            <h2 className="font-display text-2xl group-hover:text-gold">Price list</h2>
            <p className="mt-2 text-sm text-muted">Your trade prices as a spreadsheet (CSV).</p>
          </div>
          <Download className="size-4 text-gold" aria-hidden />
        </a>
      </section>

      <div className="grid gap-16 lg:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="recent-orders">
          <div className="mb-6 flex items-baseline justify-between">
            <h2 id="recent-orders" className="font-display text-3xl">
              Recent orders
            </h2>
            <Link href="/trade/portal/orders" className="link-draw eyebrow">
              All orders
            </Link>
          </div>
          {orders.length ? (
            <ul className="divide-y divide-line border-y border-line">
              {orders.map((o) => (
                <li key={o.id}>
                  <Link href={`/trade/portal/orders/${o.number}`} className="flex flex-wrap items-center justify-between gap-4 py-5 transition-colors hover:text-gold">
                    <span className="font-display text-xl">{o.number}</span>
                    <span className="text-xs text-muted">{o.poNumber ? `PO ${o.poNumber}` : o.placedAt.toLocaleDateString("en-GB")}</span>
                    <span className="flex gap-2">
                      <OrderStatusBadge status={o.status} />
                      <InvoiceStateBadge state={invoiceState(o, now)} />
                    </span>
                    <span className="tabular-nums">{formatMoney(o.total)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-y border-line py-8 text-sm text-muted">
              No trade orders yet.{" "}
              <Link href="/trade/portal/order" className="link-draw text-gold">
                Place your first
              </Link>
            </p>
          )}
        </section>

        <section aria-labelledby="open-quotes">
          <div className="mb-6 flex items-baseline justify-between">
            <h2 id="open-quotes" className="font-display text-3xl">
              Open quotes
            </h2>
            <Link href="/trade/portal/quotes" className="link-draw eyebrow">
              All quotes
            </Link>
          </div>
          {quotes.length ? (
            <ul className="divide-y divide-line border-y border-line">
              {quotes.map((q) => (
                <li key={q.id}>
                  <Link href={`/trade/portal/quotes/${q.number}`} className="flex items-center justify-between gap-4 py-5 transition-colors hover:text-gold">
                    <span className="font-display text-xl">{q.number}</span>
                    <Badge tone={quoteStatusTone(q.status)}>{q.status === "QUOTED" ? "Ready to review" : QUOTE_STATUS_LABEL[q.status]}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-y border-line py-8 text-sm text-muted">No open quotes.</p>
          )}
          <p className="mt-8 text-xs leading-relaxed text-subtle">
            Your trade desk:{" "}
            <a href={`mailto:${brand.email}?subject=${encodeURIComponent(account.businessName)}`} className="link-draw text-fg">
              {brand.email}
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}

function Shortcut({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link href={href} className="group flex flex-col justify-between gap-6 bg-bg p-8 transition-colors hover:bg-bg-elev">
      <div>
        <h2 className="font-display text-2xl group-hover:text-gold">{title}</h2>
        <p className="mt-2 text-sm text-muted">{body}</p>
      </div>
      <ArrowRight className="size-4 text-gold transition-transform duration-500 group-hover:translate-x-1" aria-hidden />
    </Link>
  );
}
