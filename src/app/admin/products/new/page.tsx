import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ProductForm } from "@/components/admin/product-form";
import { PageHeader } from "@/components/admin/ui";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";

export const dynamic = "force-dynamic";
export const metadata = { title: "New product" };

export default async function NewProductPage() {
  await requirePermission("catalog.edit");
  const categories = await db.category.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true } });
  return (
    <>
      <Link href="/admin/products" className="mb-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted hover:text-gold">
        <ArrowLeft className="size-3.5" aria-hidden /> Products
      </Link>
      <PageHeader eyebrow="Catalog" title="New product" />
      <ProductForm categories={categories} canEdit />
    </>
  );
}
