import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { StockTakeStatus } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/field";
import { StockTakeCancel, StockTakeCounter } from "@/components/admin/inventory/stocktake-forms";
import { Kpi, PageHeader, Section } from "@/components/admin/ui";
import { db } from "@/server/db";
import { can, requirePermission } from "@/server/roles";
import { formatMoney } from "@/lib/money";
import { fmtDateTime } from "@/lib/admin-shared";

export const dynamic = "force-dynamic";

const TONE: Record<StockTakeStatus, "gold" | "muted" | "ember"> = { OPEN: "gold", COMPLETED: "muted", CANCELLED: "ember" };

export async function generateMetadata(props: PageProps<"/admin/stocktakes/[id]">) {
  const { id } = await props.params;
  const t = await db.stockTake.findUnique({ where: { id }, select: { name: true } });
  return { title: t ? t.name : "Stocktake" };
}

export default async function StockTakePage(props: PageProps<"/admin/stocktakes/[id]">) {
  const user = await requirePermission("stocktake.manage");
  const { id } = await props.params;
  const take = await db.stockTake.findUnique({
    where: { id },
    include: {
      createdBy: { select: { email: true } },
      lines: {
        orderBy: [{ variant: { product: { name: "asc" } } }, { variant: { position: "asc" } }],
        select: {
          id: true,
          expected: true,
          counted: true,
          variant: { select: { sku: true, barcode: true, label: true, stock: true, costPrice: true, product: { select: { name: true } } } },
        },
      },
    },
  });
  if (!take) notFound();
  const editable = take.status === "OPEN" && can(user, "stocktake.manage");

  const lines = take.lines.map((l) => ({
    id: l.id,
    sku: l.variant.sku,
    barcode: l.variant.barcode,
    product: l.variant.product.name,
    label: l.variant.label,
    expected: l.expected,
    counted: l.counted,
    current: l.variant.stock,
    costPrice: l.variant.costPrice,
  }));
  const counted = lines.filter((l) => l.counted !== null);
  const varianceUnits = counted.reduce((t, l) => t + (l.counted! - l.expected), 0);
  const varianceValue = counted.reduce((t, l) => t + (l.counted! - l.expected) * (l.costPrice ?? 0), 0);
  const drift = take.status === "OPEN" ? counted.filter((l) => l.current !== l.expected).length : 0;

  return (
    <>
      <Link href="/admin/stocktakes" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted hover:text-gold">
        <ArrowLeft className="size-3.5" aria-hidden /> Stocktakes
      </Link>
      <PageHeader eyebrow="Stocktake" title={take.name} actions={editable ? <StockTakeCancel id={take.id} name={take.name} /> : null}>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Badge tone={TONE[take.status]}>{take.status.toLowerCase()}</Badge>
          <span>
            Snapshot {fmtDateTime(take.createdAt)} by {take.createdBy.email}
          </span>
          {take.completedAt ? <span>Completed {fmtDateTime(take.completedAt)}</span> : null}
          {take.note ? <span>{take.note}</span> : null}
        </span>
      </PageHeader>

      <div className="mb-8 grid gap-px sm:grid-cols-3">
        <Kpi label="Lines counted" value={`${counted.length} / ${lines.length}`} hint={take.status === "OPEN" ? "Uncounted lines are left unchanged" : undefined} />
        <Kpi label={take.status === "COMPLETED" ? "Variance applied" : "Variance (saved counts)"} value={varianceUnits > 0 ? `+${varianceUnits}` : varianceUnits} hint="units vs snapshot" />
        <Kpi label="Variance at cost" value={`${varianceValue > 0 ? "+" : ""}${formatMoney(varianceValue)}`} hint={counted.some((l) => l.costPrice === null && l.counted !== l.expected) ? "Some lines have no cost price" : undefined} />
      </div>

      {drift ? (
        <p role="status" className="mb-6 border border-gold/40 px-5 py-4 text-sm text-gold">
          Stock has moved on {drift} counted line{drift === 1 ? "" : "s"} since the snapshot (sales, receipts or adjustments). Completing applies each line&rsquo;s variance against the snapshot to current stock, so those
          movements are preserved.
        </p>
      ) : null}
      {take.status !== "OPEN" ? <p className="mb-6 text-sm text-muted">This stocktake is {take.status.toLowerCase()} and read-only.</p> : null}

      <Section title="Count sheet">
        <StockTakeCounter id={take.id} name={take.name} lines={lines} readOnly={!editable} />
      </Section>
    </>
  );
}
