import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { TransferStatus } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/field";
import { TransferLinesEditor, TransferSteps } from "@/components/admin/warehouses/forms";
import { Empty, PageHeader, Section, Table, Td, Th } from "@/components/admin/ui";
import { db } from "@/server/db";
import { can, requirePermission } from "@/server/roles";
import { stockByWarehouse } from "@/server/warehouses";
import { fmtDateTime } from "@/lib/admin-shared";

export const dynamic = "force-dynamic";

const TONE: Record<TransferStatus, "gold" | "muted" | "ember"> = { DRAFT: "gold", IN_TRANSIT: "gold", RECEIVED: "muted", CANCELLED: "ember" };

export async function generateMetadata(props: PageProps<"/admin/transfers/[id]">) {
  const { id } = await props.params;
  const t = await db.stockTransfer.findUnique({ where: { id }, select: { number: true } });
  return { title: t ? t.number : "Transfer" };
}

export default async function TransferPage(props: PageProps<"/admin/transfers/[id]">) {
  const user = await requirePermission("inventory.view");
  const canAdjust = can(user, "inventory.adjust");
  const { id } = await props.params;
  const t = await db.stockTransfer.findUnique({
    where: { id },
    include: {
      from: true,
      to: true,
      lines: { orderBy: { variant: { sku: "asc" } }, include: { variant: { select: { id: true, sku: true, label: true, product: { select: { name: true } } } } } },
    },
  });
  if (!t) notFound();
  const split = await stockByWarehouse(t.lines.map((l) => l.variantId));
  const free = (vid: string) => {
    const r = split.get(vid)?.get(t.fromId);
    return Math.max(0, (r?.stock ?? 0) - (r?.reserved ?? 0));
  };
  const logs = await db.inventoryLog.findMany({
    where: { variantId: { in: t.lines.map((l) => l.variantId) }, reason: { in: ["TRANSFER_OUT", "TRANSFER_IN"] }, warehouseId: { in: [t.fromId, t.toId] }, createdAt: { gte: t.createdAt } },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: { variant: { select: { sku: true } } },
  });
  const codes = new Map([[t.fromId, t.from.code], [t.toId, t.to.code]]);

  return (
    <>
      <Link href="/admin/transfers" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted hover:text-gold">
        <ArrowLeft className="size-3.5" aria-hidden /> Transfers
      </Link>
      <PageHeader eyebrow={`${t.from.code} → ${t.to.code}`} title={t.number} actions={canAdjust ? <TransferSteps id={t.id} number={t.number} status={t.status} /> : null}>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Badge tone={TONE[t.status]}>{t.status.replace("_", " ").toLowerCase()}</Badge>
          <span>Created {fmtDateTime(t.createdAt)}</span>
          {t.dispatchedAt ? <span>Dispatched {fmtDateTime(t.dispatchedAt)}</span> : null}
          {t.receivedAt ? <span>Received {fmtDateTime(t.receivedAt)}</span> : null}
          {t.cancelledAt ? <span>Cancelled {fmtDateTime(t.cancelledAt)}</span> : null}
          {t.note ? <span>{t.note}</span> : null}
        </span>
      </PageHeader>

      <Section title={`Lines · ${t.lines.reduce((n, l) => n + l.quantity, 0)} units`} className="mb-8">
        {t.status === "DRAFT" && canAdjust ? (
          <TransferLinesEditor
            id={t.id}
            fromId={t.fromId}
            initial={t.lines.map((l) => ({ variantId: l.variantId, sku: l.variant.sku, product: l.variant.product.name, label: l.variant.label, quantity: l.quantity, available: free(l.variantId) }))}
          />
        ) : t.lines.length ? (
          <Table className="min-w-[480px]">
            <thead>
              <tr>
                <Th>Variant</Th>
                <Th className="text-right">Quantity</Th>
              </tr>
            </thead>
            <tbody>
              {t.lines.map((l) => (
                <tr key={l.id}>
                  <Td>
                    {l.variant.product.name} <span className="text-xs text-subtle">{l.variant.label}</span>
                    <span className="block font-mono text-[0.6875rem] text-subtle">{l.variant.sku}</span>
                  </Td>
                  <Td className="text-right tabular-nums">{l.quantity}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No lines.</Empty>
        )}
      </Section>

      <Section title="Stock movements">
        {logs.length ? (
          <ul className="divide-y divide-line">
            {logs.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="font-mono text-xs">{l.variant.sku}</span>
                <span className="text-xs text-muted">
                  {l.reason === "TRANSFER_OUT" ? "Out of" : "Into"} {codes.get(l.warehouseId ?? "") ?? "—"} · {fmtDateTime(l.createdAt)}
                </span>
                <span className={`tabular-nums ${l.delta < 0 ? "text-ember" : "text-gold"}`}>{l.delta > 0 ? `+${l.delta}` : l.delta}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nothing has moved yet.</Empty>
        )}
      </Section>
    </>
  );
}
