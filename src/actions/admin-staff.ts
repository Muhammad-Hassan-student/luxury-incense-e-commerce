"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requirePermission } from "@/server/roles";
import { audit } from "@/server/audit";
import { assertCanDefine, assignAccess, cleanPermissions, StaffError, type AccessChoice } from "@/server/staff";
import { sendEmail } from "@/server/email";
import { SimpleEmail } from "@/emails/simple";
import { expand } from "@/lib/permissions";
import { cuid, done, fail, isUniqueViolation, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";
import { brand } from "@/config/brand";

/** Encoded in forms as "none" | "builtin:SUPPORT|MANAGER|OWNER" | "custom:<roleId>". */
const accessSchema = z.string().transform((v, ctx): AccessChoice => {
  if (v === "none") return { kind: "none" };
  const [kind, value] = v.split(":");
  if (kind === "builtin" && (value === "SUPPORT" || value === "MANAGER" || value === "OWNER")) return { kind: "builtin", role: value };
  if (kind === "custom" && value && cuid.safeParse(value).success) return { kind: "custom", staffRoleId: value };
  ctx.addIssue({ code: "custom", message: "Choose an access level" });
  return z.NEVER;
});

function refresh() {
  revalidatePath("/admin/staff");
  revalidatePath("/admin/roles");
  revalidatePath("/admin/customers");
}

const setSchema = z.object({ userId: cuid, access: accessSchema });

export async function setStaffAccess(input: z.input<typeof setSchema>): Promise<ActionResult> {
  const actor = await requirePermission("staff.manage");
  const parsed = setSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  try {
    const r = await assignAccess(actor, parsed.data.userId, parsed.data.access);
    await audit(actor.id, parsed.data.access.kind === "none" ? "staff.revoke" : "staff.access", "User", parsed.data.userId, { email: r.email, from: r.from, to: r.to, staffRoleId: r.staffRoleId });
  } catch (e) {
    if (e instanceof StaffError) return fail(e.message);
    throw e;
  }
  refresh();
  return done(parsed.data.access.kind === "none" ? "Access removed" : "Access updated");
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  name: z.string().trim().max(100).optional(),
  access: accessSchema,
});

/** Gives an existing account staff access, or creates the account and emails an invitation. */
export async function inviteStaff(input: z.input<typeof inviteSchema>): Promise<ActionResult> {
  const actor = await requirePermission("staff.manage");
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { email, name, access } = parsed.data;
  if (access.kind === "none") return fail("Choose the access to give.");

  let user = await db.user.findUnique({ where: { email }, select: { id: true } });
  const created = !user;
  if (!user) {
    try {
      user = await db.user.create({ data: { email, name: name || null }, select: { id: true } });
    } catch (e) {
      if (isUniqueViolation(e)) return fail("That email was just added — refresh and try again.");
      throw e;
    }
  }
  try {
    const r = await assignAccess(actor, user.id, access);
    await audit(actor.id, "staff.invite", "User", user.id, { email, to: r.to, staffRoleId: r.staffRoleId, created });
  } catch (e) {
    if (created) await db.user.delete({ where: { id: user.id } }).catch(() => {});
    if (e instanceof StaffError) return fail(e.message);
    throw e;
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  await sendEmail({
    to: email,
    subject: `You’ve been given staff access to ${brand.name}`,
    react: SimpleEmail({
      preview: "Your staff access is ready",
      title: "Welcome to the atelier",
      body: `${actor.name ?? actor.email} has given you staff access to ${brand.name}. Sign in with this email address — we’ll send you a one-time link — then open Store admin from your account.`,
      cta: { label: "Sign in", path: "/signin?callbackUrl=/admin" },
    }),
    devLog: `Staff invite for ${email}: sign in at ${site}/signin?callbackUrl=/admin`,
  }).catch(() => {});
  refresh();
  return done(created ? `Invitation sent to ${email}` : `${email} now has staff access`, user.id);
}

const roleSchema = z.object({
  id: cuid.optional(),
  name: z.string().trim().min(2, "Name the role").max(40),
  description: z.string().trim().max(200).optional(),
  permissions: z.array(z.string()).min(1, "Pick at least one permission"),
});

export async function saveStaffRole(input: z.input<typeof roleSchema>): Promise<ActionResult> {
  const actor = await requirePermission("staff.manage");
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { id, name, description } = parsed.data;
  const permissions = cleanPermissions(parsed.data.permissions);
  if (!permissions.length) return fail("Pick at least one permission.");
  if (["owner", "manager", "support", "customer"].includes(name.toLowerCase())) return fail("That name is reserved for a built-in role.");

  try {
    assertCanDefine(actor, permissions);
    if (id) {
      const existing = await db.staffRole.findUnique({ where: { id }, select: { permissions: true } });
      if (!existing) return fail("Role not found.");
      // Non-owners can't edit roles that already grant more than they hold.
      assertCanDefine(actor, [...expand(existing.permissions)]);
    }
  } catch (e) {
    if (e instanceof StaffError) return fail(e.message);
    throw e;
  }

  try {
    const role = id
      ? await db.staffRole.update({ where: { id }, data: { name, description: description || null, permissions } })
      : await db.staffRole.create({ data: { name, description: description || null, permissions } });
    await audit(actor.id, id ? "role.update" : "role.create", "StaffRole", role.id, { name, permissions });
    refresh();
    return done(id ? `“${name}” updated` : `“${name}” created`, role.id);
  } catch (e) {
    if (isUniqueViolation(e)) return fail("A role with that name already exists.");
    throw e;
  }
}

export async function deleteStaffRole(id: string): Promise<ActionResult> {
  const actor = await requirePermission("staff.manage");
  if (!cuid.safeParse(id).success) return fail("Invalid role.");
  const role = await db.staffRole.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
  if (!role) return fail("Role not found.");
  if (role._count.users > 0) return fail(`Move the ${role._count.users} member${role._count.users > 1 ? "s" : ""} to another role first.`);
  try {
    assertCanDefine(actor, [...expand(role.permissions)]);
  } catch (e) {
    if (e instanceof StaffError) return fail(e.message);
    throw e;
  }
  await db.staffRole.delete({ where: { id } });
  await audit(actor.id, "role.delete", "StaffRole", id, { name: role.name });
  refresh();
  return done(`“${role.name}” deleted`);
}
