import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/server/roles";
import { getStaffInvoice } from "@/server/invoices";
import { InvoiceDocument } from "@/components/account/invoice-document";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Invoice", robots: { index: false } };

export default async function AdminInvoicePage(props: PageProps<"/admin/orders/[id]/invoice">) {
  await requirePermission("orders.view");
  const { id } = await props.params;
  const invoice = await getStaffInvoice(id);
  if (!invoice) notFound();
  return <InvoiceDocument invoice={invoice} backHref={`/admin/orders/${id}`} backLabel="Back to order" />;
}
