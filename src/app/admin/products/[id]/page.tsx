import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/field";
import { ProductForm } from "@/components/admin/product-form";
import { PageHeader, Section } from "@/components/admin/ui";
import { MediaManager } from "@/components/admin/media-manager";
import { storageMode } from "@/server/media";
import { db } from "@/server/db";
import { hasRole, requireRole } from "@/server/roles";
import { fmtDateTime } from "@/lib/admin-shared";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/admin/products/[id]">) {
  const { id } = await props.params;
  const p = await db.product.findUnique({ where: { id }, select: { name: true } });
  return { title: p?.name ?? "Product" };
}

export default async function EditProductPage(props: PageProps<"/admin/products/[id]">) {
  const user = await requireRole("SUPPORT");
  const { id } = await props.params;
  const [product, categories] = await Promise.all([
    db.product.findUnique({
      where: { id },
      include: {
        variants: {
          orderBy: { position: "asc" },
          select: { id: true, sku: true, label: true, price: true, compareAtPrice: true, weightGrams: true, stock: true, reserved: true },
        },
        images: { orderBy: { position: "asc" }, select: { id: true, type: true, url: true, poster: true, alt: true } },
      },
    }),
    db.category.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!product) notFound();

  return (
    <>
      <Link href="/admin/products" className="mb-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted hover:text-gold">
        <ArrowLeft className="size-3.5" aria-hidden /> Products
      </Link>
      <PageHeader
        eyebrow="Catalog"
        title={product.name}
        actions={product.isActive ? <Badge>Live</Badge> : <Badge tone="muted">Hidden</Badge>}
      >
        Last updated {fmtDateTime(product.updatedAt)}
        {product.ratingCount ? ` · ${product.ratingAvg.toFixed(1)} from ${product.ratingCount} reviews` : ""}
      </PageHeader>
      <Section title="Photos & video (optional)" className="mb-8">
        <MediaManager productId={product.id} media={product.images} canEdit={hasRole(user.role, "MANAGER")} storage={storageMode()} />
      </Section>
      <ProductForm key={product.updatedAt.toISOString()} initial={product} categories={categories} canEdit={hasRole(user.role, "MANAGER")} />
    </>
  );
}
