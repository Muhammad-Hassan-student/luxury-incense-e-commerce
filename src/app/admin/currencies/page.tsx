import Link from "next/link";
import { PageHeader, Section } from "@/components/admin/ui";
import { BaseCurrencyWizard, CurrencyTable, RefreshRatesButton } from "@/components/admin/currency-admin";
import { requirePermission } from "@/server/roles";
import { currencyOverview, FX_SOURCE_URL, STALE_DAYS } from "@/server/fx";
import { lastConversion } from "@/server/currency-conversion";
import { regionNow } from "@/lib/region-runtime";
import type { Currency } from "@/config/brand";
import type { Rounding } from "@/lib/region-shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Currencies" };

export default async function CurrenciesPage() {
  const access = await requirePermission("settings.manage");
  const [{ region, list, status, lastUpdated, stale }, last] = await Promise.all([currencyOverview(), lastConversion()]);
  const when = (d: Date) => d.toLocaleString(regionNow().locale, { dateStyle: "medium", timeStyle: "short", timeZone: region.timezone });
  const rates = Object.fromEntries(list.map((c) => [c.code, c.rate])) as Partial<Record<Currency, number>>;
  const rounding = Object.fromEntries(list.map((c) => [c.code, c.rounding])) as Partial<Record<Currency, Rounding>>;
  const summary = last?.summary as { changes?: number } | null;

  return (
    <>
      <PageHeader eyebrow="Settings" title="Currencies" actions={<RefreshRatesButton />}>
        Base {region.baseCurrency} · {region.enabledCurrencies.length} currencies offered to shoppers · rates from{" "}
        <a href={`${FX_SOURCE_URL}${region.baseCurrency}`} className="underline underline-offset-4" target="_blank" rel="noreferrer">
          open.er-api.com
        </a>{" "}
        daily{lastUpdated ? `, last updated ${when(lastUpdated)}` : ""}.
      </PageHeader>

      <div className="space-y-8">
        {(stale || status.lastError) && (
          <div className="border border-ember/50 bg-ember/5 p-5 text-sm" role="alert" data-fx-stale>
            {stale ? <p className="text-ember">{lastUpdated ? `Exchange rates are more than ${STALE_DAYS} days old for some currencies. Prices in those currencies may be off — refresh now or pin a rate.` : "Live exchange rates haven’t been fetched yet — prices in other currencies use built-in estimates. Refresh now (the daily job does this automatically)."}</p> : null}
            {status.lastError ? (
              <p className="mt-1 text-muted">
                Last refresh {status.lastAttemptAt ? when(new Date(status.lastAttemptAt)) : ""} failed: {status.lastError}. The last good rates are still in use.
              </p>
            ) : null}
          </div>
        )}

        <Section title="Exchange rates & rounding">
          <p className="px-5 pt-4 text-xs text-subtle">
            Display price = {region.baseCurrency} price × rate, rounded per currency. Stripe charges shoppers in the currency they see, at exactly the rounded amount; cash on delivery{region.baseCurrency === "INR" ? " and Razorpay" : ""} charge {region.baseCurrency}. A manual rate pins a currency until you clear it.
          </p>
          <CurrencyTable rows={list.map((c) => ({ ...c, fetchedAt: c.fetchedAt ? c.fetchedAt.toISOString() : null }))} base={region.baseCurrency} sample={250000} />
        </Section>

        <section id="base" className="scroll-mt-28">
          <Section title="Base currency">
            {access.role === "OWNER" ? (
              <BaseCurrencyWizard
                base={region.baseCurrency}
                rates={rates}
                defaultRounding={rounding}
                undo={last ? { from: last.fromCurrency, to: last.toCurrency, at: last.createdAt.toISOString(), changes: summary?.changes ?? 0 } : null}
              />
            ) : (
              <p className="p-5 text-sm text-muted">
                The base currency is {region.baseCurrency}. Only the owner can change it (it re-prices the whole catalogue). Region and time zone: <Link href="/admin/settings" className="text-gold underline-offset-4 hover:underline">Settings</Link>.
              </p>
            )}
          </Section>
        </section>
      </div>
    </>
  );
}
