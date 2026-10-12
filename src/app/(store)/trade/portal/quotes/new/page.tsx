import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { approvedBuyer } from "@/server/trade-portal";
import { tradeCatalogue } from "@/server/trade";
import { QuoteRequestForm } from "@/components/trade/quote-request-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tradeQuote.list");
  return { title: t("request") };
}

export default async function NewQuotePage() {
  const account = await approvedBuyer("/trade/portal/quotes/new");
  if (!account) return null;
  const rows = await tradeCatalogue(account.tier);
  const t = await getTranslations("tradeQuote.list");
  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_2fr]">
      <header>
        <Link href="/trade/portal/quotes" className="link-draw eyebrow">
          {t("all")}
        </Link>
        <h2 className="mt-6 font-display text-4xl">{t("request")}</h2>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          {t("newIntro")}
        </p>
      </header>
      <QuoteRequestForm options={rows.map((r) => ({ variantId: r.variantId, product: r.productName, label: r.label, sku: r.sku, trade: r.trade, caseSize: r.caseSize }))} />
    </div>
  );
}
