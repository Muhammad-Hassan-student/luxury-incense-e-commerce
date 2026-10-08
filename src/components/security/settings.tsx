import { db } from "@/server/db";
import { currentRpId } from "@/server/security/adapter";
import { SECOND_STEP } from "@/server/security/config";
import { describeMethods, methodSummary } from "@/server/security/state";
import { SecurityPanel } from "@/app/(store)/account/security/security-panel";

/** Personal lock controls shared by the account and every staff member's admin security page. */
export async function SecuritySettings({ userId, email }: { userId: string; email: string }) {
  const rpId = await currentRpId();
  const [summary, passkeys, faces] = await Promise.all([
    methodSummary(userId, rpId),
    db.passkey.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, rpId: true, createdAt: true, lastUsedAt: true, backedUp: true } }),
    db.faceTemplate.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { id: true, label: true, createdAt: true, lastUsedAt: true } }),
  ]);
  return <SecurityPanel
    email={email}
    status={describeMethods(summary)}
    summary={{ enabled: summary.enabled, required: summary.required, effective: summary.effective, phoneLockEnabled: summary.phoneLockEnabled, faceEnabled: summary.faceEnabled, lockedUntil: summary.lockedUntil?.toISOString() ?? null }}
    maxFaces={SECOND_STEP.maxFaces}
    passkeys={passkeys.map((p) => ({ id: p.id, name: p.name, here: p.rpId === rpId, createdAt: p.createdAt.toISOString(), lastUsedAt: p.lastUsedAt?.toISOString() ?? null, synced: p.backedUp }))}
    faces={faces.map((f) => ({ id: f.id, label: f.label, createdAt: f.createdAt.toISOString(), lastUsedAt: f.lastUsedAt?.toISOString() ?? null }))}
  />;
}
