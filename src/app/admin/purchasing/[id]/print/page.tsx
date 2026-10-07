import { notFound } from "next/navigation";
import { PrintButton } from "@/components/admin/inventory/print-button";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { brand } from "@/config/brand";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/admin-shared";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/admin/purchasing/[id]/print">) {
  const { id } = await props.params;
  const po = await db.purchaseOrder.findUnique({ where: { id }, select: { number: true } });
  return { title: po ? `${po.number} (print)` : "Purchase order" };
}

/**
 * Supplier-facing purchase order. Renders as a light sheet on screen; when printing, everything except the sheet is hidden
 * (the admin shell included), so it prints cleanly on white paper.
 */
export default async function PurchaseOrderPrintPage(props: PageProps<"/admin/purchasing/[id]/print">) {
  await requirePermission("purchasing.manage");
  const { id } = await props.params;
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: { orderBy: { variant: { sku: "asc" } }, include: { variant: { select: { sku: true, label: true, barcode: true, product: { select: { name: true } } } } } },
    },
  });
  if (!po) notFound();
  const total = po.items.reduce((t, i) => t + i.quantity * i.unitCost, 0);
  const units = po.items.reduce((t, i) => t + i.quantity, 0);

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          html, body { background: #fff !important; }
          body * { visibility: hidden !important; }
          .po-sheet, .po-sheet * { visibility: visible !important; }
          .po-sheet { position: absolute; inset: 0 auto auto 0; width: 100%; margin: 0 !important; padding: 0 !important; border: 0 !important; box-shadow: none !important; }
          .po-noprint { display: none !important; }
        }
      `}</style>
      <div className="po-noprint mb-6 flex items-center justify-between gap-4">
        <p className="text-sm text-muted">Print or save as PDF to send to {po.supplier.name}.</p>
        <PrintButton />
      </div>
      <article className="po-sheet mx-auto max-w-[210mm] border border-line bg-white p-8 font-sans text-[13px] leading-relaxed text-neutral-900 sm:p-12" style={{ colorScheme: "light" }}>
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-neutral-300 pb-6">
          <div>
            <p className="font-display text-2xl tracking-[0.2em] text-neutral-900">{brand.name.toUpperCase()}</p>
            <p className="text-neutral-600">{brand.email}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">Purchase order</p>
            <p className="font-mono text-xl text-neutral-900">{po.number}</p>
            {po.status === "CANCELLED" ? <p className="font-semibold uppercase text-red-700">Cancelled</p> : po.status === "DRAFT" ? <p className="uppercase text-neutral-500">Draft</p> : null}
          </div>
        </header>

        <section className="grid gap-6 border-b border-neutral-300 py-6 sm:grid-cols-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">Supplier</p>
            <p className="font-medium">{po.supplier.name}</p>
            {po.supplier.contactName ? <p>Attn: {po.supplier.contactName}</p> : null}
            {po.supplier.email ? <p>{po.supplier.email}</p> : null}
            {po.supplier.phone ? <p>{po.supplier.phone}</p> : null}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 sm:justify-self-end">
            <dt className="text-neutral-500">Date</dt>
            <dd>{fmtDate(po.orderedAt ?? po.createdAt)}</dd>
            <dt className="text-neutral-500">Deliver by</dt>
            <dd>{fmtDate(po.expectedAt)}</dd>
            <dt className="text-neutral-500">Currency</dt>
            <dd>{brand.baseCurrency}</dd>
          </dl>
        </section>

        <table className="mt-6 w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-neutral-400 text-[11px] uppercase tracking-[0.15em] text-neutral-500">
              <th scope="col" className="py-2 pr-3 font-normal">
                #
              </th>
              <th scope="col" className="py-2 pr-3 font-normal">
                Item
              </th>
              <th scope="col" className="py-2 pr-3 font-normal">
                SKU / barcode
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-normal">
                Qty
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-normal">
                Unit cost
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {po.items.map((i, n) => (
              <tr key={i.id} className="border-b border-neutral-200 align-top" style={{ breakInside: "avoid" }}>
                <td className="py-2 pr-3 text-neutral-500">{n + 1}</td>
                <td className="py-2 pr-3">
                  {i.variant.product.name}
                  <span className="block text-neutral-600">{i.variant.label}</span>
                </td>
                <td className="py-2 pr-3 font-mono text-[11px]">
                  {i.variant.sku}
                  {i.variant.barcode ? <span className="block text-neutral-500">{i.variant.barcode}</span> : null}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{i.quantity}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(i.unitCost)}</td>
                <td className="py-2 text-right tabular-nums">{formatMoney(i.quantity * i.unitCost)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-4 text-neutral-500">
                {po.items.length} line{po.items.length === 1 ? "" : "s"}
              </td>
              <td className="pt-4 pr-3 text-right tabular-nums">{units}</td>
              <td className="pt-4 pr-3 text-right text-[11px] uppercase tracking-[0.15em] text-neutral-500">Total</td>
              <td className="pt-4 text-right text-base font-medium tabular-nums">{formatMoney(total)}</td>
            </tr>
          </tfoot>
        </table>

        {po.notes ? (
          <section className="mt-8 border-t border-neutral-300 pt-4">
            <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">Notes</p>
            <p className="whitespace-pre-line">{po.notes}</p>
          </section>
        ) : null}

        <footer className="mt-10 text-[11px] text-neutral-500">Please quote {po.number} on your invoice and delivery note. Unit costs are exclusive of taxes unless agreed otherwise.</footer>
      </article>
    </>
  );
}
