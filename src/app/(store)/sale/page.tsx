import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { db } from "@/server/db";
import { brand } from "@/config/brand";
import { productCardSelect } from "@/server/catalog";
import { localizeProducts } from "@/server/translations/localize";
import { saleProductWhere } from "@/server/promotions";
import { MaskedHeading, Reveal } from "@/components/motion/reveal";
import { ProductGrid } from "@/components/product/product-grid";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("saleTitle"), description: t("saleDescription", { brand: brand.name }) };
}

/** The "Sale" collection: every product on a live flash sale (prices and countdowns come from the promo context). */
export default async function SalePage() {
  const t = await getTranslations("promo");
  const where = await saleProductWhere();
  const products = where ? await localizeProducts(await db.product.findMany({ where, select: productCardSelect, orderBy: [{ isBestseller: "desc" }, { name: "asc" }] })) : [];
  return (
    <div className="container-luxe pt-20" data-sale-page>
      <p className="eyebrow mb-6 text-ember">{t("saleEyebrow")}</p>
      <MaskedHeading as="h1" text={t("saleTitle")} className="text-6xl md:text-9xl" />
      <Reveal delay={0.1}>
        <p className="mb-20 mt-6 max-w-lg text-muted">{t("saleIntro")}</p>
      </Reveal>
      <ProductGrid products={products} empty={t("saleEmpty")} />
    </div>
  );
}
