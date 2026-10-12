"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { signInWithEmail, signInWithGoogle } from "@/actions/account";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

/** Auth.js error codes (?error=…) → message keys in `signin`. */
const errors: Record<string, "error_Verification" | "error_OAuthAccountNotLinked" | "error_EmailSignin"> = {
  Verification: "error_Verification",
  OAuthAccountNotLinked: "error_OAuthAccountNotLinked",
  // Auth.js reports a failed magic-link send as one of these.
  EmailSignin: "error_EmailSignin",
  Configuration: "error_EmailSignin",
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
  const t = useTranslations("signin");
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-8">
      {error && <p className="border border-ember/40 p-4 text-sm text-ember" role="alert">{t(Object.hasOwn(errors, error) ? errors[error] : "errorGeneric")}</p>}
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
        <Field label={t("email")}>
          <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? t("sending") : defaultEmail ? t("sendNewLink") : t("emailMeLink")}
        </Button>
      </form>
      {google && (
        <>
          <div className="flex items-center gap-4 text-xs text-subtle">
            <span className="h-px flex-1 bg-line" /> {t("or")} <span className="h-px flex-1 bg-line" />
          </div>
          <form action={() => signInWithGoogle(callbackUrl)}>
            <Button type="submit" variant="outline" size="lg" className="w-full">
              {t("google")}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
