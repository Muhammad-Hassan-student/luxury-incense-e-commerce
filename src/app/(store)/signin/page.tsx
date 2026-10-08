import type { Metadata } from "next";
import Link from "next/link";
import { Fingerprint, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pendingSessionToken, pendingState } from "@/server/security/flows";
import { integrations } from "@/env";
import { latestDevMagicLink } from "@/server/dev-magic-link";
import { SignInForm } from "@/components/account/sign-in-form";
import { MaskedHeading } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

/** Local dev without email: show the link instead of making you dig through the server log. */
function DevLink() {
  const link = latestDevMagicLink();
  if (!link) {
    return <p className="border border-line p-6 text-sm text-muted">Email isn’t configured, so the link was printed in the terminal running the dev server.</p>;
  }
  return (
    <div className="space-y-5 border border-line p-6">
      <p className="eyebrow">Development only</p>
      <p className="text-sm text-muted">
        Email isn’t configured yet, so here’s the link that would have been sent to <span className="text-fg">{link.email}</span>.
      </p>
      <a href={link.url} className="block bg-gold px-6 py-4 text-center text-[0.6875rem] uppercase tracking-[0.28em] text-bg transition-colors hover:bg-fg">
        Sign in as {link.email}
      </a>
      <p className="text-xs text-subtle">Hidden automatically once SMTP or Resend is set up, and never shown in production.</p>
    </div>
  );
}

export default async function SignInPage(props: PageProps<"/signin">) {
  const sp = await props.searchParams;
  const raw = typeof sp.callbackUrl === "string" ? sp.callbackUrl : "/account";
  // Only allow same-site redirects.
  const callbackUrl = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/account";
  const securitySetup = callbackUrl === "/account/security";
  if ((await auth())?.user) redirect(callbackUrl);
  const pending = await pendingState(await pendingSessionToken());
  if (pending.state === "verify" || pending.state === "setup") redirect(`/signin/verify?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  const sent = sp.type === "email";
  const error = typeof sp.error === "string" ? sp.error : null;

  return (
    <div className="container-luxe grid min-h-[70svh] items-center gap-16 py-20 lg:grid-cols-2">
      <div>
        <p className="eyebrow mb-6">{securitySetup ? "Security lock" : "Your account"}</p>
        <MaskedHeading as="h1" text={sent ? "Check your\ninbox" : securitySetup ? "Secure your\naccount" : "Welcome\nback"} italicLine={1} className="text-6xl md:text-8xl" />
        <p className="mt-6 max-w-sm text-muted">
          {sent
            ? "We’ve sent you a sign-in link. It works once and expires in 24 hours."
            : securitySetup
              ? "Sign in with your email first. Then set up Face ID, your fingerprint, Windows Hello or a camera face check."
              : "No passwords. Start with an email link, then use your security lock if you’ve enabled one."}
        </p>
      </div>
      <div className="w-full max-w-md space-y-8">
        {!sent && <SignInForm callbackUrl={callbackUrl} google={integrations.google} error={error} />}
        {sent && !integrations.email && <DevLink />}
        <section aria-labelledby="signin-security" className="border border-gold/30 bg-gold/5 p-6">
          <div className="flex items-center gap-3 text-gold">
            <ShieldCheck className="size-5 shrink-0" aria-hidden />
            <h2 id="signin-security" className="eyebrow">Security lock</h2>
          </div>
          <p className="mt-4 font-display text-2xl">Face ID &amp; phone lock</p>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {securitySetup
              ? "Your email link will take you to security settings. Add a device or face and switch the lock on to protect future sign-ins."
              : "Already set up? Your saved lock is requested after the email link. New here? Add a lock after signing in."}
          </p>
          {!securitySetup && !sent && (
            <Button asChild variant="outline" className="mt-5 w-full tracking-[0.12em]">
              <Link href="/signin?callbackUrl=%2Faccount%2Fsecurity"><Fingerprint className="size-4 shrink-0" aria-hidden /><span>Set up security lock</span></Link>
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}
