"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Role } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { requireRole } from "@/server/roles";
import { audit } from "@/server/audit";
import { cuid, done, fail, zodMessage } from "@/lib/admin-server";
import type { ActionResult } from "@/lib/admin-shared";

const roleSchema = z.object({ userId: cuid, role: z.enum(Role) });

export async function setUserRole(input: z.input<typeof roleSchema>): Promise<ActionResult> {
  const actor = await requireRole("OWNER");
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return fail(zodMessage(parsed.error));
  const { userId, role } = parsed.data;
  if (userId === actor.id) return fail("You can't change your own role.");

  const target = await db.user.findUnique({ where: { id: userId }, select: { role: true, email: true } });
  if (!target) return fail("User not found.");
  if (target.role === role) return done();

  if (target.role === "OWNER" && role !== "OWNER") {
    const owners = await db.user.count({ where: { role: "OWNER" } });
    if (owners <= 1) return fail("The store needs at least one owner.");
  }

  await db.user.update({ where: { id: userId }, data: { role } });
  // Role is read from the DB session on every request, so the change applies immediately.
  await audit(actor.id, "user.role", "User", userId, { email: target.email, from: target.role, to: role });
  revalidatePath("/admin/customers");
  return done(`${target.email} is now ${role.toLowerCase()}`);
}
