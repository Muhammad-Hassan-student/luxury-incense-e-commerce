import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PoCreateForm } from "@/components/admin/inventory/po-forms";
import { Empty, PageHeader, Section, linkClass } from "@/components/admin/ui";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { param } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "New purchase order" };

export default async function NewPurchaseOrderPage(props: PageProps<"/admin/purchasing/new">) {
  await requirePermission("purchasing.manage");
  const sp = await props.searchParams;
  const suppliers = await db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, leadTimeDays: true } });
  const wanted = param(sp.supplier);
  const defaultSupplierId = suppliers.some((s) => s.id === wanted) ? wanted : undefined;

  return (
    <>
      <Link href="/admin/purchasing" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted hover:text-gold">
        <ArrowLeft className="size-3.5" aria-hidden /> Purchasing
      </Link>
      <PageHeader eyebrow="Purchasing" title="New purchase order">
        Start a draft, then add lines. Nothing is sent until you mark it as ordered.
      </PageHeader>
      <Section title="Draft">
        {suppliers.length ? (
          <PoCreateForm suppliers={suppliers} defaultSupplierId={defaultSupplierId} />
        ) : (
          <Empty>
            No active suppliers.{" "}
            <Link href="/admin/suppliers?new=1" className={linkClass}>
              Add one first
            </Link>
            .
          </Empty>
        )}
      </Section>
    </>
  );
}
