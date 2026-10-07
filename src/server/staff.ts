import "server-only";
import type { Role } from "@/generated/prisma/client";
import { BUILT_IN_PERMISSIONS, expand, isPermission, resolvePermissions, type Permission } from "@/lib/permissions";
import { db } from "./db";
import type { StaffUser } from "./roles";

/** What a person can be given: nothing, a built-in level, or a custom role. */
export type AccessChoice = { kind: "none" } | { kind: "builtin"; role: Exclude<Role, "CUSTOMER"> } | { kind: "custom"; staffRoleId: string };

export class StaffError extends Error {}

async function permissionsOf(choice: AccessChoice): Promise<Set<Permission>> {
  if (choice.kind === "none") return new Set();
  if (choice.kind === "builtin") return expand(BUILT_IN_PERMISSIONS[choice.role]);
  const role = await db.staffRole.findUnique({ where: { id: choice.staffRoleId }, select: { permissions: true } });
  if (!role) throw new StaffError("That role no longer exists.");
  return expand(role.permissions);
}

async function currentPermissions(user: { role: Role; staffRole: { permissions: string[] } | null }) {
  return new Set(resolvePermissions(user.role, user.staffRole?.permissions));
}

const subset = (a: Set<Permission>, b: Set<Permission>) => [...a].every((p) => b.has(p));

/**
 * Changes someone's staff access with escalation guards:
 * nobody edits their own access; only owners create or remove owners; non-owners can only
 * grant (and only touch people whose access is) within their own permissions; the last owner stays.
 */
export async function assignAccess(actor: StaffUser, userId: string, choice: AccessChoice) {
  if (userId === actor.id) throw new StaffError("You can’t change your own access.");
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true, staffRole: { select: { permissions: true } } } });
  if (!target) throw new StaffError("User not found.");

  const actorPerms = new Set(actor.permissions);
  const isOwner = actor.role === "OWNER";
  const grantsOwner = choice.kind === "builtin" && choice.role === "OWNER";
  if ((grantsOwner || target.role === "OWNER") && !isOwner) throw new StaffError("Only an owner can grant or remove owner access.");
  if (!isOwner) {
    if (!subset(await currentPermissions(target), actorPerms)) throw new StaffError("This person has access you don’t have, so you can’t change it.");
    if (!subset(await permissionsOf(choice), actorPerms)) throw new StaffError("You can only grant permissions you hold yourself.");
  }
  if (target.role === "OWNER" && !grantsOwner) {
    if ((await db.user.count({ where: { role: "OWNER" } })) <= 1) throw new StaffError("The store needs at least one owner.");
  }

  const data =
    choice.kind === "none"
      ? { role: "CUSTOMER" as const, staffRoleId: null }
      : choice.kind === "builtin"
        ? { role: choice.role, staffRoleId: null }
        : { role: "SUPPORT" as const, staffRoleId: choice.staffRoleId };
  const updated = await db.user.update({ where: { id: userId }, data });
  // Revoking access ends their sessions so the change bites immediately on every device.
  if (choice.kind === "none") await db.session.deleteMany({ where: { userId } });
  return { email: updated.email, from: target.role, to: data.role, staffRoleId: data.staffRoleId };
}

export function cleanPermissions(input: string[]) {
  return [...new Set(input.filter(isPermission))];
}

/** Guard for creating/editing roles: non-owners can't define roles beyond their own permissions. */
export function assertCanDefine(actor: StaffUser, perms: Permission[]) {
  if (actor.role === "OWNER") return;
  const mine = new Set(actor.permissions);
  const extra = [...expand(perms)].filter((p) => !mine.has(p));
  if (extra.length) throw new StaffError(`You can’t create a role with permissions you don’t hold (${extra.join(", ")}).`);
}
