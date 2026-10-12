"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const links = [
  { href: "/trade/portal", key: "overview" },
  { href: "/trade/portal/order", key: "quickOrder" },
  { href: "/trade/portal/catalogue", key: "catalogue" },
  { href: "/trade/portal/orders", key: "orders" },
  { href: "/trade/portal/quotes", key: "quotes" },
] as const;

export function PortalNav() {
  const pathname = usePathname();
  const t = useTranslations("tradePortal.nav");
  return (
    <nav className="no-scrollbar -mx-4 flex gap-8 overflow-x-auto border-b border-line px-4 pb-4 sm:mx-0 sm:px-0" aria-label={t("label")}>
      {links.map((l) => {
        const active = l.href === "/trade/portal" ? pathname === l.href : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn("whitespace-nowrap text-[0.6875rem] uppercase tracking-[0.28em] transition-colors", active ? "text-gold" : "text-muted hover:text-fg")}
          >
            {t(l.key)}
          </Link>
        );
      })}
    </nav>
  );
}
