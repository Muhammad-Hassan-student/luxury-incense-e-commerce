import type { Metadata } from "next";
import Link from "next/link";
import { approvedBuyer } from "@/server/trade-portal";
import { tradeCatalogue } from "@/server/trade";
import { QuoteRequestForm } from "@/components/trade/quote-request-form";

export const metadata: Metadata = { title: "Request a quote" };

export default async function NewQuotePage() {
  const account = await approvedBuyer("/trade/portal/quotes/new");
  if (!account) return null;
  const rows = await tradeCatalogue(account.tier);
  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_2fr]">
      <header>
        <Link href="/trade/portal/quotes" className="link-draw eyebrow">
          All quotes
        </Link>
        <h2 className="mt-6 font-display text-4xl">Request a quote</h2>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          For volumes beyond your usual restock, private label, or a blend composed for your space. Tell us what you need — and your target price if you have one — and our trade desk will reply with a quote you can accept in one click.
        </p>
      </header>
      <QuoteRequestForm options={rows.map((r) => ({ variantId: r.variantId, product: r.productName, label: r.label, sku: r.sku, trade: r.trade, caseSize: r.caseSize }))} />
    </div>
  );
}
