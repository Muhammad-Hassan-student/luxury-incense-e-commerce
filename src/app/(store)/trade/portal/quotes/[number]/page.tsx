import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { approvedBuyer } from "@/server/trade-portal";
import { asTradeAddress, tradeStatement } from "@/server/trade";
import { acceptProblem, getBuyerQuote } from "@/server/trade-quotes";
import { getSettings } from "@/server/settings";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/field";
import { QuoteDecision } from "@/components/trade/quote-decision";
import { QUOTE_STATUS_LABEL, quoteStatusTone } from "@/components/trade/trade-rules";

export async function generateMetadata(props: PageProps<"/trade/portal/quotes/[number]">): Promise<Metadata> {
  const { number } = await props.params;
  return { title: `Quote ${number}` };
}

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export default async function TradeQuotePage(props: PageProps<"/trade/portal/quotes/[number]">) {
  const { number } = await props.params;
  const account = await approvedBuyer(`/trade/portal/quotes/${number}`);
  if (!account) return null;
  const q = await getBuyerQuote(account.id, number);
  if (!q) notFound();

  const priced = q.status !== "REQUESTED";
  const total = q.items.reduce((s, i) => s + (i.quotedPrice ?? 0) * i.quantity, 0);
  const open = q.status === "QUOTED" || q.status === "REQUESTED";
  const [rates, settings, statement] = open
    ? await Promise.all([
        db.shippingRate.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true, countries: true, price: true, freeOver: true, etaDays: true } }),
        getSettings(),
        tradeStatement(account),
      ])
    : [[], null, null];
  const addr = asTradeAddress(account.address);

  return (
    <div className="space-y-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <Link href="/trade/portal/quotes" className="link-draw eyebrow">
            All quotes
          </Link>
          <h2 className="mt-6 font-display text-5xl">{q.number}</h2>
          <p className="mt-2 text-sm text-muted">
            Requested {day(q.createdAt)}
            {q.validUntil && priced ? ` · valid until ${day(q.validUntil)}` : ""}
          </p>
        </div>
        <Badge tone={quoteStatusTone(q.status)}>{QUOTE_STATUS_LABEL[q.status]}</Badge>
      </div>

      {q.status === "EXPIRED" ? (
        <p role="status" className="border border-ember/40 p-4 text-sm text-muted">
          This quote lapsed on {q.validUntil ? day(q.validUntil) : "its expiry date"}. Request a fresh one and we’ll re-price it.
        </p>
      ) : null}
      {q.order ? (
        <p role="status" className="border border-gold/40 p-4 text-sm text-muted">
          Accepted — order{" "}
          <Link href={`/trade/portal/orders/${q.order.number}`} className="link-draw text-gold">
            {q.order.number}
          </Link>{" "}
          ({formatMoney(q.order.total)}).
        </p>
      ) : null}

      {q.replyMessage ? <blockquote className="border-l border-gold/60 pl-6 font-display text-2xl italic">{q.replyMessage}</blockquote> : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <caption className="sr-only">Quote lines</caption>
          <thead>
            <tr className="border-b border-line text-[0.5625rem] uppercase tracking-[0.2em] text-subtle">
              <th scope="col" className="py-3 font-normal">Item</th>
              <th scope="col" className="py-3 text-right font-normal">Qty</th>
              <th scope="col" className="py-3 text-right font-normal">Your target</th>
              <th scope="col" className="py-3 text-right font-normal">Quoted</th>
              <th scope="col" className="py-3 text-right font-normal">Line</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {q.items.map((i) => (
              <tr key={i.id}>
                <td className="py-4 pr-4">
                  <p>{i.variant ? `${i.variant.product.name} — ${i.variant.label}` : i.description}</p>
                  {i.variant && i.description && !i.description.startsWith(`${i.variant.product.name} — ${i.variant.label}`) ? <p className="text-xs text-subtle">Requested as: {i.description}</p> : null}
                  {i.variant && i.description.startsWith(`${i.variant.product.name} — ${i.variant.label} · `) ?<p className="text-xs text-subtle">{i.description.split(" · ").slice(1).join(" · ")}</p> : null}
                  {!i.variant ? <p className="text-xs text-ember">Custom line — not yet linked to a catalogue item</p> : <p className="font-mono text-[0.625rem] text-subtle">{i.variant.sku}</p>}
                </td>
                <td className="py-4 text-right tabular-nums">{i.quantity}</td>
                <td className="py-4 text-right tabular-nums text-muted">{i.targetPrice != null ? formatMoney(i.targetPrice) : "—"}</td>
                <td className="py-4 text-right tabular-nums text-gold">{i.quotedPrice != null ? formatMoney(i.quotedPrice) : priced ? "—" : "Pricing…"}</td>
                <td className="py-4 text-right tabular-nums">{i.quotedPrice != null ? formatMoney(i.quotedPrice * i.quantity) : "—"}</td>
              </tr>
            ))}
          </tbody>
          {priced ? (
            <tfoot>
              <tr className="border-t border-line-strong">
                <td colSpan={4} className="py-4 text-right text-xs uppercase tracking-[0.2em] text-muted">
                  Goods total (shipping and tax added at acceptance)
                </td>
                <td className="py-4 text-right font-display text-2xl tabular-nums">{formatMoney(total)}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {q.message ? (
        <div>
          <p className="eyebrow mb-2">Your message</p>
          <p className="text-sm text-muted">{q.message}</p>
        </div>
      ) : null}

      {open && settings && statement ? (
        <QuoteDecision
          number={q.number}
          status={q.status as "REQUESTED" | "QUOTED"}
          lines={q.items.map((i) => ({ unitPrice: i.quotedPrice ?? 0, quantity: i.quantity }))}
          problem={q.status === "QUOTED" ? acceptProblem(q) : null}
          rates={rates}
          tax={{ ratePercent: settings.taxRatePercent, inclusive: settings.taxInclusive }}
          creditAvailable={statement.creditAvailable}
          defaultAddress={
            addr
              ? { ...addr, line2: addr.line2 ?? "", fullName: addr.fullName || account.contactName, phone: addr.phone || account.phone }
              : { fullName: account.contactName, phone: account.phone, line1: "", line2: "", city: "", state: "", postalCode: "", country: "IN" }
          }
        />
      ) : null}
    </div>
  );
}
