import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter, Noto_Naskh_Arabic } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { brand } from "@/config/brand";
import { Providers } from "@/components/providers";
import { getCurrency, getTheme } from "@/server/prefs";
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

const naskh = Noto_Naskh_Arabic({
  variable: "--font-naskh",
  subsets: ["arabic"],
  weight: ["400", "500"],
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: `${brand.name} — ${brand.tagline}`, template: `%s · ${brand.name}` },
  description: brand.description,
  openGraph: { siteName: brand.name, type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0a09" },
    { media: "(prefers-color-scheme: light)", color: "#f3ede4" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, currency, theme] = await Promise.all([getLocale(), getCurrency(), getTheme()]);
  return (
    <html
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      data-theme={theme}
      className={`${cormorant.variable} ${inter.variable} ${naskh.variable}`}
    >
      <body className="min-h-dvh">
        <NextIntlClientProvider>
          <Providers currency={currency}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
