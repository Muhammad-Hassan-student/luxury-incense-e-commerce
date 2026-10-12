import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { currentRpId } from "@/server/security/adapter";
import { methodSummary } from "@/server/security/state";

export async function SecurityOverview({ userId }: { userId: string }) {
  const summary = await methodSummary(userId, await currentRpId());
  const needsSetup = !summary.usablePhone && !summary.usableFace;
  const [t, ts] = await Promise.all([getTranslations("account"), getTranslations("security")]);
  // Same wording as describeMethods() (src/server/security/state.ts), in the visitor’s language — see security/settings.tsx.
  const status = !summary.effective
    ? ts("statusOff")
    : summary.usablePhone && summary.usableFace
      ? ts("statusBoth", { phones: summary.passkeys, faces: summary.faces })
      : summary.usablePhone
        ? ts("statusPhone", { phones: summary.passkeys })
        : summary.usableFace
          ? ts("statusFace", { faces: summary.faces })
          : ts("statusWaiting");
  return (
    <section aria-labelledby="account-security" className="flex flex-col gap-6 border border-gold/30 bg-gold/5 p-6 sm:p-8 xl:flex-row xl:items-center xl:justify-between">
      <div>
        <div className="flex items-center gap-3 text-gold">
          <ShieldCheck className="size-5 shrink-0" aria-hidden />
          <h2 id="account-security" className="eyebrow">{t("securityLock")}</h2>
        </div>
        <p className="mt-4 font-display text-3xl">{t("securityTitle")}</p>
        <p className="mt-2 text-sm text-gold">{status}</p>
        <p className="mt-3 max-w-lg text-sm text-muted">
          {summary.effective && !needsSetup
            ? t("securityOn")
            : t("securityOff")}
        </p>
      </div>
      <Button asChild variant="outline" className="shrink-0 self-start tracking-[0.14em]">
        <Link href="/account/security"><span>{needsSetup ? t("securitySetup") : t("securityManage")}</span></Link>
      </Button>
    </section>
  );
}
