"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SupportPriority, SupportStatus } from "@/generated/prisma/enums";
import { deleteMacroAction, logTicketAction, mergeTicketAction, replyTicketAction, saveMacroAction, updateTicketAction } from "@/actions/admin-support";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { Button } from "@/components/ui/button";
import { Badge, Field, Input, Select, Textarea } from "@/components/ui/field";
import { fmtMinutes, PRIORITY_LABEL, renderMacro, STATUS_LABEL, SUPPORT_PRIORITIES, SUPPORT_STATUSES, type SlaState } from "@/lib/support-shared";
import { AttachmentPicker } from "./attachment-picker";

const attachLabels = { attach: "Attach photos", hint: "Up to 4 photos, 5 MB each.", uploading: "Uploading…", remove: "Remove photo" };

export function SlaBadge({ sla }: { sla: SlaState }) {
  if (sla.state === "none") return null;
  if (sla.state === "met") return <Badge tone="muted">Replied</Badge>;
  if (sla.state === "overdue") return <Badge tone="ember">Overdue {fmtMinutes(sla.minutesLeft ?? 0)}</Badge>;
  return <Badge tone={sla.state === "due_soon" ? "ember" : "gold"}>{`Reply in ${fmtMinutes(sla.minutesLeft ?? 0)}`}</Badge>;
}

/** Reply / internal note with canned replies. */
export function StaffReplyBox({ id, macros, ctx }: { id: string; macros: { id: string; title: string; body: string }[]; ctx: { name: string | null; order: string | null; ticket: number } }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [after, setAfter] = useState<SupportStatus>("PENDING");
  const [files, setFiles] = useState<string[]>([]);

  const submit = () =>
    run(() => replyTicketAction({ id, body, internal, status: internal ? undefined : after, attachments: files }), {
      onSuccess: () => {
        setBody("");
        setFiles([]);
        router.refresh();
      },
    });

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Message type">
        <button type="button" role="tab" aria-selected={!internal} onClick={() => setInternal(false)} className={`border px-3 py-1.5 text-[0.6875rem] uppercase tracking-[0.2em] ${!internal ? "border-gold text-gold" : "border-line text-muted"}`}>
          Reply to customer
        </button>
        <button type="button" role="tab" aria-selected={internal} onClick={() => setInternal(true)} className={`border px-3 py-1.5 text-[0.6875rem] uppercase tracking-[0.2em] ${internal ? "border-gold text-gold" : "border-line text-muted"}`}>
          Internal note
        </button>
        {macros.length ? (
          <label className="ms-auto block w-full sm:w-56">
            <span className="sr-only">Insert canned reply</span>
            <Select
              value=""
              onChange={(e) => {
                const m = macros.find((x) => x.id === e.target.value);
                if (m) setBody((b) => (b ? `${b}\n\n` : "") + renderMacro(m.body, ctx));
              }}
            >
              <option value="">Insert canned reply…</option>
              {macros.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
      </div>
      <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder={internal ? "Only staff can see this note." : "Write to the customer…"} aria-label={internal ? "Internal note" : "Reply"} className={internal ? "border-dashed" : undefined} />
      <AttachmentPicker value={files} onChange={setFiles} labels={attachLabels} />
      <div className="flex flex-wrap items-center gap-3">
        {!internal ? (
          <label className="flex items-center gap-2 text-xs text-muted">
            Then set
            <Select value={after} onChange={(e) => setAfter(e.target.value as SupportStatus)} className="w-auto py-1">
              <option value="PENDING">Waiting on customer</option>
              <option value="OPEN">Keep open</option>
              <option value="RESOLVED">Resolved</option>
            </Select>
          </label>
        ) : null}
        <Button type="button" size="sm" onClick={submit} disabled={pending || !body.trim()} className="ms-auto">
          {internal ? "Add note" : "Send reply"}
        </Button>
      </div>
    </div>
  );
}

/** Status, priority, assignee and tags. */
export function TicketControls({ id, status, priority, assigneeId, tags, agents, me }: { id: string; status: SupportStatus; priority: SupportPriority; assigneeId: string | null; tags: string[]; agents: { id: string; name: string }[]; me: string }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [tagText, setTagText] = useState(tags.join(", "));
  const update = (patch: Parameters<typeof updateTicketAction>[0]) => run(() => updateTicketAction(patch), { onSuccess: () => router.refresh() });
  return (
    <div className="space-y-5 p-5">
      <Field label="Status">
        <Select value={status} disabled={pending} onChange={(e) => update({ id, status: e.target.value as SupportStatus })}>
          {SUPPORT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Priority" hint="Changes the first-reply deadline until someone replies.">
        <Select value={priority} disabled={pending} onChange={(e) => update({ id, priority: e.target.value as SupportPriority })}>
          {SUPPORT_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Assignee">
        <Select value={assigneeId ?? ""} disabled={pending} onChange={(e) => update({ id, assigneeId: e.target.value || null })}>
          <option value="">Unassigned</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id === me ? `${a.name} (me)` : a.name}
            </option>
          ))}
        </Select>
      </Field>
      {assigneeId !== me ? (
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => update({ id, assigneeId: me })}>
          Assign to me
        </Button>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          update({ id, tags: tagText.split(",").map((s) => s.trim()).filter(Boolean) });
        }}
        className="space-y-2"
      >
        <Field label="Tags" hint="Comma separated, e.g. damaged, courier">
          <Input value={tagText} onChange={(e) => setTagText(e.target.value)} />
        </Field>
        <Button type="submit" size="sm" variant="ghost" disabled={pending}>
          Save tags
        </Button>
      </form>
    </div>
  );
}

