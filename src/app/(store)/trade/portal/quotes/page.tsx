import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getIntlLocale } from "@/i18n/server";
import { db } from "@/server/db";
import { approvedBuyer } from "@/server/trade-portal";
import { expireQuotes } from "@/server/trade-quotes";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/field";
import { quoteStatusTone } from "@/components/trade/trade-rules";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tradeQuote.list");
  return { title: t("title") };
}

export default async function TradeQuotesPage() {
  const account = await approvedBuyer("/trade/portal/quotes");
  if (!account) return null;
  await expireQuotes({ tradeAccountId: account.id });
  const t = await getTranslations("tradeQuote.list");
  const tq = await getTranslations("tradeQuote");
  const intl = await getIntlLocale();
  const day = (d: Date) => d.toLocaleDateString(intl, { day: "numeric", month: "short", year: "numeric" });
  const quotes = await db.quote.findMany({
    where: { tradeAccountId: account.id },
    orderBy: { createdAt: "desc" },
    include: { items: { select: { quantity: true, quotedPrice: true } }, order: { select: { number: true } } },
  });

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h2 className="font-display text-4xl">{t("title")}</h2>
          <p className="mt-2 text-sm text-muted">{t("intro")}</p>
        </div>
        <Link href="/trade/portal/quotes/new" className="link-draw eyebrow">
          {t("request")}
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
                    {[
                      t("requestedOn", { date: day(q.createdAt) }),
                      t("lines", { count: q.items.length }),
                      q.status === "QUOTED" && q.validUntil ? t("validUntil", { date: day(q.validUntil) }) : null,
                      q.order ? t("order", { number: q.order.number }) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <Badge tone={quoteStatusTone(q.status)}>{q.status === "QUOTED" ? t("readyToReview") : tq(`status_${q.status}`)}</Badge>
                  <span className="tabular-nums md:text-end">{total != null && q.status !== "REQUESTED" ? formatMoney(total) : "—"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="border-y border-line py-8 text-sm text-muted">{t("empty")}</p>
      )}
    </div>
  );
}
