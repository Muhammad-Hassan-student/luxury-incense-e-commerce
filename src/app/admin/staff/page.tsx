import { Badge } from "@/components/ui/field";
import { Empty, PageHeader, Section, Table, Td, Th } from "@/components/admin/ui";
import { AccessSelect, InviteStaffForm, type AccessOption } from "@/components/admin/staff-admin";
import { db } from "@/server/db";
import { requirePermission, type StaffUser } from "@/server/roles";
import { BUILT_IN_LABEL, BUILT_IN_PERMISSIONS, expand } from "@/lib/permissions";
import { fmtDate, fmtDateTime } from "@/lib/admin-shared";
import { param } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff" };

/** Options the current user may assign: owners anything; others only access within their own. */
function accessOptions(me: StaffUser, roles: { id: string; name: string; permissions: string[] }[]): AccessOption[] {
  const mine = new Set(me.permissions);
  const within = (perms: Iterable<string>) => me.role === "OWNER" || [...expand(perms)].every((p) => mine.has(p));
  return [
    { value: "none", label: "No staff access" },
    { value: "builtin:SUPPORT", label: "Support", disabled: !within(BUILT_IN_PERMISSIONS.SUPPORT) },
    { value: "builtin:MANAGER", label: "Manager", disabled: !within(BUILT_IN_PERMISSIONS.MANAGER) },
    { value: "builtin:OWNER", label: "Owner", disabled: me.role !== "OWNER" },
    ...roles.map((r) => ({ value: `custom:${r.id}`, label: `${r.name} (custom)`, disabled: !within(r.permissions) })),
  ];
}

export default async function StaffPage(props: PageProps<"/admin/staff">) {
  const me = await requirePermission("staff.manage");
  const focusId = param((await props.searchParams).user);

  const [staff, roles, focus] = await Promise.all([
    db.user.findMany({
      where: { role: { not: "CUSTOMER" } },
      orderBy: [{ role: "desc" }, { createdAt: "asc" }],
      select: { id: true, email: true, name: true, role: true, staffRoleId: true, staffRole: { select: { name: true } }, lastSeenAt: true, createdAt: true },
    }),
    db.staffRole.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, permissions: true } }),
    focusId ? db.user.findUnique({ where: { id: focusId }, select: { id: true, email: true, role: true } }) : null,
  ]);
  const options = accessOptions(me, roles);
  const currentValue = (u: (typeof staff)[number]) => (u.staffRoleId ? `custom:${u.staffRoleId}` : `builtin:${u.role}`);

  return (
    <>
      <PageHeader eyebrow="Admin" title="Staff">
        {staff.length} {staff.length === 1 ? "person has" : "people have"} staff access. Roles decide what each person can see and do — manage them on the Roles page.
      </PageHeader>

      <Section title={focus && focus.role === "CUSTOMER" ? `Give ${focus.email} staff access` : "Add staff"}>
        <InviteStaffForm options={options} presetEmail={focus?.role === "CUSTOMER" ? focus.email : undefined} />
        <p className="mt-4 text-xs text-subtle">
          New addresses get an invitation email. They sign in with a one-time link — no passwords. You can only grant access you hold yourself; only owners can add owners.
        </p>
      </Section>

      <Section title="Team">
        {staff.length === 0 ? (
          <Empty>No staff yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>Access</Th>
                <Th>Last active</Th>
                <Th>Since</Th>
              </tr>
            </thead>
            <tbody>
              {staff.map((u) => (
                <tr key={u.id} className={u.id === focusId ? "bg-gold/5" : undefined}>
                  <Td>
                    {u.name ?? "—"}
                    <span className="block text-xs text-subtle">{u.email}</span>
                  </Td>
                  <Td>
                    {u.id === me.id ? (
                      <Badge>{u.staffRole?.name ?? BUILT_IN_LABEL[u.role as "SUPPORT" | "MANAGER" | "OWNER"].name} · you</Badge>
                    ) : (
                      <AccessSelect userId={u.id} email={u.email} current={currentValue(u)} options={options} />
                    )}
                  </Td>
                  <Td className="text-muted">{u.lastSeenAt ? fmtDateTime(u.lastSeenAt) : "Never"}</Td>
                  <Td className="text-muted">{fmtDate(u.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
