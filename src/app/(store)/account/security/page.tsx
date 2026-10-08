import type { Metadata } from "next";
import { requireUser } from "@/server/roles";
import { SecuritySettings } from "@/components/security/settings";

export const metadata: Metadata = { title: "Sign-in security", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const user = await requireUser("/account/security");

  return (
    <div className="space-y-4">
      <p className="eyebrow">Security lock</p>
      <h2 className="display text-4xl md:text-5xl">Face ID &amp; phone lock</h2>
      <p className="max-w-xl text-sm text-muted">
        After your sign-in link, we can ask for one more check — your phone’s own lock (Face ID, fingerprint, Windows Hello) or a quick camera face check — so
        someone who gets into your email still can’t get into your account.
      </p>
      <SecuritySettings userId={user.id} email={user.email ?? ""} />
    </div>
  );
}
