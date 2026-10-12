import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Empty, Kpi, PageHeader, Section, Table, Td, Th } from "@/components/admin/ui";
import { PromotionForm, type PromoCatalog, type PromotionFormInitial } from "@/components/admin/promotions/promotion-form";
import { GuardForm, PreorderForm, PromotionRowActions, ReleasePreorderButton } from "@/components/admin/promotions/promotion-controls";
import { db } from "@/server/db";
import { can, requireAnyPermission } from "@/server/roles";
import { getPromotionSettings, promotionStats } from "@/server/promotions";
import { preorderOverview } from "@/server/preorders";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/admin-shared";
import { param } from "@/lib/admin-queries";
import { isLive, PROMOTION_TYPE_LABEL, type PromotionTypeKey } from "@/lib/promotions";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Promotions" };

type Row = Awaited<ReturnType<typeof db.promotion.findMany>>[number];

function state(p: Row, now: Date): { label: string; tone: "gold" | "ember" | "muted" } {
  if (!p.isActive) return { label: "Paused", tone: "muted" };
  if (p.endsAt && p.endsAt <= now) return { label: "Ended", tone: "ember" };
  if (p.startsAt && p.startsAt > now) return { label: "Scheduled", tone: "muted" };
  return isLive(p, now) ? { label: "Live", tone: "gold" } : { label: "Off", tone: "muted" };
}

function describe(p: Row) {
  const c = (p.config ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof c[k] === "number" ? (c[k] as number) : 0);
  switch (p.type) {
    case "FLASH_SALE":
      return c.kind === "FIXED" ? `${formatMoney(n("value"))} off each` : `${n("value")}% off`;
    case "BUY_X_GET_Y":
      return `Buy ${n("buyQty")} get ${n("getQty")} ${n("getPercentOff") >= 100 ? "free" : `${n("getPercentOff")}% off`}`;
    case "MULTI_BUY":
      return `Any ${n("quantity")} for ${formatMoney(n("price"))}`;
    case "FIXED_BUNDLE":
      return `${Array.isArray(c.items) ? (c.items as { quantity: number }[]).reduce((s, i) => s + i.quantity, 0) : 0} pieces for ${formatMoney(n("price"))}`;
    case "TIERED":
      return Array.isArray(c.tiers) ? (c.tiers as { threshold: number; percent: number }[]).map((t) => `${formatMoney(t.threshold)}→${t.percent}%`).join(" · ") : "";
  }
}

const tabClass = (on: boolean) => cn("border-b-2 pb-3 text-[0.6875rem] uppercase tracking-[0.24em] transition-colors", on ? "border-gold text-fg" : "border-transparent text-muted hover:text-fg");

