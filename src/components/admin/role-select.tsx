"use client";

import { Role } from "@/generated/prisma/enums";
import { setUserRole } from "@/actions/admin-customers";
import { Select } from "@/components/ui/field";
import { useAdminAction } from "./use-admin-action";

export function RoleSelect({ userId, email, role }: { userId: string; email: string; role: Role }) {
  const { pending, run } = useAdminAction();
  return (
    <label className="block w-32">
      <span className="sr-only">Role for {email}</span>
      <Select
        value={role}
        disabled={pending}
        className="py-1.5 text-xs uppercase tracking-[0.15em]"
        onChange={(e) => {
          const next = e.target.value as Role;
          if (next === role) return;
          if (next === "OWNER" && !window.confirm(`Make ${email} an owner? Owners can change settings and staff roles.`)) return;
          run(() => setUserRole({ userId, role: next }));
        }}
      >
        {Object.values(Role).map((r) => (
          <option key={r} value={r}>
            {r.toLowerCase()}
          </option>
        ))}
      </Select>
    </label>
  );
}
