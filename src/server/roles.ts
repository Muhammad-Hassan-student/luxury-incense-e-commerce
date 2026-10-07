import "server-only";
import { cache } from "react";
import { forbidden, redirect } from "next/navigation";
import type { Role } from "@/generated/prisma/client";
import { auth } from "@/auth";
import { resolvePermissions, type Permission } from "@/lib/permissions";
import { db } from "./db";

const rank: Record<Role, number> = { CUSTOMER: 0, SUPPORT: 1, MANAGER: 2, OWNER: 3 };

/** Level comparison. Prefer permissions for access decisions; this remains for coarse checks. */
export const hasRole = (role: Role | undefined, min: Role) => rank[role ?? "CUSTOMER"] >= rank[min];

export type StaffUser = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  roleName: string;
  permissions: Permission[];
};

/**
 * Resolves the signed-in user's effective permissions once per request.
 * OWNER → everything; custom staff role → its permissions; otherwise the built-in level's defaults.
 */
export const getAccess = cache(async (): Promise<StaffUser | null> => {
  const session = await auth();
  if (!session?.user) return null;
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true, staffRole: { select: { name: true, permissions: true } } },
  });
  if (!user) return null;
  const roleName =
    user.role === "OWNER" ? "Owner" : user.role === "CUSTOMER" ? "Customer" : (user.staffRole?.name ?? (user.role === "MANAGER" ? "Manager" : "Support"));
  return { id: user.id, email: user.email, name: user.name, role: user.role, roleName, permissions: resolvePermissions(user.role, user.staffRole?.permissions) };
});

/** Current session user, or redirect to sign-in. */
export async function requireUser(callbackUrl = "/account") {
  const session = await auth();
  if (!session?.user) redirect(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  return session.user;
}

/** Any staff access at all (used by the admin shell). */
export async function requireStaff() {
  await requireUser("/admin");
  const access = await getAccess();
  if (!access || access.permissions.length === 0) forbidden();
  // Track activity for the staff page, at most every 5 minutes.
  void db.user
    .updateMany({ where: { id: access.id, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(Date.now() - 5 * 60_000) } }] }, data: { lastSeenAt: new Date() } })
    .catch(() => {});
  return access;
}

/** Gate for admin pages and actions: requires every listed permission. */
export async function requirePermission(...needed: Permission[]) {
  await requireUser("/admin");
  const access = await getAccess();
  if (!access || !needed.every((p) => access.permissions.includes(p))) forbidden();
  return access;
}

/** For pages that several permissions can open (e.g. view OR edit). */
export async function requireAnyPermission(...options: Permission[]) {
  await requireUser("/admin");
  const access = await getAccess();
  if (!access || !options.some((p) => access.permissions.includes(p))) forbidden();
  return access;
}

export const can = (access: { permissions: readonly string[] } | null | undefined, p: Permission) => Boolean(access?.permissions.includes(p));

/** @deprecated Use requirePermission. Kept so older call sites keep working during migration. */
export async function requireRole(min: Role) {
  const user = await requireUser("/admin");
  if (!hasRole(user.role, min)) forbidden();
  return user;
}
