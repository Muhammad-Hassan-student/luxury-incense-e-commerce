import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { integrations } from "@/env";
import { latestDevMagicLink } from "@/server/dev-magic-link";
import { SignInForm } from "@/components/account/sign-in-form";
import { MaskedHeading } from "@/components/motion/reveal";

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
  if ((await auth())?.user) redirect(callbackUrl);
  const sent = sp.type === "email";
  const error = typeof sp.error === "string" ? sp.error : null;

  return (
    <div className="container-luxe grid min-h-[70svh] items-center gap-16 py-20 lg:grid-cols-2">
      <div>
        <p className="eyebrow mb-6">Your account</p>
        <MaskedHeading as="h1" text={sent ? "Check your\ninbox" : "Welcome\nback"} italicLine={1} className="text-6xl md:text-8xl" />
        <p className="mt-6 max-w-sm text-muted">
          {sent ? "We’ve sent you a sign-in link. It works once and expires in 24 hours." : "No passwords. We’ll email you a link that signs you in — and creates your account if you’re new."}
        </p>
      </div>
      <div className="max-w-md">
        {!sent && <SignInForm callbackUrl={callbackUrl} google={integrations.google} error={error} />}
        {sent && !integrations.email && <DevLink />}
      </div>
    </div>
  );
}
