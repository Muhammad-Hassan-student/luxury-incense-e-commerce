import { SiteHeader } from "@/components/nav/site-header";
import { SiteFooter } from "@/components/nav/site-footer";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { SearchPalette } from "@/components/nav/search-palette";
import { IntroLoader } from "@/components/loader/intro-loader";
import { EmberCursor } from "@/components/loader/ember-cursor";
import { getCategories } from "@/server/catalog";
import { getFlags } from "@/server/settings";

// Every storefront page reads the cart/session cookies.
export const dynamic = "force-dynamic";

export default async function StoreLayout({ children }: LayoutProps<"/">) {
  const [flags, categories] = await Promise.all([getFlags(), getCategories()]);
  return (
    <>
      <IntroLoader enabled={flags.loader ?? true} />
      <EmberCursor enabled={flags["custom-cursor"] ?? true} />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[400] focus:bg-gold focus:px-4 focus:py-2 focus:text-bg">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="relative">
        {children}
      </main>
      <SiteFooter />
      <CartDrawer />
      <SearchPalette categories={categories.map(({ slug, name, tagline }) => ({ slug, name, tagline }))} />
    </>
  );
}
