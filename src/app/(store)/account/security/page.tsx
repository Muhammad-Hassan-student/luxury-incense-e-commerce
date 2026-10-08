import type { Metadata } from "next";
import { requireUser } from "@/server/roles";
import { db } from "@/server/db";
import { currentRpId } from "@/server/security/adapter";
import { describeMethods, methodSummary } from "@/server/security/state";
import { SECOND_STEP } from "@/server/security/config";
import { SecurityPanel } from "./security-panel";

export const metadata: Metadata = { title: "Sign-in security", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const user = await requireUser("/account/security");
  const rpId = await currentRpId();
  const [summary, passkeys, faces] = await Promise.all([
    methodSummary(user.id, rpId),
    db.passkey.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, rpId: true, createdAt: true, lastUsedAt: true, backedUp: true } }),
    db.faceTemplate.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { id: true, label: true, createdAt: true, lastUsedAt: true } }),
  ]);

  return (
    <div className="space-y-4">
      <p className="eyebrow">Sign-in security</p>
      <h2 className="display text-4xl md:text-5xl">Face ID &amp; phone lock</h2>
      <p className="max-w-xl text-sm text-muted">
        After your sign-in link, we can ask for one more check — your phone’s own lock (Face ID, fingerprint, Windows Hello) or a quick camera face check — so
        someone who gets into your email still can’t get into your account.
      </p>
      <SecurityPanel
        email={user.email ?? ""}
        status={describeMethods(summary)}
        summary={{
          enabled: summary.enabled,
          required: summary.required,
          effective: summary.effective,
          phoneLockEnabled: summary.phoneLockEnabled,
          faceEnabled: summary.faceEnabled,
          lockedUntil: summary.lockedUntil?.toISOString() ?? null,
        }}
        maxFaces={SECOND_STEP.maxFaces}
        passkeys={passkeys.map((p) => ({
          id: p.id,
          name: p.name,
          here: p.rpId === rpId,
          createdAt: p.createdAt.toISOString(),
          lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
          synced: p.backedUp,
        }))}
        faces={faces.map((f) => ({ id: f.id, label: f.label, createdAt: f.createdAt.toISOString(), lastUsedAt: f.lastUsedAt?.toISOString() ?? null }))}
      />
    </div>
  );
}
