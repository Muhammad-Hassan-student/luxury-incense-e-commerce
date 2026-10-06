import Link from "next/link";
import { Empty, PageHeader, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { db } from "@/server/db";
import { requireRole } from "@/server/roles";
import { fmtDateTime } from "@/lib/admin-shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log" };

const entityHref: Record<string, (id: string) => string> = {
  Order: (id) => `/admin/orders/${id}`,
  Product: (id) => `/admin/products/${id}`,
  Coupon: (id) => `/admin/coupons?edit=${id}`,
};

function metaPreview(meta: unknown) {
  if (meta === null || meta === undefined) return "";
  const s = JSON.stringify(meta);
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

export default async function AuditPage() {
  await requireRole("MANAGER");
  const entries = await db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { actor: { select: { email: true } } },
  });

  return (
    <>
      <PageHeader eyebrow="Accountability" title="Audit log">
        The latest 200 staff actions.
      </PageHeader>
      <Section title="Entries">
        {entries.length ? (
          <Table className="min-w-[860px]">
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const href = e.entityId ? entityHref[e.entity]?.(e.entityId) : undefined;
                const meta = metaPreview(e.meta);
                return (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap text-muted">{fmtDateTime(e.createdAt)}</Td>
                    <Td className="text-muted">{e.actor.email}</Td>
                    <Td className="font-mono text-xs text-gold">{e.action}</Td>
                    <Td className="text-xs">
                      {e.entity}
                      {e.entityId ? (
                        href ? (
                          <Link href={href} className={`${linkClass} ml-2 font-mono text-subtle`}>
                            {e.entityId.slice(-8)}
                          </Link>
                        ) : (
                          <span className="ml-2 font-mono text-subtle">{e.entityId.length > 12 ? e.entityId.slice(-8) : e.entityId}</span>
                        )
                      ) : null}
                    </Td>
                    <Td className="max-w-md">
                      {meta ? (
                        <code className="block truncate font-mono text-[0.6875rem] text-subtle" title={JSON.stringify(e.meta, null, 2)}>
                          {meta}
                        </code>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <Empty>No staff actions recorded yet.</Empty>
        )}
      </Section>
    </>
  );
}
