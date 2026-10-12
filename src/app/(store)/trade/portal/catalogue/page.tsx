import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { approvedBuyer } from "@/server/trade-portal";
import { tradeCatalogue, type CatalogueRow } from "@/server/trade";
import { getSettings } from "@/server/settings";
import { formatMoney } from "@/lib/money";
import { getRegion } from "@/server/region";
import { cn } from "@/lib/utils";
import { TradeThumb } from "@/components/trade/trade-thumb";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tradePortal.catalogue");
  return { title: t("title") };
}

export default async function TradeCataloguePage() {
  const account = await approvedBuyer("/trade/portal/catalogue");
  if (!account) return null;
  const [rows, settings] = await Promise.all([tradeCatalogue(account.tier), getSettings()]);
  const t = await getTranslations("tradePortal.catalogue");
  const { taxLabel } = await getRegion();
  const tq = await getTranslations("tradePortal.quickOrder");

  // Group variants under their product, keeping catalogue order.
  const products = new Map<string, CatalogueRow[]>();
  for (const r of rows) products.set(r.productId, [...(products.get(r.productId) ?? []), r]);

  return (
    <div className="space-y-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h2 className="font-display text-4xl">{t("title")}</h2>
          <p className="mt-2 max-w-xl text-sm text-muted">
            {account.tier ? t("tierIntro", { tier: account.tier.name, percent: account.tier.discountPercent }) : t("defaultIntro")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <a href="/api/trade/price-list" className="link-draw eyebrow inline-flex items-center gap-2" download>
            <Download className="size-3" aria-hidden /> {t("priceListCsv")}
          </a>
          <Link href="/trade/portal/order" className="link-draw eyebrow">
            {t("quickOrder")}
          </Link>
        </div>
      </div>

      {products.size === 0 ? <p className="text-muted">{t("empty")}</p> : null}

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
                <table className="mt-5 w-full text-start text-xs">
                  <caption className="sr-only">{t("caption", { product: p.productName })}</caption>
                  <thead>
                    <tr className="text-[0.5625rem] uppercase tracking-[0.18em] text-subtle">
                      <th scope="col" className="pb-2 text-start font-normal">{t("colSize")}</th>
                      <th scope="col" className="pb-2 text-end font-normal">{tq("colRetail")}</th>
                      <th scope="col" className="pb-2 text-end font-normal">{tq("colTrade")}</th>
                      <th scope="col" className="hidden pb-2 text-end font-normal sm:table-cell">{tq("colCaseMin")}</th>
                      <th scope="col" className="pb-2 text-end font-normal">{tq("colAvail")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line border-t border-line">
                    {variants.map((v) => (
                      <tr key={v.variantId}>
                        <td className="py-2 pe-2">
                          <Link href={`/trade/portal/order#v-${v.variantId}`} className="hover:text-gold">
                            {v.label}
                          </Link>
                          <span className="block text-[0.625rem] text-subtle sm:hidden">
                            {tq("mobileMeta", { caseSize: v.caseSize, min: v.minQty })}
                          </span>
                        </td>
                        <td className="py-2 text-end tabular-nums text-subtle line-through decoration-line-strong">{formatMoney(v.retail)}</td>
                        <td className="py-2 text-end tabular-nums text-gold">
                          {formatMoney(v.trade)}
                          {v.override ? <span className="sr-only"> ({tq("specialPrice")})</span> : null}
                          {v.override ? <span aria-hidden className="ms-1 text-[0.5625rem]">★</span> : null}
                        </td>
                        <td className="hidden py-2 text-end tabular-nums text-muted sm:table-cell">
                          {v.caseSize} · {v.minQty}
                        </td>
                        <td className={cn("py-2 text-end tabular-nums", v.available ? "text-muted" : "text-ember")}>{v.available || tq("out")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-subtle">{settings.taxInclusive ? t("footnoteInclusiveTax", { label: taxLabel, rate: settings.taxRatePercent }) : t("footnoteExclusiveTax", { label: taxLabel, rate: settings.taxRatePercent })}</p>
    </div>
  );
}
