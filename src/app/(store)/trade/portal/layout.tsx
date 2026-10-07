import type { Metadata } from "next";
import Link from "next/link";
import { portalAccount } from "@/server/trade-portal";
import { Badge } from "@/components/ui/field";
import { PortalNav } from "@/components/trade/portal-nav";
import { TradeStatusPanel } from "@/components/trade/status-panel";
import { TERMS_LABEL } from "@/components/trade/trade-rules";

export const metadata: Metadata = { title: { default: "Trade portal", template: "%s · Trade portal" }, robots: { index: false } };

/**
 * Gate for the whole portal: signed out → sign in; no application → apply; not approved → status page.
 * Pages also re-check (approvedBuyer) and render nothing unless approved, so no data is fetched for others.
 */
export default async function TradePortalLayout({ children }: LayoutProps<"/trade/portal">) {
  const { account } = await portalAccount("/trade/portal");

  if (!account) {
    return (
      <div className="container-luxe py-24 md:py-32">
        <section className="mx-auto max-w-2xl border border-line bg-bg-elev p-8 text-center md:p-14">
          <p className="eyebrow mb-6">Trade portal</p>
          <h1 className="display text-4xl md:text-5xl">This is where trade partners order</h1>
          <p className="mx-auto mt-6 max-w-md leading-relaxed text-muted">You don’t have a trade account yet. Apply in a few minutes and our trade desk will review it by hand.</p>
          <div className="mt-10 flex flex-wrap justify-center gap-6">
            <Link href="/trade/apply" className="link-draw eyebrow">
              Apply for a trade account
            </Link>
            <Link href="/trade" className="link-draw eyebrow !text-muted">
              About trade
            </Link>
          </div>
        </section>
      </div>
    );
  }

  if (account.status !== "APPROVED") {
    return (
      <div className="container-luxe py-24 md:py-32">
        <TradeStatusPanel account={account} />
      </div>
    );
  }

  return (
    <div className="container-luxe pb-24 pt-16">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow mb-4">Trade portal</p>
          <h1 className="display text-5xl md:text-6xl">{account.businessName}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          {account.tier ? <Badge>{account.tier.name}</Badge> : <Badge tone="muted">Standard trade</Badge>}
          <Badge tone="muted">{TERMS_LABEL[account.terms]}</Badge>
        </div>
      </header>
      <PortalNav />
      <div className="pt-12">{children}</div>
    </div>
  );
}
