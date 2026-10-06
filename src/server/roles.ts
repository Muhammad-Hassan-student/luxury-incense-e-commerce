import "server-only";
import { forbidden, redirect } from "next/navigation";
import type { Role } from "@/generated/prisma/client";
import { auth } from "@/auth";

const rank: Record<Role, number> = { CUSTOMER: 0, SUPPORT: 1, MANAGER: 2, OWNER: 3 };

export const hasRole = (role: Role | undefined, min: Role) => rank[role ?? "CUSTOMER"] >= rank[min];

/** Current session user, or redirect to sign-in. */
export async function requireUser(callbackUrl = "/account") {
  const session = await auth();
  if (!session?.user) redirect(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  return session.user;
}

/** Staff gate for admin pages and actions. SUPPORT can read, MANAGER can edit, OWNER can do everything. */
export async function requireRole(min: Role) {
  const user = await requireUser("/admin");
  if (!hasRole(user.role, min)) forbidden();
  return user;
}
