"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/account", label: "Overview" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account/addresses", label: "Addresses" },
  { href: "/account/wishlist", label: "Wishlist" },
  { href: "/account/security", label: "Sign-in security" },
];

export function AccountNav() {
  const pathname = usePathname();
  return (
    <nav className="no-scrollbar flex gap-6 overflow-x-auto border-b border-line pb-4 lg:flex-col lg:gap-4 lg:border-b-0 lg:border-e lg:pb-0" aria-label="Account">
      {links.map((l) => {
        const active = l.href === "/account" ? pathname === "/account" : pathname.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={cn("whitespace-nowrap text-[0.6875rem] uppercase tracking-[0.28em] transition-colors", active ? "text-gold" : "text-muted hover:text-fg")}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
