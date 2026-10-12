import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { SiteHeader } from "@/components/nav/site-header";
import { SiteFooter } from "@/components/nav/site-footer";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { SearchPalette } from "@/components/nav/search-palette";
import { BackToTop } from "@/components/nav/back-to-top";
import { OffscreenPause } from "@/components/motion/offscreen-pause";
import { QuickViewHost } from "@/components/product/quick-view";
import { StoreConfigProvider } from "@/components/store-config";
import { IntroLoader } from "@/components/loader/intro-loader";
import { EmberCursor } from "@/components/loader/ember-cursor";
import { getCategories } from "@/server/catalog";
import { getFlags, getSettings } from "@/server/settings";
import { getIntegration } from "@/server/integrations";
import { Analytics } from "@/components/analytics/analytics";
import { PwaHost } from "@/components/pwa/pwa-host";
import { Concierge } from "@/components/concierge/concierge";
import { PromoProvider } from "@/components/promo/promo-context";
import { AffiliateBeacon } from "@/components/promo/affiliate-beacon";
import { storefrontPromos } from "@/server/promotions";

// Every storefront page reads the cart/session cookies.
export const dynamic = "force-dynamic";

export default async function StoreLayout({ children }: LayoutProps<"/">) {
  const [flags, categories, settings, t, pixels] = await Promise.all([getFlags(), getCategories(), getSettings(), getTranslations("nav"), getIntegration("pixels")]);
  // Flash sales + pre-orders for cards, quick view and product pages (display only; checkout re-prices server-side).
  const promos = await storefrontPromos();
  // Only public tag ids reach the browser; nothing loads until the shopper accepts cookies.
  const tracking = pixels.enabled && (pixels.ga4MeasurementId || pixels.metaPixelId) ? { ga4MeasurementId: pixels.ga4MeasurementId, metaPixelId: pixels.metaPixelId } : null;
  return (
    <StoreConfigProvider value={{ lowStock: settings.lowStockThreshold }}>
      <PromoProvider value={promos}>
      <IntroLoader enabled={flags.loader ?? true} />
      <EmberCursor enabled={flags["custom-cursor"] ?? true} />
      <a href="#main" className="sr-only left-0 top-0 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[400] focus:bg-gold focus:px-4 focus:py-2 focus:text-bg">
        {t("skip")}
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="relative outline-none">
        {children}
      </main>
      <SiteFooter />
      <CartDrawer />
      <SearchPalette categories={categories.map(({ slug, name, tagline }) => ({ slug, name, tagline }))} />
      <Suspense>
        <QuickViewHost />
      </Suspense>
      <BackToTop />
      <OffscreenPause />
      <PwaHost />
      <Concierge />
      {tracking && <Analytics config={tracking} />}
      <Suspense>
        <AffiliateBeacon />
      </Suspense>
      </PromoProvider>
    </StoreConfigProvider>
  );
}
