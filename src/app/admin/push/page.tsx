import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { getIntegration } from "@/server/integrations";
import { Empty, Kpi, PageHeader, Section, Table, Td, Th } from "@/components/admin/ui";
import { PushComposer } from "@/components/admin/push-composer";
import { BROADCAST_SEGMENTS } from "@/lib/push-shared";
import { fmtDateTime } from "@/lib/admin-shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Push notifications" };

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5);

const CHANNEL_LABEL: Record<string, string> = { orders: "Order updates", back_in_stock: "Back in stock", price_drop: "Price drops", abandoned_bag: "Bag reminders", broadcast: "Broadcasts", test: "Tests" };

export default async function PushPage() {
  await requirePermission("push.broadcast");
  const since = daysAgo(30);
  const [cfg, devices, customers, byChannel, broadcasts] = await Promise.all([
    getIntegration("push"),
    db.pushSubscription.count(),
    db.pushSubscription.findMany({ where: { userId: { not: null } }, distinct: ["userId"], select: { userId: true } }).then((r) => r.length),
    db.pushLog.groupBy({ by: ["channel"], where: { createdAt: { gte: since } }, _sum: { sent: true, failed: true }, _count: { _all: true } }),
    db.pushBroadcast.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const authors = new Map((await db.user.findMany({ where: { id: { in: [...new Set(broadcasts.map((b) => b.createdById))] } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u.name ?? u.email]));
  const sent30 = byChannel.reduce((a, c) => a + (c._sum.sent ?? 0), 0);

  return (
    <>
      <PageHeader eyebrow="Marketing" title="Push notifications">
        App and browser notifications. Order updates and back-in-stock alerts go out automatically; price drops and bag reminders run daily. Marketing pushes respect each customer’s settings, the email
        marketing opt-out and the caps ({cfg.marketingPerDay}/day, {cfg.marketingPerWeek}/week){cfg.enabled ? "" : " — push is currently switched OFF in Integrations"}.
      </PageHeader>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Devices" value={devices} />
        <Kpi label="Customers reachable" value={customers} />
        <Kpi label="Delivered (30 days)" value={sent30} />
      </div>

      <Section title="New broadcast">
        <PushComposer />
      </Section>

      <div className="mt-8 grid gap-8 xl:grid-cols-2">
        <Section title="By channel (30 days)">
          {byChannel.length ? (
            <Table className="min-w-[360px]">
              <thead>
                <tr>
                  <Th>Channel</Th>
                  <Th className="text-right">Messages</Th>
                  <Th className="text-right">Delivered</Th>
                  <Th className="text-right">Failed</Th>
                </tr>
              </thead>
              <tbody>
                {byChannel.map((c) => (
                  <tr key={c.channel}>
                    <Td>{CHANNEL_LABEL[c.channel] ?? c.channel}</Td>
                    <Td className="text-right tabular-nums">{c._count._all}</Td>
                    <Td className="text-right tabular-nums">{c._sum.sent ?? 0}</Td>
                    <Td className="text-right tabular-nums text-muted">{c._sum.failed ?? 0}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty>No pushes in the last 30 days.</Empty>
          )}
        </Section>
        <Section title="Recent broadcasts">
          {broadcasts.length ? (
            <ul className="divide-y divide-line">
              {broadcasts.map((b) => (
                <li key={b.id} className="px-5 py-3 text-sm">
                  <p className="break-words text-fg">{b.title}</p>
                  <p className="text-xs text-muted">
                    {fmtDateTime(b.createdAt)} · {BROADCAST_SEGMENTS.find((s) => s.value === b.segment)?.label ?? b.segment} · {b.sent} delivered / {b.recipients} customers · {authors.get(b.createdById) ?? "—"}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No broadcasts yet.</Empty>
          )}
        </Section>
      </div>
    </>
  );
}
