"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/account", label: "Overview" },
  { href: "/account/security", label: "Security lock" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account/addresses", label: "Addresses" },
  { href: "/account/wishlist", label: "Wishlist" },
];

export function AccountNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-x-6 gap-y-4 border-b border-line pb-4 lg:flex-col lg:gap-4 lg:border-b-0 lg:border-e lg:pb-0" aria-label="Account">
      {links.map((l) => {
        const active = l.href === "/account" ? pathname === "/account" : pathname.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined} className={cn("inline-flex items-center gap-2 whitespace-nowrap text-[0.6875rem] uppercase tracking-[0.28em] transition-colors", active ? "text-gold" : "text-muted hover:text-fg")}>
            {l.href === "/account/security" && <ShieldCheck className="size-4 shrink-0" aria-hidden />}
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
