"use client";

import { useState } from "react";
import { saveIntegrationAction, sendTestEmailAction } from "@/actions/admin-integrations";
import { Button } from "@/components/ui/button";
import { Badge, Field, Input, Select } from "@/components/ui/field";
import { useAdminAction } from "./use-admin-action";

export type IntegrationField = {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  help?: string;
  type?: "text" | "number" | "select" | "boolean";
  options?: { value: string; label: string }[];
  value: unknown;
  preview?: string;
  source: "saved" | "env" | "none";
};

const sourceLabel = { saved: "saved here", env: "from env", none: "" } as const;

/** One provider: secrets are write-only (shown as ••••1234), blank secret inputs keep the saved value. */
export function IntegrationCard({
  provider,
  fields,
  connected,
  canTestEmail,
  defaultTestTo,
}: {
  provider: string;
  fields: IntegrationField[];
  connected: boolean;
  canTestEmail?: boolean;
  defaultTestTo?: string;
}) {
  const { pending, run } = useAdminAction();
  const test = useAdminAction();
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.secret ? "" : ((f.value as string | number | boolean | undefined) ?? (f.type === "boolean" ? false : ""))])),
  );
  const [clear, setClear] = useState<string[]>([]);
  const [testTo, setTestTo] = useState(defaultTestTo ?? "");
  const set = (k: string, v: string | number | boolean) => setValues((s) => ({ ...s, [k]: v }));

  return (
    <form
      className="space-y-6 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveIntegrationAction({ provider, values, clear }), {
          onSuccess: () => {
            setClear([]);
            setValues((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, fields.find((f) => f.key === k)?.secret ? "" : v])));
          },
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={connected ? "gold" : "muted"}>{connected ? "Connected" : "Not set up"}</Badge>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-6">
        {fields.map((f) =>
          f.type === "boolean" ? (
            <label key={f.key} className="flex items-center gap-3 self-end py-3 text-sm text-fg">
              <input type="checkbox" className="size-4 accent-[var(--gold)]" checked={Boolean(values[f.key])} onChange={(e) => set(f.key, e.target.checked)} disabled={pending} />
              {f.label}
            </label>
          ) : (
            <Field
              key={f.key}
              label={f.label + (f.source !== "none" ? ` · ${sourceLabel[f.source]}` : "")}
              hint={f.secret && f.preview ? `Saved: ${f.preview}. Leave blank to keep it.${f.help ? " " + f.help : ""}` : f.help}
            >
              {f.type === "select" ? (
                <Select value={String(values[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)} disabled={pending}>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <div className="flex items-center gap-3">
                  <Input
                    type={f.secret ? "password" : f.type === "number" ? "number" : "text"}
                    autoComplete={f.secret ? "new-password" : "off"}
                    spellCheck={false}
                    placeholder={f.secret && f.preview ? f.preview : f.placeholder}
                    value={String(values[f.key] ?? "")}
                    onChange={(e) => set(f.key, f.type === "number" ? Number(e.target.value) : e.target.value)}
                    disabled={pending || clear.includes(f.key)}
                  />
                  {f.secret && f.preview && f.source === "saved" ? (
                    <label className="flex shrink-0 items-center gap-1.5 text-[0.625rem] uppercase tracking-[0.2em] text-subtle">
                      <input
                        type="checkbox"
                        className="accent-[var(--ember)]"
                        checked={clear.includes(f.key)}
                        onChange={(e) => setClear((c) => (e.target.checked ? [...c, f.key] : c.filter((k) => k !== f.key)))}
                      />
                      Clear
                    </label>
                  ) : null}
                </div>
              )}
            </Field>
          ),
        )}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        {canTestEmail ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
            <Field label="Send a test email to" className="min-w-56 flex-1">
              <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="anyone@example.com" />
            </Field>
            <Button type="button" variant="outline" size="sm" disabled={test.pending || !testTo} onClick={() => test.run(() => sendTestEmailAction({ to: testTo }))}>
              {test.pending ? "Sending…" : "Send test"}
            </Button>
          </div>
        ) : (
          <span />
        )}
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
