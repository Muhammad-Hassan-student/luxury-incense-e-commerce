import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ContentBlocks } from "@/components/admin/content-blocks";
import { Empty, PageHeader } from "@/components/admin/ui";
import { db } from "@/server/db";
import { hasRole, requireRole } from "@/server/roles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Content" };

export default async function ContentPage() {
  const user = await requireRole("SUPPORT");
  const canEdit = hasRole(user.role, "MANAGER");
  const [blocks, products] = await Promise.all([
    db.contentBlock.findMany({ where: { page: "home" }, orderBy: [{ position: "asc" }, { id: "asc" }] }),
    db.product.findMany({ where: { isActive: true }, select: { slug: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Storefront"
        title="Homepage"
        actions={
          <Link href="/" target="_blank" className="inline-flex items-center gap-2 text-[0.6875rem] uppercase tracking-[0.2em] text-muted hover:text-gold">
            Preview <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        }
      >
        Blocks render top to bottom. Hidden blocks keep their content.
      </PageHeader>
      {blocks.length ? (
        <ContentBlocks
          canEdit={canEdit}
          productSlugs={products.map((p) => p.slug)}
          blocks={blocks.map((b) => ({ id: b.id, type: b.type, position: b.position, enabled: b.enabled, data: b.data, updatedAt: b.updatedAt.toISOString() }))}
        />
      ) : (
        <Empty>No homepage blocks. Run the seed to create the default layout.</Empty>
      )}
    </>
  );
}