export default async function PromotionsPage(props: PageProps<"/admin/promotions">) {
  const user = await requireAnyPermission("promotions.view", "promotions.manage");
  const canEdit = can(user, "promotions.manage");
  const sp = await props.searchParams;
  const tab = param(sp.tab) === "preorders" ? "preorders" : "promotions";
  const editId = param(sp.edit);
  const creating = param(sp.new) === "1";
  const now = new Date();

  const [promotions, stats, settings] = await Promise.all([db.promotion.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] }), promotionStats(), getPromotionSettings()]);
  const editing = canEdit && editId && tab === "promotions" ? promotions.find((p) => p.id === editId) : undefined;
  const needsCatalog = canEdit && (creating || Boolean(editing) || tab === "preorders");
  const products = needsCatalog
    ? await db.product.findMany({
        where: { isActive: true, isGiftCard: false },
        orderBy: { name: "asc" },
        select: { id: true, name: true, categoryId: true, model: true, variants: { orderBy: { position: "asc" }, select: { id: true, label: true, price: true, sku: true } } },
      })
    : [];
  const catalog: PromoCatalog = {
    products: products.map((p) => ({ id: p.id, name: p.name, categoryId: p.categoryId, variants: p.variants.map((v) => ({ id: v.id, label: v.label, price: v.price })) })),
    categories: needsCatalog ? await db.category.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true } }) : [],
  };
  const live = promotions.filter((p) => isLive(p, now));
  const totals = [...stats.values()].reduce((a, s) => ({ uses: a.uses + s.uses, discount: a.discount + s.discount, revenue: a.revenue + s.revenue }), { uses: 0, discount: 0, revenue: 0 });

  return (
    <>
      <PageHeader
        eyebrow="Marketing"
        title="Promotions"
        actions={
          canEdit && tab === "promotions" && !creating && !editing ? (
            <Button asChild size="sm">
              <Link href="/admin/promotions?new=1">
                <Plus className="size-3.5" aria-hidden /> New promotion
              </Link>
            </Button>
          ) : canEdit && tab === "preorders" && !creating ? (
            <Button asChild size="sm">
              <Link href="/admin/promotions?tab=preorders&new=1">
                <Plus className="size-3.5" aria-hidden /> New pre-order
              </Link>
            </Button>
          ) : null
        }
      >
        Flash sales, bundles, tiered discounts and pre-orders. Applied server-side at checkout in a fixed order: sale price → bundles → tiers → coupon.
      </PageHeader>

      <nav className="mb-8 flex gap-8 border-b border-line" aria-label="Promotions sections">
        <Link href="/admin/promotions" className={tabClass(tab === "promotions")} aria-current={tab === "promotions" ? "page" : undefined}>
          Promotions
        </Link>
        <Link href="/admin/promotions?tab=preorders" className={tabClass(tab === "preorders")} aria-current={tab === "preorders" ? "page" : undefined}>
          Pre-orders
        </Link>
      </nav>

      {tab === "promotions" ? (
        <>
          <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi label="Live now" value={live.length} hint={`${promotions.length} in total`} />
            <Kpi label="Orders using offers" value={totals.uses} />
            <Kpi label="Discount given" value={formatMoney(totals.discount)} />
            <Kpi label="Attributed revenue" value={formatMoney(totals.revenue)} />
          </div>

          {canEdit && (creating || editing) ? (
            <Section title={editing ? `Edit ${editing.name}` : "New promotion"} className="mb-8">
              <PromotionForm key={editing?.id ?? "new"} initial={editing ? ({ ...editing, type: editing.type as PromotionTypeKey, config: (editing.config ?? {}) as Record<string, unknown> } satisfies PromotionFormInitial) : undefined} catalog={catalog} />
            </Section>
          ) : null}

          <Section title="All promotions" className="mb-8">
            {promotions.length ? (
              <Table className="min-w-[980px]">
                <thead>
                  <tr>
                    <Th>Promotion</Th>
                    <Th>Offer</Th>
                    <Th>Window</Th>
                    <Th>Rules</Th>
                    <Th className="text-right">Uses</Th>
                    <Th className="text-right">Discount</Th>
                    <Th className="text-right">Revenue</Th>
                    <Th>Status</Th>
                    {canEdit ? <Th className="sr-only">Actions</Th> : null}
                  </tr>
                </thead>
                <tbody>
                  {promotions.map((p) => {
                    const s = state(p, now);
                    const st = stats.get(p.id);
                    return (
                      <tr key={p.id} data-promo-row={p.id}>
                        <Td>
                          <p>{p.name}</p>
                          <p className="text-xs text-subtle">
                            {PROMOTION_TYPE_LABEL[p.type as PromotionTypeKey]}
                            {p.badge ? ` · “${p.badge}”` : ""}
                          </p>
                        </Td>
                        <Td className="text-sm">{describe(p)}</Td>
                        <Td className="whitespace-nowrap text-xs text-muted">{p.startsAt || p.endsAt ? `${fmtDateTime(p.startsAt)} → ${fmtDateTime(p.endsAt)}` : "Always"}</Td>
                        <Td className="text-xs text-muted">
                          {[`P${p.priority}`, p.stackable ? null : "no stacking", p.allowCoupon ? null : "no coupons", p.includeTrade ? "trade" : null, p.includeSubscriptions ? "subscriptions" : null, p.productIds.length || p.categoryIds.length ? `${p.productIds.length + p.categoryIds.length} targets` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </Td>
                        <Td className="text-right tabular-nums">{st?.uses ?? 0}</Td>
                        <Td className="text-right tabular-nums text-muted">{formatMoney(st?.discount ?? 0)}</Td>
                        <Td className="text-right tabular-nums">{formatMoney(st?.revenue ?? 0)}</Td>
                        <Td>
                          <Badge tone={s.tone}>{s.label}</Badge>
                        </Td>
                        {canEdit ? (
                          <Td className="text-right">
                            <div className="flex flex-wrap items-center justify-end gap-3">
                              <Link href={`/admin/promotions?edit=${p.id}`} className="text-xs uppercase tracking-[0.18em] text-muted hover:text-gold">
                                Edit
                              </Link>
                              <PromotionRowActions id={p.id} name={p.name} isActive={p.isActive} />
                            </div>
                          </Td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : (
              <Empty>No promotions yet.</Empty>
            )}
          </Section>

          <Section title="Discount guard">
            {canEdit ? <GuardForm maxDiscountPercent={settings.maxDiscountPercent} /> : <p className="p-5 text-sm text-muted">At most {settings.maxDiscountPercent}% off the list price in total.</p>}
          </Section>
        </>
      ) : (
        <PreordersTab canEdit={canEdit} creating={creating} editId={editId} variants={products.flatMap((p) => (p.model === "GIFTBOX" ? [] : p.variants.map((v) => ({ id: v.id, name: `${p.name} · ${v.label} (${v.sku})` }))))} />
      )}
    </>
  );
}

async function PreordersTab({ canEdit, creating, editId, variants }: { canEdit: boolean; creating: boolean; editId?: string; variants: { id: string; name: string }[] }) {
  const rows = await preorderOverview();
  const editing = editId ? rows.find((r) => r.variantId === editId) : undefined;
  return (
    <>
      {canEdit && (creating || editing) ? (
        <Section title={editing ? `Edit pre-order · ${editing.variant?.product.name ?? editing.variantId}` : "New pre-order"} className="mb-8">
          <PreorderForm variants={variants.filter((v) => editing || !rows.some((r) => r.variantId === v.id))} initial={editing} />
        </Section>
      ) : null}
      <Section title="Pre-order variants">
        {rows.length ? (
          <Table className="min-w-[860px]">
            <thead>
              <tr>
                <Th>Piece</Th>
                <Th>Ships</Th>
                <Th className="text-right">Waiting</Th>
                <Th className="text-right">Cap</Th>
                <Th className="text-right">Free stock</Th>
                <Th>Status</Th>
                {canEdit ? <Th className="sr-only">Actions</Th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.variantId}>
                  <Td>
                    <p>{r.variant?.product.name ?? "Removed variant"}</p>
                    <p className="text-xs text-subtle">
                      {r.variant ? `${r.variant.label} · ${r.variant.sku}` : r.variantId}
                      {r.note ? ` · ${r.note}` : ""}
                    </p>
                  </Td>
                  <Td className="whitespace-nowrap text-sm">{fmtDate(r.shipDate)}</Td>
                  <Td className="text-right tabular-nums">{r.sold}</Td>
                  <Td className="text-right tabular-nums text-muted">{r.cap ?? "∞"}</Td>
                  <Td className="text-right tabular-nums text-muted">{r.variant ? Math.max(0, r.variant.stock - r.variant.reserved) : "—"}</Td>
                  <Td>
                    <Badge tone={r.active ? "gold" : "muted"}>{r.active ? "Taking pre-orders" : "Ended"}</Badge>
                  </Td>
                  {canEdit ? (
                    <Td className="text-right">
                      <div className="flex flex-wrap items-center justify-end gap-3">
                        <Link href={`/admin/promotions?tab=preorders&edit=${r.variantId}`} className="text-xs uppercase tracking-[0.18em] text-muted hover:text-gold">
                          Edit
                        </Link>
                        <ReleasePreorderButton variantId={r.variantId} waiting={r.sold} />
                      </div>
                    </Td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No pre-orders. Flag a variant as a pre-order to sell it before stock arrives — orders are held on the fulfilment board until you release them here.</Empty>
        )}
      </Section>
    </>
  );
}
