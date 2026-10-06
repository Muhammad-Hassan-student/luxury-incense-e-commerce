"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateProfile } from "@/actions/account";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-6 flex items-center gap-3 border-b border-line-strong">
      <input readOnly value={url} aria-label="Referral link" className="h-11 flex-1 truncate bg-transparent text-sm text-muted focus:outline-none" />
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="text-[0.6875rem] uppercase tracking-[0.28em] text-gold"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function ProfileForm({ name, phone, email }: { name: string; phone: string; email: string }) {
  const [n, setN] = useState(name);
  const [p, setP] = useState(phone);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateProfile({ name: n, phone: p });
          if (res.ok) toast("Saved");
          else toast.error(res.error);
        });
      }}
    >
      <Field label="Email">
        <Input value={email} disabled />
      </Field>
      <Field label="Name">
        <Input value={n} onChange={(e) => setN(e.target.value)} required autoComplete="name" />
      </Field>
      <Field label="Phone">
        <Input value={p} onChange={(e) => setP(e.target.value)} type="tel" autoComplete="tel" />
      </Field>
      <Button type="submit" variant="outline" disabled={pending}>
        Save
      </Button>
    </form>
  );
}
