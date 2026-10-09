"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import {
  ArrowUpRight,
  BarChart3,
  Boxes,
  Briefcase,
  CalendarCheck,
  FileSignature,
  ClipboardCheck,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  Truck,
  Factory,
  FileText,
  LayoutDashboard,
  LayoutGrid,
  Menu,
  MessageSquareQuote,
  Package,
  PackageCheck,
  Plug,
  Repeat,
  ScrollText,
  Settings,
  ShoppingBag,
  Ticket,
  Gift,
  Undo2,
  Users,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { brand } from "@/config/brand";
import type { Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { ADMIN_TOASTER } from "./use-admin-action";

/** A link shows when the user holds any of `perms`. */
type NavItem = { href: string; label: string; icon: LucideIcon; perms: Permission[] };

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Shop",
    items: [
      { href: "/admin", label: "Dashboard", icon: LayoutDashboard, perms: ["dashboard.view"] },
      { href: "/admin/orders", label: "Orders", icon: ShoppingBag, perms: ["orders.view"] },
      { href: "/admin/fulfilment", label: "Fulfilment", icon: PackageCheck, perms: ["orders.fulfil"] },
      { href: "/admin/returns", label: "Returns", icon: Undo2, perms: ["returns.manage"] },
      { href: "/admin/risk", label: "COD & risk", icon: ShieldAlert, perms: ["orders.view"] },
      { href: "/admin/subscriptions", label: "Subscriptions", icon: Repeat, perms: ["subscriptions.manage"] },
      { href: "/admin/reports", label: "Reports", icon: BarChart3, perms: ["reports.view"] },
      { href: "/admin/customers", label: "Customers", icon: Users, perms: ["customers.view"] },
      { href: "/admin/products", label: "Products", icon: Package, perms: ["catalog.view"] },
      { href: "/admin/categories", label: "Categories", icon: LayoutGrid, perms: ["catalog.view"] },
    ],
  },
  {
    section: "Inventory",
    items: [
      { href: "/admin/inventory", label: "Stock", icon: Boxes, perms: ["inventory.view"] },
      {
        href: "/admin/purchasing",
        label: "Purchase orders",
        icon: Truck,
        perms: ["purchasing.manage"],
      },
      { href: "/admin/suppliers", label: "Suppliers", icon: Factory, perms: ["purchasing.manage"] },
      {
        href: "/admin/stocktakes",
        label: "Stocktakes",
        icon: ClipboardCheck,
        perms: ["stocktake.manage"],
      },
    ],
  },
  {
    section: "Trade",
    items: [
      { href: "/admin/trade", label: "Trade accounts", icon: Briefcase, perms: ["trade.view"] },
      { href: "/admin/trade/quotes", label: "Quotes", icon: FileSignature, perms: ["trade.view"] },
      { href: "/admin/visits", label: "Visits", icon: CalendarCheck, perms: ["visits.manage"] },
    ],
  },
  {
    section: "Marketing",
    items: [
      { href: "/admin/automations", label: "Journeys", icon: Workflow, perms: ["automations.manage"] },
      { href: "/admin/coupons", label: "Coupons", icon: Ticket, perms: ["promotions.view"] },
      { href: "/admin/gift-cards", label: "Gift cards", icon: Gift, perms: ["promotions.view"] },
      { href: "/admin/content", label: "Content", icon: FileText, perms: ["content.view"] },
      {
        href: "/admin/reviews",
        label: "Reviews",
        icon: MessageSquareQuote,
        perms: ["reviews.view"],
      },
    ],
  },
  {
    section: "Admin",
    items: [
      { href: "/admin/security", label: "Security lock", icon: ShieldCheck, perms: [] },
      { href: "/admin/staff", label: "Staff", icon: ShieldCheck, perms: ["staff.manage"] },
      { href: "/admin/roles", label: "Roles", icon: KeyRound, perms: ["staff.manage"] },
      { href: "/admin/settings", label: "Settings", icon: Settings, perms: ["settings.manage"] },
      { href: "/admin/integrations", label: "Integrations", icon: Plug, perms: ["settings.manage"] },
      { href: "/admin/audit", label: "Audit log", icon: ScrollText, perms: ["audit.view"] },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === "/admin"
    ? pathname === "/admin"
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminShell({
  user,
  pendingReviews,
  children,
}: {
  user: { name: string | null; email: string; roleName: string; permissions: Permission[] };
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

  const sections = NAV.map((s) => ({
    ...s,
    items: s.items.filter((i) => i.perms.length === 0 || i.perms.some((p) => user.permissions.includes(p))),
  })).filter((s) => s.items.length);

  const nav = (
    <nav aria-label="Admin" className="flex flex-col py-4">
      {sections.map((s) => (
        <div key={s.section} className="mb-3 flex flex-col gap-px">
          <p className="text-subtle px-5 pt-2 pb-1 text-[0.5625rem] tracking-[0.3em] uppercase">
            {s.section}
          </p>
          {s.items.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 border-l-2 px-5 py-2.5 text-[0.75rem] tracking-[0.18em] uppercase transition-colors",
                  active
                    ? "border-gold bg-bg-soft text-fg"
                    : "text-muted hover:bg-bg-soft/60 hover:text-fg border-transparent",
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    active ? "text-gold" : "text-subtle group-hover:text-gold",
                  )}
                  aria-hidden
                  strokeWidth={1.5}
                />
                <span className="flex-1">{label}</span>
                {href === "/admin/reviews" && pendingReviews > 0 ? (
                  <span className="border-gold/40 text-gold min-w-5 border px-1 text-center text-[0.625rem] tracking-normal">
                    {pendingReviews}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const brandMark = (
    <Link href="/admin" className="flex items-baseline gap-3 px-5">
      <span className="font-display text-fg text-2xl font-light">{brand.name}</span>
      <span className="eyebrow">Atelier</span>
    </Link>
  );

  return (
    <div className="bg-bg text-fg min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="border-line bg-bg-elev fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r lg:flex">
        <div className="border-line flex h-16 items-center border-b">{brandMark}</div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <p className="border-line text-subtle border-t px-5 py-4 text-[0.625rem] tracking-[0.2em] uppercase">
          Staff only
        </p>
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Admin navigation"
        >
          <button
            type="button"
            aria-label="Close menu"
            className="bg-bg/80 absolute inset-0 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside className="border-line bg-bg-elev relative flex h-full w-72 max-w-[85vw] flex-col border-r">
            <div className="border-line flex h-16 items-center justify-between border-b pr-3">
              {brandMark}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="text-muted hover:text-fg p-2"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{nav}</div>
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-60">
        <header className="border-line bg-bg/90 sticky top-0 z-20 flex h-16 items-center gap-4 border-b px-4 backdrop-blur sm:px-6 lg:px-10">
          <button
            type="button"
            className="text-muted hover:text-fg -ml-2 p-2 lg:hidden"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Menu className="size-5" aria-hidden />
          </button>
          <div className="flex-1" />
          <Link
            href="/account/security"
            className="text-gold inline-flex shrink-0 items-center gap-2 text-[0.6875rem] tracking-[0.12em] uppercase transition-colors hover:text-fg"
          >
            <ShieldCheck className="size-4" aria-hidden />
            <span>Security lock</span>
          </Link>
          <Link
            href="/"
            className="text-muted hover:text-gold hidden items-center gap-2 text-[0.6875rem] tracking-[0.2em] uppercase transition-colors sm:inline-flex"
          >
            View store <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
          <div className="border-line flex items-center gap-3 border-l pl-4">
            <div className="text-right leading-tight">
              <p className="text-fg max-w-[8rem] truncate text-sm sm:max-w-[12rem]">{user.name ?? user.email}</p>
              <p className="text-gold text-[0.625rem] tracking-[0.2em] uppercase">
                {user.roleName}
              </p>
            </div>
          </div>
        </header>
        <main className="px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          <div className="mx-auto max-w-[1280px]">{children}</div>
        </main>
        <Link
          href="/"
          className="text-muted hover:text-gold mb-8 block px-4 text-center text-[0.6875rem] tracking-[0.2em] uppercase sm:hidden"
        >
          View store
        </Link>
      </div>

      <Toaster
        id={ADMIN_TOASTER}
        position="bottom-right"
        toastOptions={{
          unstyled: true,
          classNames: {
            toast:
              "flex items-center gap-3 border border-line-strong bg-bg-elev px-5 py-4 text-sm text-fg min-w-72",
            error: "!border-ember/50 [&_[data-icon]]:text-ember",
            success: "[&_[data-icon]]:text-gold",
          },
        }}
      />
    </div>
  );
}
