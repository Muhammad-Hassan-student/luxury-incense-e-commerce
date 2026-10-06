"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { signInWithEmail, signInWithGoogle } from "@/actions/account";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

const errors: Record<string, string> = {
  Verification: "That link has expired or was already used. Request a new one.",
  OAuthAccountNotLinked: "That email is already linked to another sign-in method.",
};

export function SignInForm({ callbackUrl, google, error }: { callbackUrl: string; google: boolean; error: string | null }) {
  const [email, setEmail] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-8">
      {error && <p className="border border-ember/40 p-4 text-sm text-ember" role="alert">{errors[error] ?? "Something went wrong signing you in. Please try again."}</p>}
      <form
        className="space-y-8"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await signInWithEmail(email, callbackUrl);
            if (res && !res.ok) toast.error(res.error);
          });
        }}
      >
        <Field label="Email">
          <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? "Sending…" : "Email me a sign-in link"}
        </Button>
      </form>
      {google && (
        <>
          <div className="flex items-center gap-4 text-xs text-subtle">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
          <form action={() => signInWithGoogle(callbackUrl)}>
            <Button type="submit" variant="outline" size="lg" className="w-full">
              Continue with Google
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
