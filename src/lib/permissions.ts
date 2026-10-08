// Permission catalogue — client-safe (no server imports) so UIs can show/hide controls.
// Servers must still check with requirePermission() from @/server/roles.

export const PERMISSION_GROUPS = [
  {
    group: "Overview",
    items: [
      { key: "dashboard.view", label: "View dashboard", hint: "Revenue, KPIs and alerts" },
      { key: "reports.view", label: "View sales reports & analytics", hint: "Revenue, margins, products, customers, trade" },
      { key: "audit.view", label: "View audit log" },
    ],
  },
  {
    group: "Orders",
    items: [
      { key: "orders.view", label: "View orders" },
      { key: "orders.fulfil", label: "Fulfil orders", hint: "Pack, ship, deliver, edit notes" },
      { key: "orders.cancel", label: "Cancel unpaid orders" },
      { key: "orders.refund", label: "Refund & cancel paid orders" },
      { key: "orders.export", label: "Export orders (CSV)" },
      { key: "returns.manage", label: "Handle returns & exchanges", hint: "Approve, receive, inspect and refund returns" },
    ],
  },
  {
    group: "Catalog",
    items: [
      { key: "catalog.view", label: "View products & categories" },
      { key: "catalog.edit", label: "Edit products, categories & media" },
    ],
  },
  {
    group: "Inventory",
    items: [
      { key: "inventory.view", label: "View stock levels & movements" },
      { key: "inventory.adjust", label: "Adjust stock, costs & reorder points" },
      { key: "purchasing.manage", label: "Suppliers & purchase orders", hint: "Create, send and receive POs" },
      { key: "stocktake.manage", label: "Run stocktakes" },
    ],
  },
  {
    group: "Marketing",
    items: [
      { key: "promotions.view", label: "View coupons & gift cards" },
      { key: "promotions.manage", label: "Manage coupons & gift cards" },
      { key: "content.view", label: "View homepage content" },
      { key: "content.edit", label: "Edit homepage content" },
      { key: "reviews.view", label: "View reviews" },
      { key: "reviews.moderate", label: "Approve & delete reviews" },
      { key: "automations.manage", label: "Customer journeys (automated emails)", hint: "Turn flows on/off, edit timing and offers" },
    ],
  },
  {
    group: "Trade & visits",
    items: [
      { key: "trade.view", label: "View trade accounts & quotes" },
      { key: "trade.manage", label: "Approve trade accounts, set tiers & terms, quote", hint: "Includes marking trade invoices paid" },
      { key: "visits.manage", label: "Manage atelier visits", hint: "Confirm, reschedule and check visitors in" },
    ],
  },
  {
    group: "People & settings",
    items: [
      { key: "customers.view", label: "View customers" },
      { key: "staff.manage", label: "Manage staff & roles", hint: "Can only grant permissions they hold" },
      { key: "settings.manage", label: "Store settings, flags & shipping" },
    ],
  },
] as const;

export type Permission = (typeof PERMISSION_GROUPS)[number]["items"][number]["key"];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));

export const isPermission = (v: string): v is Permission => (ALL_PERMISSIONS as string[]).includes(v);

type BuiltIn = "SUPPORT" | "MANAGER" | "OWNER";

/** Defaults for the built-in levels when a user has no custom role. */
export const BUILT_IN_PERMISSIONS: Record<BuiltIn, Permission[]> = {
  SUPPORT: [
    "dashboard.view",
    "orders.view",
    "orders.fulfil",
    "orders.cancel",
    "catalog.view",
    "inventory.view",
    "promotions.view",
    "content.view",
    "reviews.view",
    "customers.view",
    "trade.view",
    "visits.manage",
    "returns.manage",
  ],
  MANAGER: ALL_PERMISSIONS.filter((p) => p !== "staff.manage" && p !== "settings.manage"),
  OWNER: ALL_PERMISSIONS,
};

export const BUILT_IN_LABEL: Record<BuiltIn, { name: string; description: string }> = {
  OWNER: { name: "Owner", description: "Everything, including staff, roles and store settings." },
  MANAGER: { name: "Manager", description: "Runs the shop day to day: catalog, stock, purchasing, refunds, promotions." },
  SUPPORT: { name: "Support", description: "Customer care and fulfilment; read-only elsewhere." },
};

/** Editing an area implies being able to see it. */
const IMPLIES: Partial<Record<Permission, Permission[]>> = {
  "orders.fulfil": ["orders.view"],
  "orders.cancel": ["orders.view"],
  "orders.refund": ["orders.view", "orders.cancel"],
  "orders.export": ["orders.view"],
  "returns.manage": ["orders.view"],
  "catalog.edit": ["catalog.view"],
  "inventory.adjust": ["inventory.view"],
  "purchasing.manage": ["inventory.view"],
  "stocktake.manage": ["inventory.view"],
  "promotions.manage": ["promotions.view"],
  "content.edit": ["content.view"],
  "reviews.moderate": ["reviews.view"],
  "trade.manage": ["trade.view"],
};

export function expand(perms: Iterable<string>): Set<Permission> {
  const out = new Set<Permission>();
  for (const p of perms) {
    if (!isPermission(p)) continue;
    out.add(p);
    for (const q of IMPLIES[p] ?? []) out.add(q);
  }
  return out;
}

export const canDo = (perms: readonly string[] | Set<string>, p: Permission) => (perms instanceof Set ? perms.has(p) : perms.includes(p));

/** Effective permissions for a user: OWNER gets all; customers none; staff get their custom role, else their level's defaults. */
export function resolvePermissions(role: "CUSTOMER" | BuiltIn, customRolePermissions: string[] | null | undefined): Permission[] {
  if (role === "OWNER") return [...expand(BUILT_IN_PERMISSIONS.OWNER)];
  if (role === "CUSTOMER") return [];
  return [...expand(customRolePermissions ?? BUILT_IN_PERMISSIONS[role])];
}

/** Where to land staff who can't see the dashboard: the first area they can use. */
export const LANDING_ORDER: [Permission, string][] = [
  ["dashboard.view", "/admin"],
  ["orders.view", "/admin/orders"],
  ["inventory.view", "/admin/inventory"],
  ["catalog.view", "/admin/products"],
  ["customers.view", "/admin/customers"],
  ["promotions.view", "/admin/coupons"],
  ["content.view", "/admin/content"],
  ["reviews.view", "/admin/reviews"],
  ["trade.view", "/admin/trade"],
  ["visits.manage", "/admin/visits"],
  ["staff.manage", "/admin/staff"],
  ["settings.manage", "/admin/settings"],
  ["reports.view", "/admin/reports"],
  ["returns.manage", "/admin/returns"],
  ["automations.manage", "/admin/automations"],
  ["audit.view", "/admin/audit"],
];
