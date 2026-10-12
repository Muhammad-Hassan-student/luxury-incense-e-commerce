import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { pendingSessionToken, pendingState } from "@/server/security/flows";
import { StepTwo } from "./step-two";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("signin");
  return { title: t("verifyMetaTitle"), robots: { index: false } };
}
export const dynamic = "force-dynamic";

/** Step 2 of sign-in (Face ID / phone lock). Reached only with a pending step-1 session (see src/proxy.ts). */
export default async function VerifyPage(props: PageProps<"/signin/verify">) {
  const sp = await props.searchParams;
  const raw = typeof sp.callbackUrl === "string" ? sp.callbackUrl : "/account";
  const callbackUrl = raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/signin") ? raw : "/account";
  const p = await pendingState(await pendingSessionToken());
  const name = p.state === "verify" || p.state === "setup" ? (p.name?.split(" ")[0] ?? null) : null;
  const email = p.state === "verify" || p.state === "setup" ? p.email : null;
  const t = await getTranslations("signin");
  const greeting = name ? t("greetName", { name }) : t("greetAnon");
  const em = (c: React.ReactNode) => <em className="text-gold">{c}</em>;

  return (
    <div className="container-luxe grid min-h-[70svh] items-start gap-12 py-16 md:py-20 lg:grid-cols-2 lg:items-center lg:gap-16">
      <div>
        <p className="eyebrow mb-6">{t("eyebrowSignInSecurity")}</p>
        <h1 className="display text-5xl md:text-7xl">
          {p.state === "setup" ? t.rich("verifyHeadingSetup", { em }) : t.rich("verifyHeading", { em })}
        </h1>
        <p className="mt-6 max-w-sm text-muted">
          {p.state === "verify" && t("verifyIntro", { greeting })}
          {p.state === "setup" && t("verifyIntroSetup", { greeting })}
          {(p.state === "expired" || p.state === "none") && t("verifyIntroExpired")}
          {p.state === "done" && t("verifyIntroDone")}
        </p>
      </div>
      <div className="w-full max-w-md">
        <StepTwo initial={p.state} email={email} callbackUrl={callbackUrl} />
      </div>
    </div>
  );
}
