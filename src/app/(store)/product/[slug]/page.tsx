import type { Metadata } from "next";
import Link from "next/link";
import { ViewTransition } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { available, getProduct, relatedProducts } from "@/server/catalog";
import { getFlags, getSettings } from "@/server/settings";
import { pairsWith } from "@/server/recommendations";
import { getSubscriptionSettings } from "@/server/subscriptions";
import { brand } from "@/config/brand";
import { ProductGallery } from "@/components/product/product-gallery";
import { ProductBuy } from "@/components/product/product-buy";
import { Accordion } from "@/components/product/accordion";
import { Reviews, Stars } from "@/components/product/reviews";
import { ProductGrid } from "@/components/product/product-grid";
import { RecentlyViewed } from "@/components/product/recently-viewed";
import { ScentProfile } from "@/components/product/scent-profile";
import { DeliveryEstimate } from "@/components/product/delivery-estimate";
import { MaskedHeading, Reveal } from "@/components/motion/reveal";
import type { Model3D } from "@/generated/prisma/enums";
import { needsConfiguration, productHref } from "@/lib/product-href";

const rituals: Record<Model3D, string> = {
  INCENSE: "Light the tip and let it flame for a few seconds, then blow it out gently so it glows. Rest it in a holder away from drafts and fabric. One stick scents a medium room.",
  DHOOP: "Light the tip of the cone until it glows, then blow out the flame. Place it on a heat-safe dish. Dhoop burns denser than incense — one cone is plenty for a cleanse.",
  CANDLE: "On the first burn, let the wax melt to the edges (about 2–3 hours) to avoid tunnelling. Trim the wick to 5 mm before each lighting. Never burn for more than 4 hours at a time.",
  OIL: "Warm a single drop between your wrists and press to pulse points, or touch to the collar of a coat. Attars develop slowly on skin over several hours.",
  BAKHOOR: "Light a charcoal disc until it’s covered in white ash. Place one or two pieces of bakhoor on top, then walk the burner through each room and let guests waft the smoke into sleeves and hair.",
  CARD: "Delivered by email with your message, usually within minutes of payment. Redeemable on anything in the house for a year; any unused balance stays on the card.",
  COIL: "Hang the coil from its hook or rest it on the stand, light the outer tip until it glows, then blow out the flame. A coil smoulders slowly for hours — keep it clear of curtains and let it scent a large room.",
  PERFUME: "Spray once or twice from a hand’s length onto pulse points — wrists, throat, behind the ears. Don’t rub: let the top notes open on their own and the base settle over the hours.",
  OUD: "Warm a sliver of oud on a mabkhara over a lit charcoal disc or an electric burner. Let the resin melt slowly — never let it flame — and walk the smoke through the room, clothes and hair.",
  GIFTBOX: "Arrives wrapped in handmade paper with a hand-written note. Add a delivery date at checkout to time it perfectly.",
};

export async function generateMetadata(props: PageProps<"/product/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const p = await getProduct(slug);
  if (!p) return {};
  const cover = p.images.find((m) => m.type === "IMAGE")?.url ?? p.images.find((m) => m.poster)?.poster;
  return {
    title: p.name,
    description: `${p.subtitle}. ${p.story}`.slice(0, 160),
    openGraph: { title: p.name, description: p.subtitle, ...(cover && { images: [{ url: cover }] }) },
  };
}

