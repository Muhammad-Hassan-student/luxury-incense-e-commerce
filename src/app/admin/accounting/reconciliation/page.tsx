import Link from "next/link";
import { Badge, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { AccountingTabs, money2 } from "@/components/admin/accounting/tabs";
import { CodRemittanceForm, FetchPayoutsForm, ImportCsvForm } from "@/components/admin/accounting/forms";
import { Empty, Kpi, PageHeader, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { can, requirePermission } from "@/server/roles";
import { getIntegration } from "@/server/integrations";
import { reconciliationOverview, unremittedCod, unsettledPayments } from "@/server/accounting/reconciliation";
import { fmtDate } from "@/lib/admin-shared";
import { param } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payout reconciliation" };

const PROVIDERS = ["STRIPE", "RAZORPAY", "COD"] as const;
const LABEL: Record<string, string> = { STRIPE: "Stripe", RAZORPAY: "Razorpay", COD: "COD remittance" };
const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export default async function ReconciliationPage(props: PageProps<"/admin/accounting/reconciliation">) {
  const user = await requirePermission("accounting.view");
  const canManage = can(user, "accounting.manage");
  const sp = await props.searchParams;
  const provider = (PROVIDERS as readonly string[]).includes(param(sp.provider)) ? param(sp.provider) : "";
  const status = ["MATCHED", "REVIEW"].includes(param(sp.status)) ? param(sp.status) : "";

  const [{ settlements, totals }, stripeCfg, rzCfg, unsettled, cod] = await Promise.all([
    reconciliationOverview({ provider, status }),
    getIntegration("stripe"),
    getIntegration("razorpay"),
    unsettledPayments(7),
    unremittedCod(),
  ]);
  const t = (k: "gross" | "refunds" | "fees" | "feeTax" | "net" | "deposited" | "matched" | "unmatched" | "mismatched") => totals.reduce((n, x) => n + (x._sum[k] ?? 0), 0);
  const now = new Date();
  const today = istDay(now);
  const monthAgo = istDay(new Date(now.getTime() - 30 * 86400_000));
  const review = settlements.filter((s) => s.status !== "MATCHED").length;

  return (
    <>
      <PageHeader eyebrow="Finance" title="Payout reconciliation">
        Stripe payouts, Razorpay settlements and courier COD remittances matched to orders, refunds and fees.
      </PageHeader>
      <AccountingTabs active="reconciliation" canManage={canManage} />

      <div className="mb-8 grid grid-cols-2 gap-px lg:grid-cols-5">
        <Kpi label="Gross settled" value={money2(t("gross"))} hint={`${settlements.length} settlement${settlements.length === 1 ? "" : "s"}`} />
        <Kpi label="Refunds" value={money2(t("refunds"))} />
        <Kpi label="Fees + GST on fees" value={money2(t("fees") + t("feeTax"))} hint={`GST ${money2(t("feeTax"))} (input credit)`} />
        <Kpi label="Net deposited" value={money2(t("deposited"))} hint={t("deposited") !== t("net") ? `Lines net ${money2(t("net"))}` : "Equals line totals"} />
        <Kpi label="Lines to review" value={<span className={t("unmatched") + t("mismatched") ? "text-ember" : undefined}>{t("unmatched") + t("mismatched")}</span>} hint={`${t("matched")} matched · ${review} settlement${review === 1 ? "" : "s"} flagged`} />
      </div>

      {canManage ? (
        <div className="mb-8 grid gap-8">
          <Section title="Fetch from provider">
            <FetchPayoutsForm from={monthAgo} to={today} live={{ STRIPE: Boolean(stripeCfg.secretKey), RAZORPAY: Boolean(rzCfg.keySecret) }} />
          </Section>
          <Section title="Import a CSV report">
            <ImportCsvForm />
          </Section>
          <Section title="Record a COD remittance">
            <CodRemittanceForm today={today} />
          </Section>
        </div>
      ) : null}

      <form method="get" className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-[14rem_14rem_auto] sm:items-end">
        <label className="block">
          <span className="sr-only">Provider</span>
          <Select name="provider" defaultValue={provider}>
            <option value="">All providers</option>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {LABEL[p]}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="sr-only">Status</span>
          <Select name="status" defaultValue={status}>
            <option value="">Any status</option>
            <option value="MATCHED">Matched</option>
            <option value="REVIEW">Needs review</option>
          </Select>
        </label>
        <Button type="submit" size="sm" variant="outline" className="col-span-2 sm:col-span-1">
          Filter
        </Button>
      </form>

      <Section title={`Settlements · ${settlements.length}`} className="mb-8">
        {settlements.length ? (
          <Table className="min-w-[900px]">
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th>Date</Th>
                <Th className="text-right">Gross</Th>
                <Th className="text-right">Refunds</Th>
                <Th className="text-right">Fees + GST</Th>
                <Th className="text-right">Deposited</Th>
                <Th className="text-right">Lines</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <Link href={`/admin/accounting/reconciliation/${s.id}`} className={`${linkClass} font-mono text-xs`}>
                      {s.externalId}
                    </Link>
                    <span className="block text-xs text-subtle">
                      {LABEL[s.provider] ?? s.provider}
                      {s.source === "mock" ? " · test data" : s.source === "csv" ? " · CSV" : s.source === "manual" ? " · entered" : ""}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{fmtDate(s.settledAt)}</Td>
                  <Td className="text-right tabular-nums">{money2(s.gross)}</Td>
                  <Td className="text-right tabular-nums text-muted">{s.refunds ? `−${money2(s.refunds)}` : "—"}</Td>
                  <Td className="text-right tabular-nums text-muted">{s.fees + s.feeTax ? `−${money2(s.fees + s.feeTax)}` : "—"}</Td>
                  <Td className={`text-right tabular-nums ${s.deposited !== s.net ? "text-ember" : ""}`} title={s.deposited !== s.net ? `Lines net ${money2(s.net)}` : undefined}>
                    {money2(s.deposited)}
                  </Td>
                  <Td className="whitespace-nowrap text-right text-xs tabular-nums">
                    {s.matched} ok{s.unmatched ? <span className="text-ember"> · {s.unmatched} unmatched</span> : null}
                    {s.mismatched ? <span className="text-ember"> · {s.mismatched} mismatch</span> : null}
                  </Td>
                  <Td>
                    <Badge tone={s.status === "MATCHED" ? "muted" : "ember"}>{s.status === "MATCHED" ? "Matched" : "Review"}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No settlements yet. Fetch them from Stripe / Razorpay, import a CSV or record a COD remittance.</Empty>
        )}
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title={`Paid online, not yet settled (> 7 days) · ${unsettled.length}`}>
          {unsettled.length ? (
            <ul className="divide-y divide-line">
              {unsettled.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                  <Link href={`/admin/orders/${p.orderId}`} className={linkClass}>
                    {p.order.number}
                  </Link>
                  <span className="text-xs text-muted">
                    {LABEL[p.provider]} · {fmtDate(p.createdAt)}
                  </span>
                  <span className="tabular-nums">{money2(p.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Every online payment older than a week is in a settlement.</Empty>
          )}
        </Section>
        <Section title={`COD delivered, not yet remitted · ${cod.length}`}>
          {cod.length ? (
            <ul className="divide-y divide-line">
              {cod.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                  <Link href={`/admin/orders/${s.orderId}`} className={linkClass}>
                    {s.order.number}
                  </Link>
                  <span className="font-mono text-xs text-muted">{s.awb ?? "—"}</span>
                  <span className="tabular-nums">{money2(s.codAmount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No delivered COD cash outstanding.</Empty>
          )}
        </Section>
      </div>
    </>
  );
}
