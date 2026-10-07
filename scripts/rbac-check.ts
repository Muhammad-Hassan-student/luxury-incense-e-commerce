// Role & permission checks against the local database (creates and removes its own users/roles).
// Run: npm run test:rbac
import "dotenv/config";
import { db } from "@/server/db";
import { assignAccess, assertCanDefine, StaffError } from "@/server/staff";
import { BUILT_IN_PERMISSIONS, expand, resolvePermissions, type Permission } from "@/lib/permissions";
import type { StaffUser } from "@/server/roles";

const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};
const rejects = async (fn: () => Promise<unknown>, msg: string, match?: RegExp) => {
  try {
    await fn();
    ok(false, `${msg} (expected rejection)`);
  } catch (e) {
    ok(e instanceof StaffError && (!match || match.test(e.message)), `${msg} → "${(e as Error).message}"`);
  }
};

const PREFIX = "rbac-test-";
async function user(tag: string, role: "CUSTOMER" | "SUPPORT" | "MANAGER" | "OWNER", staffRoleId: string | null = null) {
  return db.user.create({ data: { email: `${PREFIX}${tag}@test.local`, role, staffRoleId }, include: { staffRole: true } });
}
const asActor = (u: Awaited<ReturnType<typeof user>>): StaffUser => ({
  id: u.id,
  email: u.email,
  name: null,
  role: u.role,
  roleName: u.role,
  permissions: resolvePermissions(u.role, u.staffRole?.permissions),
});

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.session.deleteMany({ where: { userId: { in: ids } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.staffRole.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

async function main() {
  await cleanup();

  // Resolution rules
  ok(resolvePermissions("OWNER", null).length === expand(BUILT_IN_PERMISSIONS.OWNER).size, "owner gets every permission");
  ok(resolvePermissions("CUSTOMER", ["orders.view"]).length === 0, "customers never get permissions, even with a role attached");
  const mgr = resolvePermissions("MANAGER", null);
  ok(!mgr.includes("staff.manage") && !mgr.includes("settings.manage") && mgr.includes("orders.refund"), "manager: refunds yes, staff & settings no");
  ok(expand(["orders.refund"]).has("orders.view") && expand(["orders.refund"]).has("orders.cancel"), "edit permissions imply the matching view");

  const warehouse = await db.staffRole.create({ data: { name: `${PREFIX}Warehouse`, permissions: ["inventory.adjust", "orders.fulfil"] } });
  const peopleRole = await db.staffRole.create({ data: { name: `${PREFIX}People`, permissions: ["staff.manage", "orders.view", "orders.fulfil", "inventory.view"] } });
  const owner = await user("owner", "OWNER");
  const owner2 = await user("owner2", "OWNER");
  const manager = await user("manager", "MANAGER");
  const people = await user("people", "SUPPORT", peopleRole.id);
  const cust = await user("cust", "CUSTOMER");
  const cust2 = await user("cust2", "CUSTOMER");

  const w = resolvePermissions("SUPPORT", warehouse.permissions);
  ok(w.includes("inventory.view") && w.includes("orders.view") && !w.includes("orders.refund") && !w.includes("dashboard.view"), `custom "Warehouse" role resolves to: ${w.join(", ")}`);

  // Owner can assign anything, but not to themselves
  await assignAccess(asActor(owner), cust.id, { kind: "custom", staffRoleId: warehouse.id });
  const c1 = await db.user.findUniqueOrThrow({ where: { id: cust.id } });
  ok(c1.role === "SUPPORT" && c1.staffRoleId === warehouse.id, "owner assigns a custom role (person becomes staff)");
  await rejects(() => assignAccess(asActor(owner), owner.id, { kind: "none" }), "nobody changes their own access", /own access/);

  // Escalation guards for a non-owner who can manage staff
  const P = asActor(people);
  await rejects(() => assignAccess(P, cust2.id, { kind: "builtin", role: "MANAGER" }), "staff manager can't grant Manager (more than they hold)", /only grant/);
  await rejects(() => assignAccess(P, cust2.id, { kind: "builtin", role: "OWNER" }), "only owners can grant owner", /Only an owner/);
  await rejects(() => assignAccess(P, manager.id, { kind: "none" }), "can't change someone who has more access", /access you don/);
  await rejects(() => assignAccess(P, owner.id, { kind: "none" }), "can't remove an owner", /Only an owner/);
  await rejects(() => assignAccess(P, cust2.id, { kind: "custom", staffRoleId: warehouse.id }), "can't hand out a role with inventory.adjust they lack", /only grant/);
  const packer = await db.staffRole.create({ data: { name: `${PREFIX}Packer`, permissions: ["orders.fulfil"] } });
  await assignAccess(P, cust2.id, { kind: "custom", staffRoleId: packer.id });
  ok((await db.user.findUniqueOrThrow({ where: { id: cust2.id } })).staffRoleId === packer.id, "staff manager can grant a role within their own permissions");
  let threw = false;
  try {
    assertCanDefine(P, ["orders.refund"] as Permission[]);
  } catch {
    threw = true;
  }
  ok(threw, "staff manager can't define a role with refund rights");

  // Revoking access signs them out everywhere
  await db.session.create({ data: { sessionToken: `${PREFIX}sess`, userId: cust2.id, expires: new Date(Date.now() + 3600_000) } });
  await assignAccess(P, cust2.id, { kind: "none" });
  const c2 = await db.user.findUniqueOrThrow({ where: { id: cust2.id } });
  ok((await db.session.count({ where: { userId: cust2.id } })) === 0 && c2.role === "CUSTOMER" && c2.staffRoleId === null, "revoking access removes it and ends their sessions");

  // One owner can demote another while an owner remains
  await assignAccess(asActor(owner), owner2.id, { kind: "builtin", role: "MANAGER" });
  ok((await db.user.findUniqueOrThrow({ where: { id: owner2.id } })).role === "MANAGER", "an owner can demote another owner");

  // If a custom role row disappears, members fall back to Support defaults — never more
  await db.staffRole.delete({ where: { id: warehouse.id } });
  const orphan = await db.user.findUniqueOrThrow({ where: { id: cust.id } });
  ok(orphan.staffRoleId === null && resolvePermissions(orphan.role, null).length === expand(BUILT_IN_PERMISSIONS.SUPPORT).size, "deleted role → members fall back to Support defaults");

  await cleanup();
  console.log("cleaned up");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
