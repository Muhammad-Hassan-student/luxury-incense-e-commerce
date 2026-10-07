import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/roles";
import { getCustomerInvoice } from "@/server/invoices";
import { InvoiceDocument } from "@/components/account/invoice-document";

export async function generateMetadata(props: PageProps<"/account/orders/[number]/invoice">): Promise<Metadata> {
  const { number } = await props.params;
  return { title: `Invoice ${number}`, robots: { index: false } };
}

export default async function CustomerInvoicePage(props: PageProps<"/account/orders/[number]/invoice">) {
  const { number } = await props.params;
  const user = await requireUser(`/account/orders/${number}/invoice`);
  // Scoped to the signed-in customer; unconfirmed orders have no invoice.
  const invoice = await getCustomerInvoice(user.id, number);
  if (!invoice) notFound();
  return <InvoiceDocument invoice={invoice} backHref={`/account/orders/${number}`} backLabel="Back to order" />;
}
