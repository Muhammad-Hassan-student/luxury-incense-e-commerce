import { getLocale } from "next-intl/server";
import { auth } from "@/auth";
import { getCategories } from "@/server/catalog";
import { cartCount } from "@/server/cart";
import { getSettings } from "@/server/settings";
import { HeaderClient } from "./header-client";

export async function SiteHeader() {
  const [categories, count, session, locale, settings] = await Promise.all([
    getCategories(),
    cartCount(),
    auth(),
    getLocale(),
    getSettings(),
  ]);
  return (
    <HeaderClient
      categories={categories.map(({ slug, name, tagline }) => ({ slug, name, tagline }))}
      count={count}
      signedIn={Boolean(session?.user)}
      locale={locale}
      announcement={settings.announcement}
    />
  );
}
