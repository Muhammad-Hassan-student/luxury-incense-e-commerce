import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/field";
import { money2 } from "@/components/admin/accounting/tabs";
import { SettlementActions } from "@/components/admin/accounting/forms";
import { Empty, Kpi, PageHeader, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { db } from "@/server/db";
import { can, requirePermission } from "@/server/roles";
import { fmtDate, fmtDateTime } from "@/lib/admin-shared";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = { STRIPE: "Stripe payout", RAZORPAY: "Razorpay settlement", COD: "COD remittance" };
const TONE: Record<string, "gold" | "muted" | "ember"> = { MATCHED: "muted", UNMATCHED: "ember", MISMATCH: "ember" };

export async function generateMetadata(props: PageProps<"/admin/accounting/reconciliation/[id]">) {
  const { id } = await props.params;
  const s = await db.settlement.findUnique({ where: { id }, select: { externalId: true } });
  return { title: s ? s.externalId : "Settlement" };
}

export default async function SettlementPage(props: PageProps<"/admin/accounting/reconciliation/[id]">) {
  const user = await requirePermission("accounting.view");
  const { id } = await props.params;
  const s = await db.settlement.findUnique({ where: { id }, include: { lines: { orderBy: [{ status: "desc" }, { type: "asc" }, { externalRef: "asc" }] } } });
  if (!s) notFound();
  const diff = s.deposited - s.net;

  return (
    <>
      <Link href="/admin/accounting/reconciliation" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted hover:text-gold">
        <ArrowLeft className="size-3.5" aria-hidden /> Payouts
      </Link>
      <PageHeader eyebrow={LABEL[s.provider] ?? s.provider} title={s.externalId} actions={can(user, "accounting.manage") ? <SettlementActions id={s.id} label={s.externalId} /> : null}>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Badge tone={s.status === "MATCHED" ? "muted" : "ember"}>{s.status === "MATCHED" ? "Matched" : "Needs review"}</Badge>
          <span>Settled {fmtDate(s.settledAt)}</span>
          <span>Imported {fmtDateTime(s.updatedAt)}</span>
          {s.source === "mock" ? <Badge tone="gold">Test data</Badge> : null}
          {s.note ? <span>{s.note}</span> : null}
        </span>
      </PageHeader>

      <div className="mb-8 grid grid-cols-2 gap-px lg:grid-cols-5">
        <Kpi label="Gross" value={money2(s.gross)} />
        <Kpi label="Refunds" value={money2(s.refunds)} />
        <Kpi label="Fees + GST" value={money2(s.fees + s.feeTax)} hint={`GST on fees ${money2(s.feeTax)}`} />
        <Kpi label="Deposited" value={money2(s.deposited)} hint={diff ? <span className="text-ember">Lines net {money2(s.net)} ({diff > 0 ? "+" : ""}{money2(diff)})</span> : "Equals line totals"} />
        <Kpi label="Expected from orders" value={money2(s.expected)} hint={`${s.matched} matched · ${s.unmatched} unmatched · ${s.mismatched} mismatch`} />
      </div>

      <Section title={`Lines · ${s.lines.length}`}>
        {s.lines.length ? (
          <Table className="min-w-[980px]">
            <thead>
              <tr>
                <Th>Transaction</Th>
                <Th>Type</Th>
                <Th>Order</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Fee + GST</Th>
                <Th className="text-right">Net</Th>
                <Th className="text-right">Expected</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l) => (
                <tr key={l.id} className={l.status !== "MATCHED" ? "bg-ember/5" : undefined}>
                  <Td className="font-mono text-[0.6875rem] text-muted">
                    {l.externalRef}
                    {l.paymentRef && l.paymentRef !== l.externalRef ? <span className="block text-subtle">{l.paymentRef}</span> : null}
                  </Td>
                  <Td className="text-xs">{l.type.toLowerCase()}</Td>
                  <Td>
                    {l.orderId ? (
                      <Link href={`/admin/orders/${l.orderId}`} className={linkClass}>
                        {l.orderNumber}
                      </Link>
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{money2(l.amount)}</Td>
                  <Td className="text-right tabular-nums text-muted">{l.fee + l.tax ? money2(l.fee + l.tax) : "—"}</Td>
                  <Td className="text-right tabular-nums">{money2(l.net)}</Td>
                  <Td className="text-right tabular-nums text-muted">{l.expected === null ? "—" : money2(l.expected)}</Td>
                  <Td>
                    <Badge tone={TONE[l.status] ?? "muted"}>{l.status.toLowerCase()}</Badge>
                    {l.note ? <span className="mt-1 block max-w-64 text-xs text-muted">{l.note}</span> : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No lines.</Empty>
        )}
      </Section>
    </>
  );
}
