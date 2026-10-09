import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { brand } from "@/config/brand";
import { getCategories } from "@/server/catalog";
import { NewsletterForm } from "./newsletter-form";

export async function SiteFooter() {
  const [t, categories] = await Promise.all([getTranslations("footer"), getCategories()]);
  const cols = [
    { title: t("shop"), links: categories.map((c) => ({ href: `/shop/${c.slug}`, label: c.name })) },
    {
      title: t("house"),
      links: [
        { href: "/about", label: t("about") },
        { href: "/journal", label: "Journal" },
        { href: "/ritual", label: "Find your ritual" },
        { href: "/collections", label: "Collections" },
        { href: "/visit", label: "Visit the atelier" },
        { href: "/trade", label: "Wholesale & trade" },
      ],
    },
    {
      title: t("care"),
      links: [
        { href: "/shipping-returns", label: t("shipping") },
        { href: `mailto:${brand.email}`, label: t("contact") },
        { href: "/account/orders", label: "Track an order" },
        { href: "/privacy", label: t("privacy") },
        { href: "#cookie-preferences", label: "Cookie preferences" },
        { href: "/terms", label: t("terms") },
      ],
    },
  ];

  return (
    <footer className="relative mt-32 border-t border-line">
      <div className="container-luxe grid grid-cols-1 gap-16 py-20 lg:grid-cols-[1.4fr_1fr_1fr_1fr] [&>*]:min-w-0">
        <div className="max-w-sm">
          <p className="font-display text-4xl leading-none">{t("newsletter")}</p>
          <p className="mt-4 text-sm text-muted">New batches, rituals and private sales. Twice a month, never more.</p>
          <NewsletterForm placeholder={t("emailPlaceholder")} cta={t("subscribe")} />
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <p className="eyebrow mb-6">{c.title}</p>
            <ul className="space-y-3">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="link-draw text-sm text-muted transition-colors hover:text-fg">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="overflow-hidden border-t border-line">
        <p className="display select-none whitespace-nowrap py-6 text-center text-[17vw] leading-none text-fg/[0.04]" aria-hidden>
          {brand.name}
        </p>
      </div>
      <div className="container-luxe flex flex-col items-center justify-between gap-4 border-t border-line py-6 text-xs text-subtle md:flex-row">
        <p>
          © {new Date().getFullYear()} {brand.name}. {t("rights")}
        </p>
        <div className="flex items-center gap-6">
          <a href={brand.instagram} target="_blank" rel="noreferrer" className="hover:text-fg" aria-label="Instagram">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="17.5" cy="6.5" r="0.8" fill="currentColor" />
            </svg>
          </a>
          <a href={`https://wa.me/${brand.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="hover:text-fg">
            WhatsApp concierge
          </a>
        </div>
      </div>
    </footer>
  );
}
