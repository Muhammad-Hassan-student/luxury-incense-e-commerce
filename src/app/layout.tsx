import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Cormorant_Garamond, Inter, Noto_Naskh_Arabic, Noto_Nastaliq_Urdu, Noto_Sans_Devanagari, Noto_Sans_SC } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { LOCALES, localeInfo, type FontKey } from "@/i18n/locales";
import { brand } from "@/config/brand";
import { Providers } from "@/components/providers";
import { getCurrency, getTheme } from "@/server/prefs";
import { clientRegion } from "@/server/region";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

/*
 * Script fonts: only the active locale's font variable is put on <html> (see `scriptFont`), and none of them is
 * preloaded, so a Latin page never downloads Arabic, Nastaliq, Devanagari or CJK files — the browser fetches the
 * active script's files as soon as text in that script is laid out.
 */
const naskh = Noto_Naskh_Arabic({
  variable: "--font-naskh",
  subsets: ["arabic"],
  weight: ["400", "500"],
  display: "swap",
  preload: false,
});

const nastaliq = Noto_Nastaliq_Urdu({
  variable: "--font-nastaliq",
  subsets: ["arabic"],
  weight: ["400", "500"],
  display: "swap",
  preload: false,
});

const devanagari = Noto_Sans_Devanagari({
  variable: "--font-devanagari",
  subsets: ["devanagari"],
  weight: ["300", "400", "500"],
  display: "swap",
  preload: false,
});

const sc = Noto_Sans_SC({
  variable: "--font-sc",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: "swap",
  preload: false,
});

const scriptFont: Record<FontKey, string> = {
  latin: "",
  arabic: naskh.variable,
  nastaliq: nastaliq.variable,
  devanagari: devanagari.variable,
  sc: sc.variable,
};

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/**
 * Localized default title/description. hreflang: there are no locale URL prefixes, so each alternate points at the
 * same path with `?lang=xx` (the proxy serves that language and remembers it); `x-default` is the bare URL, which
 * negotiates from Accept-Language. Pages that set their own `alternates` replace these (none do today).
 */
export async function generateMetadata(): Promise<Metadata> {
  const [t, pathname] = await Promise.all([getTranslations("meta"), headers().then((h) => h.get("x-mo-pathname") ?? "/")]);
  const languages: Record<string, string> = { "x-default": pathname };
  for (const l of LOCALES) languages[l.hreflang] = `${pathname}?lang=${l.code}`;
  return {
    metadataBase: new URL(siteUrl),
    title: { default: t("siteTitle", { brand: brand.name, tagline: t("tagline") }), template: `%s · ${brand.name}` },
    description: t("description"),
    alternates: { languages },
    openGraph: { siteName: brand.name, type: "website", locale: localeInfo(await getLocale()).intl.replace("-", "_") },
    twitter: { card: "summary_large_image" },
    // Installable app (manifest: src/app/manifest.ts, icons: scripts/generate-pwa-icons.mjs).
    icons: { apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }] },
    appleWebApp: { capable: true, title: brand.name, statusBarStyle: "black" },
  };
}

/** Browser / installed-app chrome follows the chosen theme (Nuit or Ivoire); PwaHost keeps it in step on toggle. */
export async function generateViewport(): Promise<Viewport> {
  const theme = await getTheme();
  return { themeColor: theme === "ivoire" ? "#f3ede4" : "#0b0a09" };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, currency, theme, { region, fx }] = await Promise.all([getLocale(), getCurrency(), getTheme(), clientRegion()]);
  const info = localeInfo(locale);
  return (
    <html
      lang={info.code}
      dir={info.dir}
      data-theme={theme}
      data-script={info.font}
      className={`${cormorant.variable} ${inter.variable} ${scriptFont[info.font]}`.trim()}
    >
      <body className="min-h-dvh">
        <NextIntlClientProvider>
          <Providers currency={currency} fx={fx} region={region}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
