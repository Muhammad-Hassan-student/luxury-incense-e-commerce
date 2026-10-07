"use client";

import { useState } from "react";
import { deleteStaffRole, inviteStaff, saveStaffRole, setStaffAccess } from "@/actions/admin-staff";
import { PERMISSION_GROUPS, type Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useAdminAction } from "./use-admin-action";

export type AccessOption = { value: string; label: string; disabled?: boolean };

/** Dropdown that applies a new access level immediately (with confirmation for removals). */
export function AccessSelect({ userId, email, current, options }: { userId: string; email: string; current: string; options: AccessOption[] }) {
  const { pending, run } = useAdminAction();
  return (
    <Select
      value={current}
      disabled={pending}
      aria-label={`Access for ${email}`}
      className="min-w-44 py-1.5 text-xs"
      onChange={(e) => {
        const next = e.target.value;
        if (next === "none" && !confirm(`Remove all staff access for ${email}? They’ll be signed out.`)) return;
        run(() => setStaffAccess({ userId, access: next }));
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled} className="bg-bg">
          {o.label}
        </option>
      ))}
    </Select>
  );
}

export function InviteStaffForm({ options, presetEmail }: { options: AccessOption[]; presetEmail?: string }) {
  const { pending, run } = useAdminAction();
  const [email, setEmail] = useState(presetEmail ?? "");
  const [name, setName] = useState("");
  const [access, setAccess] = useState(options.find((o) => !o.disabled && o.value !== "none")?.value ?? "");
  return (
    <form
      className="grid gap-6 md:grid-cols-[2fr_1.5fr_1.5fr_auto] md:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => inviteStaff({ email, name, access }), {
          onSuccess: () => {
            setEmail("");
            setName("");
          },
        });
      }}
    >
      <Field label="Email">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label="Name (optional)">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
      </Field>
      <Field label="Access">
        <Select value={access} onChange={(e) => setAccess(e.target.value)} required>
          {options
            .filter((o) => o.value !== "none")
            .map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled} className="bg-bg">
                {o.label}
              </option>
            ))}
        </Select>
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add staff"}
      </Button>
    </form>
  );
}

/** Create/edit form for a custom role. Permissions the editor doesn't hold are shown but locked. */
export function RoleEditor({
  initial,
  grantable,
  onDone,
}: {
  initial?: { id: string; name: string; description: string | null; permissions: string[] };
  grantable: Permission[];
  onDone?: () => void;
}) {
  const { pending, run } = useAdminAction();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [perms, setPerms] = useState<Set<string>>(new Set(initial?.permissions ?? []));
  const toggle = (p: string) =>
    setPerms((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveStaffRole({ id: initial?.id, name, description, permissions: [...perms] }), { onSuccess: () => onDone?.() });
      }}
    >
      <div className="grid gap-6 md:grid-cols-2">
        <Field label="Role name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} placeholder="e.g. Warehouse" />
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} className="min-h-12" rows={1} />
        </Field>
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {PERMISSION_GROUPS.map((g) => (
          <fieldset key={g.group} className="border border-line p-4">
            <legend className="eyebrow px-2 !text-muted">{g.group}</legend>
            <div className="space-y-2">
              {g.items.map((item) => {
                const locked = !grantable.includes(item.key);
                return (
                  <label key={item.key} className={cn("flex cursor-pointer gap-3 text-sm", locked && "cursor-not-allowed opacity-40")} title={locked ? "You don’t hold this permission" : undefined}>
                    <input type="checkbox" checked={perms.has(item.key)} disabled={locked} onChange={() => toggle(item.key)} className="mt-0.5 size-4 shrink-0 accent-[var(--gold)]" />
                    <span>
                      {item.label}
                      {"hint" in item && item.hint && <span className="block text-xs text-subtle">{item.hint}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="flex gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {initial ? "Save role" : "Create role"}
        </Button>
        {onDone && (
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function RoleCard({
  role,
  members,
  grantable,
  summary,
}: {
  role: { id: string; name: string; description: string | null; permissions: string[] };
  members: number;
  grantable: Permission[];
  summary: string;
}) {
  const [editing, setEditing] = useState(false);
  const { pending, run } = useAdminAction();
  if (editing) return <RoleEditor initial={role} grantable={grantable} onDone={() => setEditing(false)} />;
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl">
        <p className="text-sm text-muted">{role.description || "No description"}</p>
        <p className="mt-2 text-xs text-subtle">{summary}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="me-2 text-xs text-muted">
          {members} member{members === 1 ? "" : "s"}
        </span>
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button size="sm" variant="danger" disabled={pending} onClick={() => confirm(`Delete the “${role.name}” role?`) && run(() => deleteStaffRole(role.id))}>
          Delete
        </Button>
      </div>
    </div>
  );
}

export function NewRole({ grantable }: { grantable: Permission[] }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <RoleEditor grantable={grantable} onDone={() => setOpen(false)} />
  ) : (
    <Button size="sm" onClick={() => setOpen(true)}>
      New role
    </Button>
  );
}
