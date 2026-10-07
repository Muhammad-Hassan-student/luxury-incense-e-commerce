"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/trade/portal", label: "Overview" },
  { href: "/trade/portal/order", label: "Quick order" },
  { href: "/trade/portal/catalogue", label: "Catalogue" },
  { href: "/trade/portal/orders", label: "Orders & invoices" },
  { href: "/trade/portal/quotes", label: "Quotes" },
];

export function PortalNav() {
  const pathname = usePathname();
  return (
    <nav className="no-scrollbar -mx-4 flex gap-8 overflow-x-auto border-b border-line px-4 pb-4 sm:mx-0 sm:px-0" aria-label="Trade portal">
      {links.map((l) => {
        const active = l.href === "/trade/portal" ? pathname === l.href : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn("whitespace-nowrap text-[0.6875rem] uppercase tracking-[0.28em] transition-colors", active ? "text-gold" : "text-muted hover:text-fg")}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
