import type { Metadata } from "next";
import { pendingSessionToken, pendingState } from "@/server/security/flows";
import { StepTwo } from "./step-two";

export const metadata: Metadata = { title: "One more check", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Step 2 of sign-in (Face ID / phone lock). Reached only with a pending step-1 session (see src/proxy.ts). */
export default async function VerifyPage(props: PageProps<"/signin/verify">) {
  const sp = await props.searchParams;
  const raw = typeof sp.callbackUrl === "string" ? sp.callbackUrl : "/account";
  const callbackUrl = raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/signin") ? raw : "/account";
  const p = await pendingState(await pendingSessionToken());
  const name = p.state === "verify" || p.state === "setup" ? (p.name?.split(" ")[0] ?? null) : null;
  const email = p.state === "verify" || p.state === "setup" ? p.email : null;

  return (
    <div className="container-luxe grid min-h-[70svh] items-start gap-12 py-16 md:py-20 lg:grid-cols-2 lg:items-center lg:gap-16">
      <div>
        <p className="eyebrow mb-6">Sign-in security</p>
        <h1 className="display text-5xl md:text-7xl">
          {p.state === "setup" ? (
            <>
              Protect your <em className="text-gold">account</em>
            </>
          ) : (
            <>
              One more <em className="text-gold">check</em>
            </>
          )}
        </h1>
        <p className="mt-6 max-w-sm text-muted">
          {p.state === "verify" && <>Hi {name ?? "there"}. Your sign-in link worked; one more check keeps your account safe.</>}
          {p.state === "setup" && (
            <>
              Hi {name ?? "there"}. Your sign-in link worked. This store asks every account like yours to use Face ID or a phone lock — set one up now and
              you’re in.
            </>
          )}
          {(p.state === "expired" || p.state === "none") && <>This sign-in has expired. For your safety the second check only stays open for 5 minutes.</>}
          {p.state === "done" && <>You’re signed in.</>}
        </p>
      </div>
      <div className="w-full max-w-md">
        <StepTwo initial={p.state} email={email} callbackUrl={callbackUrl} />
      </div>
    </div>
  );
}
