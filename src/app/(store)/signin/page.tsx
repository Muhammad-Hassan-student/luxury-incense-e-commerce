import type { Metadata } from "next";
import Link from "next/link";
import { Fingerprint, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { pendingSessionToken, pendingState } from "@/server/security/flows";
import { integrations } from "@/env";
import { emailConfigured } from "@/server/email";
import { latestDevMagicLink } from "@/server/dev-magic-link";
import { SignInForm } from "@/components/account/sign-in-form";
import { MaskedHeading } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("signin");
  return { title: t("metaTitle"), robots: { index: false } };
}

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
  const t = await getTranslations("signin");

  return (
    <div className="container-luxe grid min-h-[70svh] items-center gap-16 py-20 lg:grid-cols-2">
      <div>
        <p className="eyebrow mb-6">{securitySetup ? t("eyebrowLock") : t("eyebrowAccount")}</p>
        <MaskedHeading as="h1" text={sent ? t("headingSent") : securitySetup ? t("headingSecure") : t("headingWelcome")} italicLine={1} className="text-6xl md:text-8xl" />
        <p className="mt-6 max-w-sm text-muted">
          {sent ? t("introSent") : securitySetup ? t("introSecure") : t("introDefault")}
        </p>
      </div>
      <div className="w-full max-w-md space-y-8">
        {!sent && <SignInForm callbackUrl={callbackUrl} google={integrations.google} error={error} />}
        {sent && !(await emailConfigured()) && <DevLink />}
        <section aria-labelledby="signin-security" className="border border-gold/30 bg-gold/5 p-6">
          <div className="flex items-center gap-3 text-gold">
            <ShieldCheck className="size-5 shrink-0" aria-hidden />
            <h2 id="signin-security" className="eyebrow">{t("eyebrowLock")}</h2>
          </div>
          <p className="mt-4 font-display text-2xl">{t("lockTitle")}</p>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {securitySetup ? t("lockBodySecure") : t("lockBody")}
          </p>
          {!securitySetup && !sent && (
            <Button asChild variant="outline" className="mt-5 w-full tracking-[0.12em]">
              <Link href="/signin?callbackUrl=%2Faccount%2Fsecurity"><Fingerprint className="size-4 shrink-0" aria-hidden /><span>{t("lockCta")}</span></Link>
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}
