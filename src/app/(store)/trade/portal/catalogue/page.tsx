import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { approvedBuyer } from "@/server/trade-portal";
import { tradeCatalogue, type CatalogueRow } from "@/server/trade";
import { getSettings } from "@/server/settings";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { TradeThumb } from "@/components/trade/trade-thumb";

export const metadata: Metadata = { title: "Wholesale catalogue" };

export default async function TradeCataloguePage() {
  const account = await approvedBuyer("/trade/portal/catalogue");
  if (!account) return null;
  const [rows, settings] = await Promise.all([tradeCatalogue(account.tier), getSettings()]);

  // Group variants under their product, keeping catalogue order.
  const products = new Map<string, CatalogueRow[]>();
  for (const r of rows) products.set(r.productId, [...(products.get(r.productId) ?? []), r]);

  return (
    <div className="space-y-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h2 className="font-display text-4xl">Wholesale catalogue</h2>
          <p className="mt-2 max-w-xl text-sm text-muted">
            {account.tier ? `${account.tier.name} pricing — ${account.tier.discountPercent}% off retail, with sharper prices where marked.` : "Your trade prices."} Availability is live.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <a href="/api/trade/price-list" className="link-draw eyebrow inline-flex items-center gap-2" download>
            <Download className="size-3" aria-hidden /> Price list (CSV)
          </a>
          <Link href="/trade/portal/order" className="link-draw eyebrow">
            Quick order
          </Link>
        </div>
      </div>

      {products.size === 0 ? <p className="text-muted">No products are available to trade right now.</p> : null}

      <ul className="grid gap-px border border-line bg-line md:grid-cols-2">
        {[...products.values()].map((variants) => {
          const p = variants[0];
          return (
            <li key={p.productId} className="grid grid-cols-[7rem_1fr] gap-6 bg-bg p-6 sm:grid-cols-[10rem_1fr] md:p-8">
              <TradeThumb media={p.media} model={p.model} palette={p.palette} size="full" sizes="160px" className="aspect-[4/5]" />
              <div className="min-w-0">
                <p className="text-[0.625rem] uppercase tracking-[0.2em] text-subtle">{p.category}</p>
                <h3 className="mt-1 font-display text-2xl">{p.productName}</h3>
                <p className="text-xs text-muted">{p.subtitle}</p>
                <table className="mt-5 w-full text-left text-xs">
                  <caption className="sr-only">Trade prices for {p.productName}</caption>
                  <thead>
                    <tr className="text-[0.5625rem] uppercase tracking-[0.18em] text-subtle">
                      <th scope="col" className="pb-2 font-normal">Size</th>
                      <th scope="col" className="pb-2 text-right font-normal">Retail</th>
                      <th scope="col" className="pb-2 text-right font-normal">Trade</th>
                      <th scope="col" className="hidden pb-2 text-right font-normal sm:table-cell">Case · min</th>
                      <th scope="col" className="pb-2 text-right font-normal">Avail.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line border-t border-line">
                    {variants.map((v) => (
                      <tr key={v.variantId}>
                        <td className="py-2 pr-2">
                          <Link href={`/trade/portal/order#v-${v.variantId}`} className="hover:text-gold">
                            {v.label}
                          </Link>
                          <span className="block text-[0.625rem] text-subtle sm:hidden">
                            case {v.caseSize} · min {v.minQty}
                          </span>
                        </td>
                        <td className="py-2 text-right tabular-nums text-subtle line-through decoration-line-strong">{formatMoney(v.retail)}</td>
                        <td className="py-2 text-right tabular-nums text-gold">
                          {formatMoney(v.trade)}
                          {v.override ? <span className="sr-only"> (special price)</span> : null}
                          {v.override ? <span aria-hidden className="ml-1 text-[0.5625rem]">★</span> : null}
                        </td>
                        <td className="hidden py-2 text-right tabular-nums text-muted sm:table-cell">
                          {v.caseSize} · {v.minQty}
                        </td>
                        <td className={cn("py-2 text-right tabular-nums", v.available ? "text-muted" : "text-ember")}>{v.available || "Out"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-subtle">★ Special price for your tier. Prices are per unit and exclude shipping. {settings.taxInclusive ? `They include GST at ${settings.taxRatePercent}%.` : `GST at ${settings.taxRatePercent}% is added at checkout.`}</p>
    </div>
  );
}
