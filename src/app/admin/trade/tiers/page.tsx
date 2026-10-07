import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Empty, PageHeader, Section, Table, Td, Th, linkClass } from "@/components/admin/ui";
import { DeleteTierButton, TierForm, TierPriceCell } from "@/components/admin/trade/tier-admin";
import { tradeUnitPrice } from "@/components/trade/trade-rules";
import { db } from "@/server/db";
import { can, requireAnyPermission } from "@/server/roles";
import { tradeVariantWhere } from "@/server/trade";
import { formatMoney } from "@/lib/money";
import { param } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Price tiers" };

export default async function TradeTiersPage(props: PageProps<"/admin/trade/tiers">) {
  const user = await requireAnyPermission("trade.view", "trade.manage");
  const canEdit = can(user, "trade.manage");
  const sp = await props.searchParams;
  const creating = canEdit && param(sp.new) === "1";
  const editId = canEdit ? param(sp.edit) : "";
  const tierId = param(sp.tier);
  const q = param(sp.q).slice(0, 100);

  const tiers = await db.priceTier.findMany({ orderBy: { discountPercent: "asc" }, include: { _count: { select: { accounts: true, prices: true } } } });
  const editing = editId ? tiers.find((t) => t.id === editId) : undefined;
  const selected = tiers.find((t) => t.id === tierId) ?? null;

  const variantWhere: Prisma.ProductVariantWhereInput = {
    ...tradeVariantWhere,
    ...(q
      ? { OR: [{ sku: { contains: q, mode: "insensitive" } }, { label: { contains: q, mode: "insensitive" } }, { product: { name: { contains: q, mode: "insensitive" } } }] }
      : {}),
  };
  const variants = selected
    ? await db.productVariant.findMany({
        where: variantWhere,
        orderBy: [{ product: { name: "asc" } }, { position: "asc" }],
        take: 200,
        include: { product: { select: { name: true } }, tradePrices: { where: { tierId: selected.id } } },
      })
    : [];

  return (
    <>
      <Link href="/admin/trade" className="mb-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted hover:text-gold">
        <ArrowLeft className="size-3.5" aria-hidden /> Trade accounts
      </Link>
      <PageHeader
        eyebrow="Trade"
        title="Price tiers"
        actions={
          canEdit && !creating && !editing ? (
            <Button asChild size="sm">
              <Link href="/admin/trade/tiers?new=1">
                <Plus className="size-3.5" aria-hidden /> New tier
              </Link>
            </Button>
          ) : null
        }
      >
        A tier is a discount off retail plus a minimum order. Override individual variants for sharper (or firmer) prices.
      </PageHeader>

      {creating || editing ? (
        <Section title={editing ? `Edit ${editing.name}` : "New tier"} className="mb-8">
          <TierForm key={editing?.id ?? "new"} initial={editing} />
        </Section>
      ) : null}

      <Section title="Tiers" className="mb-8">
        {tiers.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Tier</Th>
                <Th className="text-right">Discount</Th>
                <Th className="text-right">Minimum order</Th>
                <Th className="text-right">Accounts</Th>
                <Th className="text-right">Overrides</Th>
                <Th className="sr-only">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((t) => (
                <tr key={t.id} className={t.id === selected?.id ? "bg-bg-soft" : undefined}>
                  <Td>
                    <p>{t.name}</p>
                    {t.description ? <p className="text-xs text-subtle">{t.description}</p> : null}
                  </Td>
                  <Td className="text-right tabular-nums">{t.discountPercent}%</Td>
                  <Td className="text-right tabular-nums text-muted">{t.minOrderValue ? formatMoney(t.minOrderValue) : "—"}</Td>
                  <Td className="text-right tabular-nums">{t._count.accounts}</Td>
                  <Td className="text-right tabular-nums">{t._count.prices}</Td>
                  <Td className="whitespace-nowrap text-right">
                    <span className="inline-flex items-center gap-5">
                      <Link href={`/admin/trade/tiers?tier=${t.id}`} className="text-xs uppercase tracking-[0.18em] text-muted hover:text-gold">
                        Prices
                      </Link>
                      {canEdit ? (
                        <>
                          <Link href={`/admin/trade/tiers?edit=${t.id}`} className="text-xs uppercase tracking-[0.18em] text-muted hover:text-gold">
                            Edit
                          </Link>
                          <DeleteTierButton id={t.id} name={t.name} />
                        </>
                      ) : null}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No tiers yet. Create one before approving accounts.</Empty>
        )}
      </Section>

      {selected ? (
        <Section
          title={`${selected.name} · per-variant prices`}
          actions={
            <form className="flex items-center gap-3" action="/admin/trade/tiers">
              <input type="hidden" name="tier" value={selected.id} />
              <label className="sr-only" htmlFor="tier-q">
                Search variants
              </label>
              <input
                id="tier-q"
                name="q"
                defaultValue={q}
                placeholder="Search product or SKU"
                className="h-8 w-52 border-0 border-b border-line-strong bg-transparent text-sm text-fg placeholder:text-subtle focus:border-gold focus:outline-none"
              />
            </form>
          }
        >
          {variants.length ? (
            <Table className="min-w-[760px]">
              <thead>
                <tr>
                  <Th>Variant</Th>
                  <Th className="text-right">Retail</Th>
                  <Th className="text-right">Tier price ({selected.discountPercent}%)</Th>
                  <Th className="text-right">Override ₹</Th>
                  <Th className="text-right">Effective</Th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => {
                  const override = v.tradePrices[0]?.price ?? null;
                  const computed = tradeUnitPrice(v.price, selected.discountPercent);
                  return (
                    <tr key={v.id}>
                      <Td>
                        <p>
                          {v.product.name} <span className="text-muted">· {v.label}</span>
                        </p>
                        <p className="font-mono text-xs text-subtle">{v.sku}</p>
                      </Td>
                      <Td className="text-right tabular-nums text-muted">{formatMoney(v.price)}</Td>
                      <Td className="text-right tabular-nums text-muted">{formatMoney(computed)}</Td>
                      <Td className="text-right">
                        <TierPriceCell tierId={selected.id} variantId={v.id} label={`${v.product.name} ${v.label}`} override={override} computed={computed} canEdit={canEdit} />
                      </Td>
                      <Td className="text-right tabular-nums text-gold">{formatMoney(tradeUnitPrice(v.price, selected.discountPercent, override))}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : (
            <Empty>No tradeable variants match.</Empty>
          )}
          <p className="border-t border-line px-5 py-3 text-xs text-subtle">
            Only trade-enabled variants of active products are listed (gift cards and the build-your-own coffret are never sold on trade). Set case sizes, minimums and which variants are sold on trade under{" "}
            <Link href="/admin/trade/packs" className={linkClass}>
              Case packs
            </Link>
            .
          </p>
        </Section>
      ) : tiers.length ? (
        <p className="text-sm text-muted">Choose “Prices” on a tier to set per-variant overrides.</p>
      ) : null}
    </>
  );
}
