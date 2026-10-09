import Link from "next/link";
import { Badge } from "@/components/ui/field";
import { Empty, Kpi, PageHeader, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { RiskSettingsForm } from "@/components/admin/risk-settings-form";
import { db } from "@/server/db";
import { can, requirePermission } from "@/server/roles";
import { getRiskSettings, pincodeStats, riskTone } from "@/server/risk";
import { whatsappMode } from "@/server/whatsapp/client";
import { formatMoney } from "@/lib/money";
import { fmtDateTime } from "@/lib/admin-shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "COD & risk" };

type Reason = { code: string; label: string; points: number };
const reasonsOf = (v: unknown) => (Array.isArray(v) ? (v as Reason[]) : []);
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5);
const pinOf = (v: unknown) => (v && typeof v === "object" && "postalCode" in v ? String((v as { postalCode: unknown }).postalCode) : "—");

export default async function RiskPage() {
  const user = await requirePermission("orders.view");
  const since30 = daysAgo(30);
  const [settings, awaiting, risky, pins, autoCancelled, confirmed30, codTotal30, mode] = await Promise.all([
    getRiskSettings(),
    db.order.findMany({
      where: { codStatus: "AWAITING", status: "PENDING" },
      orderBy: { codConfirmBy: "asc" },
      take: 50,
      select: { id: true, number: true, total: true, placedAt: true, codConfirmBy: true, riskScore: true, codReminderSentAt: true, whatsappOptIn: true, shippingAddress: true },
    }),
    db.order.findMany({
      where: { placedAt: { gte: since30 }, riskScore: { gte: 30 } },
      orderBy: [{ riskScore: "desc" }, { placedAt: "desc" }],
      take: 50,
      select: { id: true, number: true, total: true, status: true, placedAt: true, riskScore: true, riskReasons: true, codStatus: true, shippingAddress: true },
    }),
    pincodeStats(),
    db.orderEvent.count({ where: { createdAt: { gte: since30 }, message: { startsWith: "Cash on delivery not confirmed in time" } } }),
    db.order.count({ where: { placedAt: { gte: since30 }, codStatus: "CONFIRMED" } }),
    db.order.count({ where: { placedAt: { gte: since30 }, codStatus: { not: null } } }),
    whatsappMode(),
  ]);

  return (
    <>
      <PageHeader eyebrow="Orders" title="COD & risk">
        Cash-on-delivery verification and return-to-origin (RTO) risk. WhatsApp is{" "}
        {mode === "live" ? (
          <span className="text-gold">live</span>
        ) : (
          <>
            in <span className="text-gold">test mode</span> (messages are recorded, not sent) —{" "}
            <Link href="/admin/integrations" className={linkClass}>
              connect it
            </Link>
          </>
        )}
        .
      </PageHeader>

      <div className="space-y-8">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Awaiting confirmation" value={awaiting.length} hint="Not to be packed yet" />
          <Kpi label="COD confirmed · 30d" value={codTotal30 ? `${Math.round((confirmed30 / codTotal30) * 100)}%` : "—"} hint={`${confirmed30} of ${codTotal30} COD orders`} />
          <Kpi label="Auto-cancelled · 30d" value={autoCancelled} hint={`After ${settings.confirmWithinHours}h without confirmation`} />
          <Kpi label="Risky orders · 30d" value={risky.filter((r) => (r.riskScore ?? 0) >= 60).length} hint="Score 60 or more" />
        </div>

        <Section title={`Awaiting COD confirmation · ${awaiting.length}`}>
          {awaiting.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Order</Th>
                  <Th>Pincode</Th>
                  <Th className="text-right">Total</Th>
                  <Th>Risk</Th>
                  <Th>Auto-cancels</Th>
                  <Th>WhatsApp</Th>
                </tr>
              </thead>
              <tbody>
                {awaiting.map((o) => (
                  <tr key={o.id}>
                    <Td>
                      <Link href={`/admin/orders/${o.id}`} className={linkClass}>
                        {o.number}
                      </Link>
                      <p className="text-xs text-subtle">{fmtDateTime(o.placedAt)}</p>
                    </Td>
                    <Td className="font-mono text-xs">{pinOf(o.shippingAddress)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(o.total)}</Td>
                    <Td>{o.riskScore != null ? <Badge tone={riskTone(o.riskScore)}>{o.riskScore}</Badge> : "—"}</Td>
                    <Td className="text-xs text-muted">
                      {fmtDateTime(o.codConfirmBy)}
                      {o.codReminderSentAt ? <span className="block text-subtle">reminded</span> : null}
                    </Td>
                    <Td className="text-xs text-muted">{o.whatsappOptIn ? "Opted in" : "Email / call only"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty>No cash-on-delivery orders are waiting for the customer.</Empty>
          )}
        </Section>

        <Section title="Risky orders · last 30 days">
          {risky.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Order</Th>
                  <Th>Score</Th>
                  <Th>Why</Th>
                  <Th className="text-right">Total</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {risky.map((o) => (
                  <tr key={o.id}>
                    <Td>
                      <Link href={`/admin/orders/${o.id}`} className={linkClass}>
                        {o.number}
                      </Link>
                      <p className="text-xs text-subtle">
                        {fmtDateTime(o.placedAt)} · {pinOf(o.shippingAddress)}
                      </p>
                    </Td>
                    <Td>
                      <Badge tone={riskTone(o.riskScore)}>{o.riskScore}</Badge>
                    </Td>
                    <Td className="max-w-md text-xs text-muted">{reasonsOf(o.riskReasons).map((r) => r.label).join(" · ") || "—"}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(o.total)}</Td>
                    <Td className="text-xs uppercase tracking-[0.15em] text-muted">
                      {o.status.toLowerCase()}
                      {o.codStatus ? <span className="block normal-case tracking-normal text-subtle">COD {o.codStatus.toLowerCase()}</span> : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty>No orders scored 30 or more in the last 30 days.</Empty>
          )}
        </Section>

        <Section title="Pincode COD history · 180 days">
          {pins.length ? (
            <Table className="min-w-[480px]">
              <thead>
                <tr>
                  <Th>Pincode</Th>
                  <Th className="text-right">COD orders</Th>
                  <Th className="text-right">Delivered</Th>
                  <Th className="text-right">Failed / RTO</Th>
                  <Th className="text-right">Failure rate</Th>
                </tr>
              </thead>
              <tbody>
                {pins.map((p) => (
                  <tr key={p.pin}>
                    <Td className="font-mono text-xs">
                      {p.pin}
                      {settings.blockedPincodes.includes(p.pin.toUpperCase()) ? <Badge tone="ember" className="ml-2">Blocked</Badge> : null}
                    </Td>
                    <Td className="text-right tabular-nums">{p.total}</Td>
                    <Td className="text-right tabular-nums text-muted">{p.delivered}</Td>
                    <Td className="text-right tabular-nums">{p.failed}</Td>
                    <Td className="text-right tabular-nums">
                      <span className={p.rate >= 0.3 && p.total >= 3 ? "text-ember" : "text-muted"}>{Math.round(p.rate * 100)}%</span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty>No cash-on-delivery orders yet.</Empty>
          )}
        </Section>

        <Section title="Rules">
          <RiskSettingsForm initial={settings} readOnly={!can(user, "settings.manage")} />
        </Section>
      </div>
    </>
  );
}
