import { Badge } from "@/components/ui/field";
import Link from "next/link";
import { getPolicy } from "@/server/security/state";
import { Empty, PageHeader, Section } from "@/components/admin/ui";
import { NewRole, RoleCard } from "@/components/admin/staff-admin";
import { db } from "@/server/db";
import { can, requirePermission } from "@/server/roles";
import { ALL_PERMISSIONS, BUILT_IN_LABEL, BUILT_IN_PERMISSIONS, PERMISSION_GROUPS, expand, type Permission } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Roles" };

const label = new Map<string, string>(PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.label] as const)));

function summarise(perms: Iterable<string>) {
  const set = expand(perms);
  if (set.size === ALL_PERMISSIONS.length) return "All permissions";
  return [...set].map((p) => label.get(p) ?? p).join(" · ");
}

export default async function RolesPage() {
  const me = await requirePermission("staff.manage");
  // Non-owners can only build roles out of permissions they hold.
  const grantable: Permission[] = me.role === "OWNER" ? ALL_PERMISSIONS : me.permissions;

  const [roles, counts, securityPolicy] = await Promise.all([
    db.staffRole.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { users: true } } } }),
    db.user.groupBy({ by: ["role"], where: { staffRoleId: null, role: { not: "CUSTOMER" } }, _count: true }),
    getPolicy(),
  ]);
  const builtInCount = (r: string) => counts.find((c) => c.role === r)?._count ?? 0;

  return (
    <>
      <PageHeader eyebrow="Admin" title="Roles">
        A role is a named set of permissions. Use the built-in levels, or create roles that fit how your team works — for example a “Warehouse” role that can receive stock and pack orders but never see revenue.
      </PageHeader>

      <Section title="Security lock for all roles">
        <p className="text-sm text-muted">
          {securityPolicy.require === "nobody"
            ? "Each member can enable their own lock. A required staff lock can cover every built-in and custom role."
            : "Security lock is required for every owner, manager, support member and custom role. New roles inherit this requirement automatically."}
          {" "}Role permissions only become available after the required setup or verification is complete.
        </p>
        {can(me, "settings.manage") && <Link href="/admin/security" className="mt-3 inline-block text-sm text-gold">Manage security requirements</Link>}
      </Section>

      <Section title="Create a role">
        <NewRole grantable={grantable} />
      </Section>

      <Section title="Built-in">
        <div className="divide-y divide-line">
          {(["OWNER", "MANAGER", "SUPPORT"] as const).map((r) => (
            <div key={r} className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
              <div className="max-w-3xl">
                <p className="font-display text-xl">
                  {BUILT_IN_LABEL[r].name} <Badge tone="muted" className="ms-2 align-middle">built-in</Badge>
                </p>
                <p className="mt-1 text-sm text-muted">{BUILT_IN_LABEL[r].description}</p>
                <p className="mt-2 text-xs text-subtle">{summarise(BUILT_IN_PERMISSIONS[r])}</p>
              </div>
              <span className="text-xs text-muted">
                {builtInCount(r)} member{builtInCount(r) === 1 ? "" : "s"}
              </span>
            </div>
          ))}
        </div>
      </Section>

      {roles.length === 0 ? (
        <Section title="Custom roles">
          <Empty>No custom roles yet. Create one to give someone exactly the access they need.</Empty>
        </Section>
      ) : (
        roles.map((r) => (
          <Section key={r.id} title={r.name}>
            <RoleCard role={r} members={r._count.users} grantable={grantable} summary={summarise(r.permissions)} />
          </Section>
        ))
      )}
    </>
  );
}