export function MergeForm({ id }: { id: string }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [into, setInto] = useState("");
  return (
    <form
      className="space-y-3 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!confirm(`Move every message into #${into.replace(/^#/, "")} and close this ticket?`)) return;
        run(() => mergeTicketAction({ id, into: into.replace(/^#/, "") }), { onSuccess: (r) => r.id && router.push(`/admin/support/${r.id}`) });
      }}
    >
      <Field label="Merge into ticket #" hint="Duplicates from the same customer: messages move over, this one closes.">
        <Input inputMode="numeric" value={into} onChange={(e) => setInto(e.target.value)} placeholder="10002" />
      </Field>
      <Button type="submit" size="sm" variant="outline" disabled={pending || !into.trim()}>
        Merge
      </Button>
    </form>
  );
}

export function LogTicketForm() {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [v, setV] = useState({ subject: "", body: "", email: "", phone: "", name: "", orderNumber: "", priority: "NORMAL" as SupportPriority, channel: "email" as "email" | "whatsapp" | "admin" });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <form
      className="grid gap-5 p-5 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => logTicketAction(v), { onSuccess: (r) => r.id && router.push(`/admin/support/${r.id}`) });
      }}
    >
      <Field label="Customer email">
        <Input type="email" value={v.email} onChange={set("email")} />
      </Field>
      <Field label="or phone">
        <Input value={v.phone} onChange={set("phone")} placeholder="+91…" />
      </Field>
      <Field label="Name">
        <Input value={v.name} onChange={set("name")} />
      </Field>
      <Field label="Order number (optional)">
        <Input value={v.orderNumber} onChange={set("orderNumber")} placeholder="MO-24001" />
      </Field>
      <Field label="Came in by">
        <Select value={v.channel} onChange={set("channel")}>
          <option value="email">Email</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="admin">Phone / in person</option>
        </Select>
      </Field>
      <Field label="Priority">
        <Select value={v.priority} onChange={set("priority")}>
          {SUPPORT_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Subject" className="sm:col-span-2">
        <Input required value={v.subject} onChange={set("subject")} />
      </Field>
      <Field label="What the customer said" className="sm:col-span-2">
        <Textarea required rows={4} value={v.body} onChange={set("body")} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          Create ticket
        </Button>
      </div>
    </form>
  );
}

export function MacroEditor({ macro }: { macro?: { id: string; title: string; body: string } }) {
  const router = useRouter();
  const { pending, run } = useAdminAction();
  const [title, setTitle] = useState(macro?.title ?? "");
  const [body, setBody] = useState(macro?.body ?? "");
  return (
    <form
      className="space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveMacroAction({ id: macro?.id ?? null, title, body }), {
          onSuccess: () => {
            if (!macro) {
              setTitle("");
              setBody("");
            }
            router.refresh();
          },
        });
      }}
    >
      <Field label="Title">
        <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Text" hint="{{first_name}}, {{name}}, {{order}} and {{ticket}} are filled in when inserted.">
        <Textarea required rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {macro ? "Save" : "Add canned reply"}
        </Button>
        {macro ? (
          <Button
            type="button"
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (confirm(`Delete “${macro.title}”?`)) run(() => deleteMacroAction(macro.id), { onSuccess: () => router.refresh() });
            }}
          >
            Delete
          </Button>
        ) : null}
      </div>
    </form>
  );
}
