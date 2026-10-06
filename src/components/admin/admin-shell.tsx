"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import {
  ArrowUpRight,
  Boxes,
  FileText,
  LayoutDashboard,
  LayoutGrid,
  Menu,
  MessageSquareQuote,
  Package,
  ScrollText,
  Settings,
  ShoppingBag,
  Ticket,
  Gift,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/generated/prisma/enums";
import { brand } from "@/config/brand";
import { can } from "@/lib/admin-shared";
import { cn } from "@/lib/utils";
import { ADMIN_TOASTER } from "./use-admin-action";

type NavItem = { href: string; label: string; icon: LucideIcon; min: Role };

const NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, min: "SUPPORT" },
  { href: "/admin/orders", label: "Orders", icon: ShoppingBag, min: "SUPPORT" },
  { href: "/admin/products", label: "Products", icon: Package, min: "SUPPORT" },
  { href: "/admin/categories", label: "Categories", icon: LayoutGrid, min: "SUPPORT" },
  { href: "/admin/inventory", label: "Inventory", icon: Boxes, min: "SUPPORT" },
  { href: "/admin/coupons", label: "Coupons", icon: Ticket, min: "SUPPORT" },
  { href: "/admin/gift-cards", label: "Gift cards", icon: Gift, min: "SUPPORT" },
  { href: "/admin/content", label: "Content", icon: FileText, min: "SUPPORT" },
  { href: "/admin/reviews", label: "Reviews", icon: MessageSquareQuote, min: "SUPPORT" },
  { href: "/admin/customers", label: "Customers", icon: Users, min: "SUPPORT" },
  { href: "/admin/settings", label: "Settings", icon: Settings, min: "OWNER" },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText, min: "MANAGER" },
];

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminShell({
  user,
  pendingReviews,
  children,
}: {
  user: { name: string | null; email: string; role: Role };
  pendingReviews: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const items = NAV.filter((i) => can(user.role, i.min));

  const nav = (
    <nav aria-label="Admin" className="flex flex-col gap-px py-4">
      {items.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 border-l-2 px-5 py-2.5 text-[0.75rem] uppercase tracking-[0.18em] transition-colors",
              active ? "border-gold bg-bg-soft text-fg" : "border-transparent text-muted hover:bg-bg-soft/60 hover:text-fg",
            )}
          >
            <Icon className={cn("size-4 shrink-0", active ? "text-gold" : "text-subtle group-hover:text-gold")} aria-hidden strokeWidth={1.5} />
            <span className="flex-1">{label}</span>
            {href === "/admin/reviews" && pendingReviews > 0 ? (
              <span className="min-w-5 border border-gold/40 px-1 text-center text-[0.625rem] tracking-normal text-gold">{pendingReviews}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  const brandMark = (
    <Link href="/admin" className="flex items-baseline gap-3 px-5">
      <span className="font-display text-2xl font-light text-fg">{brand.name}</span>
      <span className="eyebrow">Atelier</span>
    </Link>
  );

  return (
    <div className="min-h-dvh bg-bg text-fg">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-bg-elev lg:flex">
        <div className="flex h-16 items-center border-b border-line">{brandMark}</div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <p className="border-t border-line px-5 py-4 text-[0.625rem] uppercase tracking-[0.2em] text-subtle">Staff only</p>
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Admin navigation">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-bg/80 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="relative flex h-full w-72 max-w-[85vw] flex-col border-r border-line bg-bg-elev">
            <div className="flex h-16 items-center justify-between border-b border-line pr-3">
              {brandMark}
              <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="p-2 text-muted hover:text-fg">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{nav}</div>
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-line bg-bg/90 px-4 backdrop-blur sm:px-6 lg:px-10">
          <button
            type="button"
            className="-ml-2 p-2 text-muted hover:text-fg lg:hidden"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Menu className="size-5" aria-hidden />
          </button>
          <div className="flex-1" />
          <Link href="/" className="hidden items-center gap-2 text-[0.6875rem] uppercase tracking-[0.2em] text-muted transition-colors hover:text-gold sm:inline-flex">
            View store <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
          <div className="flex items-center gap-3 border-l border-line pl-4">
            <div className="text-right leading-tight">
              <p className="max-w-[12rem] truncate text-sm text-fg">{user.name ?? user.email}</p>
              <p className="text-[0.625rem] uppercase tracking-[0.2em] text-gold">{user.role.toLowerCase()}</p>
            </div>
          </div>
        </header>
        <main className="px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          <div className="mx-auto max-w-[1280px]">{children}</div>
        </main>
        <Link href="/" className="mb-8 block px-4 text-center text-[0.6875rem] uppercase tracking-[0.2em] text-muted hover:text-gold sm:hidden">
          View store
        </Link>
      </div>

      <Toaster
        id={ADMIN_TOASTER}
        position="bottom-right"
        toastOptions={{
          unstyled: true,
          classNames: {
            toast: "flex items-center gap-3 border border-line-strong bg-bg-elev px-5 py-4 text-sm text-fg min-w-72",
            error: "!border-ember/50 [&_[data-icon]]:text-ember",
            success: "[&_[data-icon]]:text-gold",
          },
        }}
      />
    </div>
  );
}
