"use client";

import { useState } from "react";
import { issueGiftCard, setGiftCardActive } from "@/actions/admin-gift-cards";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { useAdminAction } from "./use-admin-action";

export function IssueGiftCardForm() {
  const { pending, run } = useAdminAction();
  const [amount, setAmount] = useState("2500");
  const [recipient, setRecipient] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sendEmail, setSendEmail] = useState(true);

  return (
    <form
      className="grid gap-6 md:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => issueGiftCard({ amount: Number(amount), recipient, recipientEmail, message, sendEmail }), {
          onSuccess: () => {
            setRecipient("");
            setRecipientEmail("");
            setMessage("");
          },
        });
      }}
    >
      <Field label="Amount (₹)">
        <Input type="number" min={1} step="1" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </Field>
      <Field label="Recipient name">
        <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} maxLength={80} />
      </Field>
      <Field label="Recipient email">
        <Input type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} />
      </Field>
      <label className="flex items-center gap-3 self-end pb-3 text-sm text-muted">
        <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="size-4 accent-[var(--gold)]" />
        Email the card to the recipient
      </label>
      <Field label="Message (optional)" className="md:col-span-2">
        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={400} placeholder="e.g. With our apologies for the delay." />
      </Field>
      <div className="md:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Issuing…" : "Issue gift card"}
        </Button>
      </div>
    </form>
  );
}

export function GiftCardActiveToggle({ id, code, isActive, canEdit }: { id: string; code: string; isActive: boolean; canEdit: boolean }) {
  const { pending, run } = useAdminAction();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isActive}
      aria-label={`${code} active`}
      disabled={!canEdit || pending}
      onClick={() => run(() => setGiftCardActive(id, !isActive))}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center border transition-colors duration-300 disabled:cursor-not-allowed",
        isActive ? "border-gold bg-gold/20" : "border-line-strong bg-transparent",
        (pending || !canEdit) && "opacity-60",
      )}
    >
      <span className={cn("absolute size-3 transition-transform duration-300", isActive ? "translate-x-[1.1rem] bg-gold" : "translate-x-[0.2rem] bg-subtle")} />
    </button>
  );
}
