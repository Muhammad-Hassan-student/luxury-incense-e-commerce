import Link from "next/link";
import { PageHeader, Section, linkClass } from "@/components/admin/ui";
import { CategoryBannerSlot } from "@/components/admin/category-banner";
import { db } from "@/server/db";
import { hasRole, requireRole } from "@/server/roles";
import { storageMode } from "@/server/media";

export const dynamic = "force-dynamic";
export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const user = await requireRole("SUPPORT");
  const canEdit = hasRole(user.role, "MANAGER");
  const categories = await db.category.findMany({ orderBy: { position: "asc" }, include: { _count: { select: { products: true } } } });

  return (
    <>
      <PageHeader eyebrow="Catalog" title="Categories">
        Banner media is optional. A video plays muted behind the category title (paused for visitors who prefer reduced motion, using the image instead); without media, each category keeps its animated ambience.
      </PageHeader>
      {storageMode() === "local" && (
        <p className="mb-6 text-xs text-subtle">Uploads are stored in public/uploads on this server. Set the CLOUDINARY_* keys before going live.</p>
      )}
      <div className="space-y-6">
        {categories.map((c) => (
          <Section
            key={c.id}
            title={`${c.name} · ${c._count.products} product${c._count.products === 1 ? "" : "s"}`}
            actions={
              <Link href={`/shop/${c.slug}`} target="_blank" className={linkClass}>
                View
              </Link>
            }
          >
            <div className="grid gap-8 md:grid-cols-2">
              <CategoryBannerSlot categoryId={c.id} field="heroImage" url={c.heroImage} canEdit={canEdit} />
              <CategoryBannerSlot categoryId={c.id} field="heroVideo" url={c.heroVideo} canEdit={canEdit} />
            </div>
          </Section>
        ))}
      </div>
    </>
  );
}