export default async function ProductPage(props: PageProps<"/product/[slug]">) {
  const { slug } = await props.params;
  const product = await getProduct(slug);
  if (!product) notFound();
  if (needsConfiguration(product.slug)) redirect(productHref(product.slug));

  const [session, flags, settings, relatedAll, pairs, rates, subs] = await Promise.all([
    auth(),
    getFlags(),
    getSettings(),
    relatedProducts(product.id, product.categoryId, product.family),
    pairsWith(product.id),
    db.shippingRate.findMany({ orderBy: { position: "asc" }, select: { name: true, countries: true, etaDays: true } }),
    getSubscriptionSettings(),
  ]);
  // Subscribe & Save for everyday pieces (not gift cards or coffrets).
  const subscribe = subs.enabled && !product.isGiftCard && product.model !== "GIFTBOX" && product.model !== "CARD" ? { discountPercent: subs.discountPercent } : null;
  // Never show the same piece twice: pairings win over the generic related row.
  const related = relatedAll.filter((p) => !pairs.some((x) => x.id === p.id));
  const wishlisted = session?.user ? Boolean(await db.wishlistItem.findUnique({ where: { userId_productId: { userId: session.user.id, productId: product.id } } })) : false;

  const variants = product.variants.map((v) => ({ id: v.id, label: v.label, price: v.price, compareAtPrice: v.compareAtPrice, available: available(v) }));
  const inStock = variants.some((v) => v.available > 0);
  const photo = product.images.find((m) => m.type === "IMAGE");
  const visual = {
    model: product.model,
    palette: product.palette,
    image: photo ? (photo.cutoutUrl && photo.display !== "PHOTO" ? { src: photo.cutoutUrl, cutout: true } : { src: photo.url, cutout: false }) : null,
  };
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.story,
    sku: product.variants[0]?.sku,
    brand: { "@type": "Brand", name: brand.name },
    category: product.category.name,
    ...(product.images.length > 0 && {
      image: product.images.filter((m) => m.type === "IMAGE").map((m) => new URL(m.url, process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").toString()),
    }),
    ...(product.ratingCount > 0 && { aggregateRating: { "@type": "AggregateRating", ratingValue: product.ratingAvg, reviewCount: product.ratingCount } }),
    offers: product.variants.map((v) => ({
      "@type": "Offer",
      sku: v.sku,
      price: (v.price / 100).toFixed(2),
      priceCurrency: brand.baseCurrency,
      availability: available(v) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="container-luxe grid gap-12 pt-8 lg:grid-cols-[7fr_5fr] lg:gap-20 [&>*]:min-w-0">
        <div className="lg:sticky lg:top-24 lg:h-[calc(100svh-10rem)]">
          <div className="relative h-[70svh] w-full lg:h-full">
            <ProductGallery slug={product.slug} name={product.name} model={product.model} palette={product.palette} media={product.images} threeD={flags["three-d"] ?? true} />
          </div>
        </div>

        {/* Arriving from the skeleton, the details settle in softly (the gallery morphs on its own). */}
        <ViewTransition enter="reveal-enter" default="none">
        <div className="pb-16 lg:pt-12">
          <nav className="mb-8 text-xs text-subtle" aria-label="Breadcrumb">
            <Link href="/shop" className="hover:text-fg">Shop</Link>
            <span className="mx-2">/</span>
            <Link href={`/shop/${product.category.slug}`} className="hover:text-fg">{product.category.name}</Link>
          </nav>
          <MaskedHeading as="h1" text={product.name} className="text-6xl md:text-7xl" />
          <Reveal delay={0.1}>
            <p className="mt-4 font-display text-xl italic text-muted">{product.subtitle}</p>
            {product.ratingCount > 0 && (
              <a href="#reviews" className="mt-4 flex items-center gap-2 text-xs text-muted">
                <Stars value={product.ratingAvg} /> {product.ratingAvg.toFixed(1)} · {product.ratingCount} reviews
              </a>
            )}
          </Reveal>
          <Reveal delay={0.2} className="mt-10">
            <ProductBuy productId={product.id} name={product.name} variants={variants} wishlisted={wishlisted} signedIn={Boolean(session?.user)} lowStock={settings.lowStockThreshold} visual={visual} subscribe={subscribe} />
            {inStock && <DeliveryEstimate rates={rates} />}
          </Reveal>

          <ScentProfile top={product.topNotes} heart={product.heartNotes} base={product.baseNotes} intensity={product.intensity} burnTime={product.burnTime} origin={product.origin} />

          <div className="mt-10">
            <Accordion
              defaultOpen="story"
              items={[
                { id: "story", title: "The story", content: <p>{product.story}</p> },
                { id: "ritual", title: "The ritual", content: <p>{rituals[product.model]}</p> },
                {
                  id: "shipping",
                  title: "Shipping & returns",
                  content: (
                    <p>
                      Wrapped by hand and dispatched within two working days. Complimentary shipping across India over ₹2,500. Unopened pieces can be returned within 14 days —{" "}
                      <Link href="/shipping-returns" className="link-draw text-fg">details</Link>.
                    </p>
                  ),
                },
              ]}
            />
          </div>
          {!inStock && <p className="mt-6 text-xs text-ember">Currently sold out — new batches arrive every few weeks.</p>}
        </div>
        </ViewTransition>
      </div>

      {pairs.length > 0 && (
        <section className="container-luxe border-t border-line pt-24 pb-8" aria-label="Pairs beautifully with">
          <p className="eyebrow mb-4">Complete the ritual</p>
          <MaskedHeading text="Pairs beautifully with" className="mb-14 text-5xl md:text-6xl" />
          <ProductGrid products={pairs} />
        </section>
      )}

      {(flags.reviews ?? true) && (
        <div id="reviews" className="container-luxe scroll-mt-32 border-t border-line pt-24">
          <Reviews
            productId={product.id}
            avg={product.ratingAvg}
            count={product.ratingCount}
            signedIn={Boolean(session?.user)}
            reviews={product.reviews.map((r) => ({
              id: r.id,
              rating: r.rating,
              title: r.title,
              body: r.body,
              verified: r.verified,
              author: r.user.name?.split(" ")[0] ?? "A customer",
              date: r.createdAt.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
            }))}
          />
        </div>
      )}

      {related.length > 0 && (
        <section className="container-luxe pt-32">
          <MaskedHeading text="You may also love" className="mb-14 text-5xl md:text-6xl" />
          <ProductGrid products={related} />
        </section>
      )}

      <RecentlyViewed current={product.slug} />
    </>
  );
}
