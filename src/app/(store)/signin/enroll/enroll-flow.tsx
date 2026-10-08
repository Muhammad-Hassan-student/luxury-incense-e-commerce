"use client";

import { useState } from "react";
import { useClientValue } from "@/lib/use-client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { AddMethod, CodeStep } from "@/components/security/steps";
import { confirmEnrollCodeAction, sendEnrollCodeAction } from "../actions";

export function EnrollFlow() {
  // The token travels in the URL fragment (#…), which only the browser can read.
  const token = useClientValue<string | null>(() => {
    const t = window.location.hash.replace(/^#/, "");
    return /^[A-Za-z0-9_-]{30,100}$/.test(t) ? t : "";
  }, null);
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code" | "add" | "done" | "expired">("email");
  const [ticket, setTicket] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);


  if (token === null) return null;
  if (!token) return <p className="border border-line p-6 text-sm text-muted">This link is incomplete. Ask for a new one.</p>;

  if (step === "done") {
    return (
      <div className="space-y-6 border border-line p-6">
        <p className="display text-3xl">All set</p>
        <p className="text-sm text-muted">It’s saved to the account. This link can’t be used again.</p>
        <Button asChild>
          <Link href="/">Back to the store</Link>
        </Button>
      </div>
    );
  }
  if (step === "expired") {
    return <p className="border border-ember/40 p-6 text-sm text-ember" role="alert">{message ?? "This link has already been used or has expired."} Ask for a new link.</p>;
  }

  if (step === "email") {
    return (
      <form
        className="space-y-8"
        onSubmit={(e) => {
          e.preventDefault();
          setStep("code");
        }}
      >
        <Field label="The account’s email">
          <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full">Email me a code</Button>
      </form>
    );
  }

  if (step === "code") {
    return (
      <CodeStep
        email={email}
        purpose="if it matches this link"
        send={() => sendEnrollCodeAction(token, email)}
        confirm={async (code) => {
          const r = await confirmEnrollCodeAction(token, email, code);
          return r;
        }}
        onTicket={(t) => {
          setTicket(t);
          setStep("add");
        }}
      />
    );
  }

  return (
    <AddMethod
      ticket={ticket!}
      onDone={() => setStep("done")}
      onExpired={(m) => {
        setMessage(m);
        setStep("expired");
      }}
    />
  );
}
