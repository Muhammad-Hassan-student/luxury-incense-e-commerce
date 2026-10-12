import Link from "next/link";
import type { CommissionStatus } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/field";
import { Empty, Kpi, PageHeader, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { AffiliateActions, CommissionReview, InviteForm, PayoutControls, ProgramSettingsForm } from "@/components/admin/affiliates/affiliate-admin";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { getAffiliateSettings } from "@/server/affiliates";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/admin-shared";
import { param } from "@/lib/admin-queries";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Affiliates" };

const STATUS_TONE: Record<string, "gold" | "ember" | "muted"> = { APPROVED: "gold", PENDING: "muted", INVITED: "muted", SUSPENDED: "ember" };
const C_TONE: Record<CommissionStatus, "gold" | "ember" | "muted"> = { ATTRIBUTED: "muted", PENDING: "muted", APPROVED: "gold", PAID: "gold", REVERSED: "ember", REJECTED: "ember" };
const FLAG_LABEL: Record<string, string> = {
  self_referral: "Self-referral",
  similar_email: "Look-alike email",
  same_ip: "Affiliate’s IP",
  same_device: "Affiliate’s device",
  repeat_ip: "Repeat IP",
  referral_precedence: "Referral bonus paid",
};

export default async function AffiliatesPage(props: PageProps<"/admin/affiliates">) {
  await requirePermission("affiliates.manage");
  const sp = await props.searchParams;
  const filter = param(sp.show) === "flagged" ? "flagged" : param(sp.show) === "all" ? "all" : "review";

  const [settings, affiliates, clicks, sums, commissions, payouts] = await Promise.all([
    getAffiliateSettings(),
    db.affiliate.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 300 }),
    db.affiliateClick.groupBy({ by: ["affiliateId"], _count: { _all: true } }),
    db.affiliateCommission.groupBy({ by: ["affiliateId", "status"], _sum: { amount: true }, _count: { _all: true } }),
    db.affiliateCommission.findMany({
      where: filter === "flagged" ? { NOT: { flags: { isEmpty: true } } } : filter === "review" ? { OR: [{ status: "PENDING" }, { status: "APPROVED" }, { NOT: { flags: { isEmpty: true } }, status: { notIn: ["PAID", "REVERSED"] } }] } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.affiliatePayout.groupBy({ by: ["batch"], _sum: { amount: true }, _count: { _all: true }, _max: { createdAt: true }, orderBy: { _max: { createdAt: "desc" } }, take: 20 }),
  ]);
  const clicksBy = new Map(clicks.map((c) => [c.affiliateId, c._count._all]));
  const sumOf = (affiliateId: string | null, ...st: CommissionStatus[]) => sums.filter((s) => (!affiliateId || s.affiliateId === affiliateId) && st.includes(s.status)).reduce((n, s) => n + (s._sum.amount ?? 0), 0);
  const ordersOf = (affiliateId: string) => sums.filter((s) => s.affiliateId === affiliateId && ["PENDING", "APPROVED", "PAID"].includes(s.status)).reduce((n, s) => n + s._count._all, 0);
  const affById = new Map(affiliates.map((a) => [a.id, a]));
  const awaiting = affiliates.filter((a) => a.status === "PENDING").length;

  return (
    <>
      <PageHeader eyebrow="Marketing" title="Affiliates">
        Links (<code className="font-mono">?aff=CODE</code>, last click within {settings.cookieDays} days) and personal codes. Commission {settings.defaultCommissionPercent}% by default, on merchandise net of discounts, tax and refunds.
      </PageHeader>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Affiliates" value={affiliates.filter((a) => a.status === "APPROVED").length} hint={awaiting ? `${awaiting} awaiting approval` : `${affiliates.length} in total`} />
        <Kpi label="Pending" value={formatMoney(sumOf(null, "PENDING"))} hint="In the return window" />
        <Kpi label="Approved · to pay" value={formatMoney(sumOf(null, "APPROVED"))} />
        <Kpi label="Paid" value={formatMoney(sumOf(null, "PAID"))} />
      </div>

      <Section title="Affiliates" className="mb-8">
        {affiliates.length ? (
          <Table className="min-w-[1000px]">
            <thead>
              <tr>
                <Th>Affiliate</Th>
                <Th>Codes</Th>
                <Th className="text-right">Rate</Th>
                <Th className="text-right">Clicks</Th>
                <Th className="text-right">Orders</Th>
                <Th className="text-right">Pending</Th>
                <Th className="text-right">Approved</Th>
                <Th className="text-right">Paid</Th>
                <Th>Status</Th>
                <Th className="sr-only">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {affiliates.map((a) => (
                <tr key={a.id} data-affiliate-row={a.code}>
                  <Td>
                    <p>{a.name ?? "—"}</p>
                    <p className="text-xs text-subtle">{a.email}</p>
                    {a.payoutDetails ? <p className="text-xs text-subtle">Payout: {a.payoutDetails}</p> : null}
                  </Td>
                  <Td className="text-xs">
                    <p className="font-mono">{a.code}</p>
                    {a.couponCode ? <p className="font-mono text-subtle">{a.couponCode}</p> : null}
                  </Td>
                  <Td className="text-right tabular-nums">{a.commissionBps == null ? <span className="text-subtle">{settings.defaultCommissionPercent}%</span> : `${a.commissionBps / 100}%`}</Td>
                  <Td className="text-right tabular-nums text-muted">{clicksBy.get(a.id) ?? 0}</Td>
                  <Td className="text-right tabular-nums">{ordersOf(a.id)}</Td>
                  <Td className="text-right tabular-nums text-muted">{formatMoney(sumOf(a.id, "PENDING"))}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(sumOf(a.id, "APPROVED"))}</Td>
                  <Td className="text-right tabular-nums text-muted">{formatMoney(sumOf(a.id, "PAID"))}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[a.status] ?? "muted"}>{a.status.toLowerCase()}</Badge>
                  </Td>
                  <Td className="text-right">
                    <AffiliateActions a={{ id: a.id, code: a.code, status: a.status, ratePercent: a.commissionBps == null ? null : a.commissionBps / 100, couponCode: a.couponCode, hasUser: Boolean(a.userId) }} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No affiliates yet. Invite a creator below, or customers can apply from their account.</Empty>
        )}
      </Section>

      <Section
        title="Commissions"
        className="mb-8"
        actions={
          <nav className="flex gap-4 text-[0.625rem] uppercase tracking-[0.2em]" aria-label="Filter commissions">
            {(["review", "flagged", "all"] as const).map((k) => (
              <Link key={k} href={`/admin/affiliates?show=${k}`} className={cn(filter === k ? "text-gold" : "text-muted hover:text-fg")} aria-current={filter === k ? "true" : undefined}>
                {k === "review" ? "Open" : k}
              </Link>
            ))}
          </nav>
        }
      >
        {commissions.length ? (
          <Table className="min-w-[960px]">
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Affiliate</Th>
                <Th>Source</Th>
                <Th className="text-right">Base</Th>
                <Th className="text-right">Commission</Th>
                <Th>Flags</Th>
                <Th>Status</Th>
                <Th className="sr-only">Review</Th>
              </tr>
            </thead>
            <tbody>
              {commissions.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link href={`/admin/orders/${c.orderId}`} className={linkClass}>
                      {c.orderNumber}
                    </Link>
                    <p className="text-xs text-subtle">{fmtDateTime(c.createdAt)}</p>
                  </Td>
                  <Td className="font-mono text-xs">{affById.get(c.affiliateId)?.code ?? "—"}</Td>
                  <Td className="text-xs text-muted">{c.source === "code" ? "Discount code" : `Link${c.clickedAt ? ` · ${fmtDate(c.clickedAt)}` : ""}`}</Td>
                  <Td className="text-right tabular-nums text-muted">{formatMoney(c.base)}</Td>
                  <Td className="text-right tabular-nums">
                    {formatMoney(c.amount)}
                    <span className="block text-xs text-subtle">{(c.rateBps / 100).toString()}%</span>
                    {c.clawback ? <span className="block text-xs text-ember">Clawback {formatMoney(c.clawback)}</span> : null}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {c.flags.map((f) => (
                        <Badge key={f} tone="ember">
                          {FLAG_LABEL[f] ?? f}
                        </Badge>
                      ))}
                    </div>
                    {c.note ? <p className="mt-1 text-xs text-subtle">{c.note}</p> : null}
                  </Td>
                  <Td>
                    <Badge tone={C_TONE[c.status]}>{c.status.toLowerCase()}</Badge>
                  </Td>
                  <Td className="text-right">{["ATTRIBUTED", "PENDING", "APPROVED"].includes(c.status) ? <CommissionReview id={c.id} canApprove={c.status === "PENDING"} /> : null}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>Nothing here.</Empty>
        )}
      </Section>

      <div className="mb-8 grid gap-8 xl:grid-cols-2">
        <Section title="Payouts">
          <PayoutControls />
          {payouts.length ? (
            <Table className="min-w-[520px]">
              <thead>
                <tr>
                  <Th>Batch</Th>
                  <Th className="text-right">Affiliates</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="sr-only">Export</Th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.batch}>
                    <Td>
                      <p className="font-mono text-xs">{p.batch}</p>
                      <p className="text-xs text-subtle">{fmtDateTime(p._max.createdAt)}</p>
                    </Td>
                    <Td className="text-right tabular-nums">{p._count._all}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(p._sum.amount ?? 0)}</Td>
                    <Td className="text-right">
                      <a href={`/api/admin/export/affiliate-payouts?batch=${encodeURIComponent(p.batch)}`} className="text-xs uppercase tracking-[0.18em] text-muted hover:text-gold">
                        CSV
                      </a>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty>No payouts yet.</Empty>
          )}
        </Section>
        <Section title="Invite an affiliate">
          <InviteForm />
        </Section>
      </div>

      <Section title="Programme settings">
        <ProgramSettingsForm initial={settings} />
        <p className="border-t border-line px-5 py-4 text-xs text-subtle">
          Precedence: a referred customer’s first order pays the existing referral bonus and no affiliate commission. Self-referrals are blocked; orders from the affiliate’s own IP/device or a look-alike email are flagged and never auto-approved.
        </p>
      </Section>
    </>
  );
}
