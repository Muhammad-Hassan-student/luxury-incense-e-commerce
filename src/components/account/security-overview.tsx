import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { currentRpId } from "@/server/security/adapter";
import { describeMethods, methodSummary } from "@/server/security/state";

export async function SecurityOverview({ userId }: { userId: string }) {
  const summary = await methodSummary(userId, await currentRpId());
  const needsSetup = !summary.usablePhone && !summary.usableFace;
  return (
    <section aria-labelledby="account-security" className="flex flex-col gap-6 border border-gold/30 bg-gold/5 p-6 sm:p-8 xl:flex-row xl:items-center xl:justify-between">
      <div>
        <div className="flex items-center gap-3 text-gold">
          <ShieldCheck className="size-5 shrink-0" aria-hidden />
          <h2 id="account-security" className="eyebrow">Security lock</h2>
        </div>
        <p className="mt-4 font-display text-3xl">Face ID &amp; phone lock</p>
        <p className="mt-2 text-sm text-gold">{describeMethods(summary)}</p>
        <p className="mt-3 max-w-lg text-sm text-muted">
          {summary.effective && !needsSetup
            ? "Your saved device or face is checked after your email sign-in link."
            : "Add Face ID, a fingerprint, Windows Hello or a camera face check to protect your sign-ins."}
        </p>
      </div>
      <Button asChild variant="outline" className="shrink-0 self-start tracking-[0.14em]">
        <Link href="/account/security"><span>{needsSetup ? "Set up security lock" : "Manage security lock"}</span></Link>
      </Button>
    </section>
  );
}
