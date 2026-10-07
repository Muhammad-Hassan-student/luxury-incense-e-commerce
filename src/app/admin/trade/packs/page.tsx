import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/field";
import { Empty, PageHeader, Section, Table, Td, Th } from "@/components/admin/ui";
import { PackRowForm } from "@/components/admin/trade/pack-row";
import { db } from "@/server/db";
import { can, requireAnyPermission } from "@/server/roles";
import { COFFRET_SLUG } from "@/server/trade";
import { formatMoney } from "@/lib/money";
import { param } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Case packs" };

export default async function TradePacksPage(props: PageProps<"/admin/trade/packs">) {
  const user = await requireAnyPermission("trade.view", "trade.manage");
  const canEdit = can(user, "trade.manage");
  const sp = await props.searchParams;
  const q = param(sp.q).slice(0, 100);
  const where: Prisma.ProductVariantWhereInput = {
    product: { isGiftCard: false, slug: { not: COFFRET_SLUG } },
    ...(q ? { OR: [{ sku: { contains: q, mode: "insensitive" } }, { label: { contains: q, mode: "insensitive" } }, { product: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const variants = await db.productVariant.findMany({
    where,
    orderBy: [{ product: { name: "asc" } }, { position: "asc" }],
    take: 300,
    include: { product: { select: { name: true, isActive: true } } },
  });

  return (
    <>
      <Link href="/admin/trade" className="mb-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted hover:text-gold">
        <ArrowLeft className="size-3.5" aria-hidden /> Trade accounts
      </Link>
      <PageHeader eyebrow="Trade" title="Case packs">
        Trade orders must be a multiple of the case size and at least the minimum. Untick “On trade” to hide a variant from trade buyers.
      </PageHeader>
      <Section
        title={`${variants.length} variant${variants.length === 1 ? "" : "s"}`}
        actions={
          <form className="flex items-center gap-3" action="/admin/trade/packs">
            <label className="sr-only" htmlFor="packs-q">
              Search variants
            </label>
            <input
              id="packs-q"
              name="q"
              defaultValue={q}
              placeholder="Search product or SKU"
              className="h-8 w-52 border-0 border-b border-line-strong bg-transparent text-sm text-fg placeholder:text-subtle focus:border-gold focus:outline-none"
            />
          </form>
        }
      >
        {variants.length ? (
          <Table className="min-w-[820px]">
            <thead>
              <tr>
                <Th>Variant</Th>
                <Th className="text-right">Retail</Th>
                <Th className="text-right">Available</Th>
                <Th className="text-right">Trade settings</Th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => (
                <tr key={v.id}>
                  <Td>
                    <p>
                      {v.product.name} <span className="text-muted">· {v.label}</span>
                    </p>
                    <p className="font-mono text-xs text-subtle">
                      {v.sku} {!v.product.isActive ? <Badge tone="muted">Inactive product</Badge> : null}
                    </p>
                  </Td>
                  <Td className="text-right tabular-nums text-muted">{formatMoney(v.price)}</Td>
                  <Td className="text-right tabular-nums text-muted">{Math.max(0, v.stock - v.reserved)}</Td>
                  <Td className="text-right">
                    {canEdit ? (
                      <PackRowForm variantId={v.id} label={`${v.product.name} ${v.label}`} caseSize={v.caseSize} tradeMinQty={v.tradeMinQty} tradeEnabled={v.tradeEnabled} />
                    ) : (
                      <span className="text-xs text-muted">
                        case {v.caseSize} · min {v.tradeMinQty} · {v.tradeEnabled ? "on trade" : "retail only"}
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No variants match.</Empty>
        )}
      </Section>
    </>
  );
}
