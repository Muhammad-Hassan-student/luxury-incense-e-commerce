import type { Metadata } from "next";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { db } from "@/server/db";
import { brand } from "@/config/brand";
import { env, integrations } from "@/env";
import { parseConfirmTarget } from "@/lib/magic-link";
import { SignInForm } from "@/components/account/sign-in-form";
import { MaskedHeading } from "@/components/motion/reveal";

// The URL carries a one-time token: never index it, never leak it in a Referer, never cache the page.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("signin");
  return { title: t("metaTitle"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}
export const dynamic = "force-dynamic";

/** Auth.js keeps only sha256(token + secret) in VerificationToken (see @auth/core send-token / callback). */
async function linkStillValid(email: string, token: string) {
  const hashed = createHash("sha256").update(`${token}${env.AUTH_SECRET}`).digest("hex");
  const row = await db.verificationToken.findFirst({ where: { identifier: email, token: hashed }, select: { expires: true } });
  return Boolean(row && row.expires > new Date());
}

/**
 * Landing page for the emailed sign-in link. Opening it changes nothing — mail apps and link scanners that preview the
 * link no longer use it up. Only pressing the button opens the real Auth.js callback and signs the person in.
 */
export default async function ConfirmSignInPage(props: PageProps<"/signin/confirm">) {
  const sp = await props.searchParams;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const target = parseConfirmTarget(typeof sp.u === "string" ? sp.u : null, `${proto}://${host}`);
  const valid = target ? await linkStillValid(target.email, target.token) : false;
  const next = target ? (new URL(target.href).searchParams.get("callbackUrl") ?? "/account") : "/account";
  const callbackUrl = next.startsWith("/") && !next.startsWith("//") ? next : "/account";
  const t = await getTranslations("signin");

  return (
    <div className="container-luxe grid min-h-[70svh] items-center gap-16 py-20 lg:grid-cols-2">
      <div>
        <p className="eyebrow mb-6">{t("eyebrowAccount")}</p>
        <MaskedHeading as="h1" text={valid ? t("confirmHeadingValid") : t("confirmHeadingExpired")} italicLine={1} className="text-6xl md:text-8xl" />
        <p className="mt-6 max-w-sm text-muted">
          {valid ? t("confirmIntroValid") : target ? t("confirmIntroExpired") : t("confirmIntroIncomplete")}
        </p>
      </div>
      <div className="w-full max-w-md space-y-8">
        {valid && target ? (
          <div className="space-y-6 border border-line p-6">
            <p className="text-sm text-muted">
              {t.rich("signingInAs", { email: target.email, b: (c) => <span className="break-all text-fg">{c}</span> })}
            </p>
            {/* A plain link (not a form) so it works in every in-app browser; the callback itself is the only side effect. */}
            <a
              href={target.href}
              rel="noreferrer"
              className="press block bg-gold px-6 py-4 text-center text-[0.6875rem] uppercase tracking-[0.28em] text-bg transition-colors hover:bg-fg"
            >
              {t("confirmButton", { brand: brand.name })}
            </a>
            <p className="text-xs text-subtle">{t("confirmNotYou")}</p>
          </div>
        ) : (
          <SignInForm callbackUrl={callbackUrl} google={integrations.google} error={null} defaultEmail={target?.email} />
        )}
      </div>
    </div>
  );
}
