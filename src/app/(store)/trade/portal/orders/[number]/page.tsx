import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { approvedBuyer } from "@/server/trade-portal";
import { getCustomerInvoice } from "@/server/invoices";
import { TradeInvoice } from "@/components/trade/trade-invoice";
import { invoiceState } from "@/components/trade/trade-rules";

export async function generateMetadata(props: PageProps<"/trade/portal/orders/[number]">): Promise<Metadata> {
  const { number } = await props.params;
  return { title: `Invoice ${number}` };
}

export default async function TradeInvoicePage(props: PageProps<"/trade/portal/orders/[number]">) {
  const { number } = await props.params;
  const account = await approvedBuyer(`/trade/portal/orders/${number}`);
  if (!account) return null;
  // Scoped to this trade account first, then rendered with the shared invoice renderer.
  const order = await db.order.findFirst({ where: { number, tradeAccountId: account.id }, include: { payments: { select: { raw: true }, take: 1, orderBy: { createdAt: "asc" } } } });
  if (!order) notFound();
  const invoice = await getCustomerInvoice(account.userId, number);
  if (!invoice) notFound();
  const raw = order.payments[0]?.raw as { shipAfterPayment?: boolean; terms?: string } | null;
  return (
    <TradeInvoice
      invoice={invoice}
      backHref="/trade/portal/orders"
      backLabel="All orders"
      trade={{
        businessName: account.businessName,
        businessType: account.businessType,
        taxId: account.taxId,
        terms: raw?.terms === "PREPAID" || raw?.terms === "NET_15" || raw?.terms === "NET_30" || raw?.terms === "NET_60" ? raw.terms : account.terms,
        poNumber: order.poNumber,
        dueDate: order.dueDate,
        paidAt: order.paidAt,
        state: invoiceState(order),
        proforma: Boolean(raw?.shipAfterPayment),
      }}
    />
  );
}
