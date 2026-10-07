import Link from "next/link";
import { Plus } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Badge, Input, Select } from "@/components/ui/field";
import { ProductActiveToggle } from "@/components/admin/toggles";
import { Empty, PageHeader, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { db } from "@/server/db";
import { can, requireAnyPermission } from "@/server/roles";
import { formatMoney } from "@/lib/money";
import { param } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Products" };

export default async function ProductsPage(props: PageProps<"/admin/products">) {
  const user = await requireAnyPermission("catalog.view", "catalog.edit");
  const canEdit = can(user, "catalog.edit");
  const sp = await props.searchParams;
  const q = param(sp.q);
  const category = param(sp.category);

  const where: Prisma.ProductWhereInput = {
    ...(q && { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }, { variants: { some: { sku: { contains: q, mode: "insensitive" } } } }] }),
    ...(category && { categoryId: category }),
  };

  const [categories, products] = await Promise.all([
    db.category.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true } }),
    db.product.findMany({
      where,
      orderBy: [{ category: { position: "asc" } }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        isActive: true,
        isFeatured: true,
        isBestseller: true,
        ratingAvg: true,
        ratingCount: true,
        category: { select: { name: true } },
        variants: { select: { price: true, stock: true, reserved: true } },
      },
    }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title="Products"
        actions={
          canEdit ? (
            <Button asChild size="sm">
              <Link href="/admin/products/new">
                <Plus className="size-3.5" aria-hidden /> New product
              </Link>
            </Button>
          ) : null
        }
      >
        {products.length} product{products.length === 1 ? "" : "s"}
      </PageHeader>

      <form method="get" role="search" className="mb-6 grid gap-4 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
        <label className="block">
          <span className="sr-only">Search products</span>
          <Input type="search" name="q" defaultValue={q} placeholder="Search by name, slug or SKU" />
        </label>
        <label className="block">
          <span className="sr-only">Category</span>
          <Select name="category" defaultValue={category}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" size="sm" variant="outline">
          Filter
        </Button>
      </form>

      <Section title="Catalog">
        {products.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Category</Th>
                <Th>Price</Th>
                <Th className="text-right">Available</Th>
                <Th>Rating</Th>
                <Th>Live</Th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const prices = p.variants.map((v) => v.price);
                const min = prices.length ? Math.min(...prices) : 0;
                const max = prices.length ? Math.max(...prices) : 0;
                const available = p.variants.reduce((s, v) => s + Math.max(0, v.stock - v.reserved), 0);
                return (
                  <tr key={p.id} className="transition-colors hover:bg-bg-soft/50">
                    <Td>
                      <Link href={`/admin/products/${p.id}`} className={linkClass}>
                        {p.name}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span className="font-mono text-xs text-subtle">{p.slug}</span>
                        {p.isFeatured ? <Badge>Featured</Badge> : null}
                        {p.isBestseller ? <Badge>Bestseller</Badge> : null}
                      </div>
                    </Td>
                    <Td className="text-muted">{p.category.name}</Td>
                    <Td className="whitespace-nowrap tabular-nums">
                      {prices.length ? (min === max ? formatMoney(min) : `${formatMoney(min)} – ${formatMoney(max)}`) : "—"}
                    </Td>
                    <Td className={available === 0 ? "text-right tabular-nums text-ember" : "text-right tabular-nums"}>{available}</Td>
                    <Td className="tabular-nums text-muted">{p.ratingCount ? `${p.ratingAvg.toFixed(1)} (${p.ratingCount})` : "—"}</Td>
                    <Td>
                      <ProductActiveToggle id={p.id} name={p.name} isActive={p.isActive} canEdit={canEdit} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <Empty>No products found.</Empty>
        )}
      </Section>
    </>
  );
}
