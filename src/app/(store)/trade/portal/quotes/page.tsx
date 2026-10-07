import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/server/db";
import { approvedBuyer } from "@/server/trade-portal";
import { expireQuotes } from "@/server/trade-quotes";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/field";
import { QUOTE_STATUS_LABEL, quoteStatusTone } from "@/components/trade/trade-rules";

export const metadata: Metadata = { title: "Quotes" };

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function TradeQuotesPage() {
  const account = await approvedBuyer("/trade/portal/quotes");
  if (!account) return null;
  await expireQuotes({ tradeAccountId: account.id });
  const quotes = await db.quote.findMany({
    where: { tradeAccountId: account.id },
    orderBy: { createdAt: "desc" },
    include: { items: { select: { quantity: true, quotedPrice: true } }, order: { select: { number: true } } },
  });

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h2 className="font-display text-4xl">Quotes</h2>
          <p className="mt-2 text-sm text-muted">Large volumes, private label and custom blends, priced by our trade desk.</p>
        </div>
        <Link href="/trade/portal/quotes/new" className="link-draw eyebrow">
          Request a quote
        </Link>
      </div>
      {quotes.length ? (
        <ul className="divide-y divide-line border-y border-line">
          {quotes.map((q) => {
            const priced = q.items.every((i) => i.quotedPrice != null);
            const total = priced ? q.items.reduce((s, i) => s + (i.quotedPrice ?? 0) * i.quantity, 0) : null;
            return (
              <li key={q.id}>
                <Link href={`/trade/portal/quotes/${q.number}`} className="grid gap-3 py-6 transition-colors hover:text-gold md:grid-cols-[10rem_1fr_auto_8rem] md:items-center md:gap-8">
                  <span className="font-display text-2xl">{q.number}</span>
                  <span className="text-sm text-muted">
                    Requested {day(q.createdAt)} · {q.items.length} line{q.items.length === 1 ? "" : "s"}
                    {q.status === "QUOTED" && q.validUntil ? ` · valid until ${day(q.validUntil)}` : ""}
                    {q.order ? ` · order ${q.order.number}` : ""}
                  </span>
                  <Badge tone={quoteStatusTone(q.status)}>{q.status === "QUOTED" ? "Ready to review" : QUOTE_STATUS_LABEL[q.status]}</Badge>
                  <span className="tabular-nums md:text-right">{total != null && q.status !== "REQUESTED" ? formatMoney(total) : "—"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="border-y border-line py-8 text-sm text-muted">No quotes yet.</p>
      )}
    </div>
  );
}
