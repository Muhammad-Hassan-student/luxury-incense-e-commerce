"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { signInWithEmail, signInWithGoogle } from "@/actions/account";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

const errors: Record<string, string> = {
  Verification: "That sign-in link has already been used or has expired. Enter your email below and we'll send a fresh one — it arrives in a few seconds.",
  OAuthAccountNotLinked: "That email is already linked to another sign-in method.",
  // Auth.js reports a failed magic-link send as one of these.
  EmailSignin: "We couldn't send your sign-in email. Please try again in a minute.",
  Configuration: "We couldn't send your sign-in email. Please try again in a minute.",
};

export function SignInForm({
  callbackUrl,
  google,
  error,
  defaultEmail,
}: {
  callbackUrl: string;
  google: boolean;
  error: string | null;
  /** Prefilled when we already know who's signing in (e.g. from an expired link). */
  defaultEmail?: string;
}) {
  const [email, setEmail] = useState(defaultEmail ?? "");
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
          {pending ? "Sending…" : defaultEmail ? "Send me a new link" : "Email me a sign-in link"}
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
