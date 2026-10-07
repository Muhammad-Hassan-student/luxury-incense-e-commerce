import type { Metadata } from "next";
import { db } from "@/server/db";
import { approvedBuyer } from "@/server/trade-portal";
import { asTradeAddress, reorderQuantities, tradeCatalogue, tradeStatement } from "@/server/trade";
import { getSettings } from "@/server/settings";
import { brand } from "@/config/brand";
import { QuickOrder } from "@/components/trade/quick-order";
import { minimumOrderFor, roundUpQty } from "@/components/trade/trade-rules";

export const metadata: Metadata = { title: "Quick order" };

export default async function TradeQuickOrderPage(props: PageProps<"/trade/portal/order">) {
  const account = await approvedBuyer("/trade/portal/order");
  if (!account) return null;
  const sp = await props.searchParams;
  const reorder = typeof sp.reorder === "string" && /^[A-Z0-9-]{3,40}$/.test(sp.reorder) ? sp.reorder : null;

  const [rows, statement, rates, settings, previous] = await Promise.all([
    tradeCatalogue(account.tier),
    tradeStatement(account),
    db.shippingRate.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true, countries: true, price: true, freeOver: true, etaDays: true } }),
    getSettings(),
    reorder ? reorderQuantities(account.id, reorder) : Promise.resolve(null),
  ]);

  // Re-order: previous quantities, rounded up to today's case packs/minimums and capped by stock.
  const initialQty: Record<string, number> = {};
  if (previous) {
    for (const r of rows) {
      const want = previous.quantities[r.variantId];
      if (!want || !r.available) continue;
      const q = roundUpQty(want, r.caseSize, r.minQty);
      if (q <= r.available) initialQty[r.variantId] = q;
    }
  }

  const addr = asTradeAddress(account.address);
  return (
    <QuickOrder
      rows={rows}
      minimum={minimumOrderFor(account, account.tier)}
      terms={account.terms}
      creditAvailable={statement.creditAvailable}
      rates={rates}
      tax={{ ratePercent: settings.taxRatePercent, inclusive: settings.taxInclusive }}
      pointValue={brand.loyalty.pointValue}
      defaultAddress={
        addr
          ? { ...addr, line2: addr.line2 ?? "", fullName: addr.fullName || account.contactName, phone: addr.phone || account.phone }
          : { fullName: account.contactName, phone: account.phone, line1: "", line2: "", city: "", state: "", postalCode: "", country: "IN" }
      }
      initialQty={initialQty}
      reorderFrom={previous ? previous.number : null}
    />
  );
}
