import Link from "next/link";
import { Plus } from "lucide-react";
import type { Coupon } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { CouponForm } from "@/components/admin/coupon-form";
import { CouponActiveToggle } from "@/components/admin/toggles";
import { Empty, PageHeader, Section, Table, Td, Th } from "@/components/admin/ui";
import { db } from "@/server/db";
import { hasRole, requireRole } from "@/server/roles";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/admin-shared";
import { param } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coupons" };

function describe(c: Coupon) {
  if (c.type === "PERCENT") return `${c.value}% off`;
  if (c.type === "FIXED") return `${formatMoney(c.value)} off`;
  return "Free shipping";
}

function state(c: Coupon, now: Date): { label: string; tone: "gold" | "ember" | "muted" } {
  if (!c.isActive) return { label: "Inactive", tone: "muted" };
  if (c.endsAt && c.endsAt < now) return { label: "Expired", tone: "ember" };
  if (c.startsAt && c.startsAt > now) return { label: "Scheduled", tone: "muted" };
  if (c.maxUses !== null && c.usedCount >= c.maxUses) return { label: "Used up", tone: "ember" };
  return { label: "Live", tone: "gold" };
}

export default async function CouponsPage(props: PageProps<"/admin/coupons">) {
  const user = await requireRole("SUPPORT");
  const canEdit = hasRole(user.role, "MANAGER");
  const sp = await props.searchParams;
  const editId = param(sp.edit);
  const creating = param(sp.new) === "1";

  const coupons = await db.coupon.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] });
  const editing = canEdit && editId ? coupons.find((c) => c.id === editId) : undefined;
  const now = new Date();

  return (
    <>
      <PageHeader
        eyebrow="Promotions"
        title="Coupons"
        actions={
          canEdit && !creating && !editing ? (
            <Button asChild size="sm">
              <Link href="/admin/coupons?new=1">
                <Plus className="size-3.5" aria-hidden /> New coupon
              </Link>
            </Button>
          ) : null
        }
      >
        {coupons.length} code{coupons.length === 1 ? "" : "s"}
      </PageHeader>

      {canEdit && (creating || editing) ? (
        <Section title={editing ? `Edit ${editing.code}` : "New coupon"} className="mb-8">
          <CouponForm key={editing?.id ?? "new"} initial={editing} />
        </Section>
      ) : null}

      <Section title="All coupons">
        {coupons.length ? (
          <Table className="min-w-[860px]">
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Discount</Th>
                <Th>Minimum</Th>
                <Th>Uses</Th>
                <Th>Window</Th>
                <Th>Status</Th>
                <Th>Active</Th>
                {canEdit ? <Th className="sr-only">Edit</Th> : null}
              </tr>
            </thead>
            <tbody>
              {coupons.map((c) => {
                const s = state(c, now);
                return (
                  <tr key={c.id}>
                    <Td>
                      <p className="font-mono">{c.code}</p>
                      {c.description ? <p className="text-xs text-subtle">{c.description}</p> : null}
                    </Td>
                    <Td>{describe(c)}</Td>
                    <Td className="tabular-nums text-muted">{c.minSubtotal ? formatMoney(c.minSubtotal) : "—"}</Td>
                    <Td className="tabular-nums text-muted">
                      {c.usedCount}
                      {c.maxUses !== null ? ` / ${c.maxUses}` : ""}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-muted">
                      {c.startsAt || c.endsAt ? `${fmtDate(c.startsAt)} → ${fmtDate(c.endsAt)}` : "Always"}
                    </Td>
                    <Td>
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </Td>
                    <Td>
                      <CouponActiveToggle id={c.id} code={c.code} isActive={c.isActive} canEdit={canEdit} />
                    </Td>
                    {canEdit ? (
                      <Td className="text-right">
                        <Link href={`/admin/coupons?edit=${c.id}`} className="text-xs uppercase tracking-[0.18em] text-muted hover:text-gold">
                          Edit
                        </Link>
                      </Td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <Empty>No coupons yet.</Empty>
        )}
      </Section>
    </>
  );
}
