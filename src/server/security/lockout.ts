import "server-only";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { SECOND_STEP } from "./config";
import { ensureSettings } from "./state";
import { SecurityError } from "./tickets";

const minutesLeft = (until: Date) => Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));

/** Throws 423 while the user's second step is locked after too many wrong tries. */
export async function assertNotLocked(userId: string) {
  const s = await db.securitySettings.findUnique({ where: { userId }, select: { lockedUntil: true } });
  if (s?.lockedUntil && s.lockedUntil > new Date()) {
    const n = minutesLeft(s.lockedUntil);
    throw new SecurityError(`Too many tries. Try again in ${n} minute${n === 1 ? "" : "s"}.`, 423, { lockedUntil: s.lockedUntil.toISOString() });
  }
}

/**
 * Counts one wrong face / phone-lock try in the database (atomic increment). The 5th wrong try in a row locks the
 * second step for 15 minutes. Returns a SecurityError carrying the server's own wording for the client to show.
 */
export async function recordWrongTry(userId: string, what: string, reason: string, meta: Record<string, unknown> = {}, lead?: string): Promise<SecurityError> {
  await ensureSettings(userId);
  const row = await db.securitySettings.update({ where: { userId }, data: { failedAttempts: { increment: 1 } }, select: { failedAttempts: true } });
  await audit(userId, "security.second_step.failed", "User", userId, { method: what, reason, attempt: row.failedAttempts, ...meta } as never).catch(() => {});
  if (row.failedAttempts >= SECOND_STEP.maxWrongTries) {
    const lockedUntil = new Date(Date.now() + SECOND_STEP.lockMs);
    await db.securitySettings.update({ where: { userId }, data: { failedAttempts: 0, lockedUntil } });
    await audit(userId, "security.second_step.locked", "User", userId, { until: lockedUntil.toISOString() }).catch(() => {});
    const n = minutesLeft(lockedUntil);
    return new SecurityError(`Too many tries. Try again in ${n} minutes.`, 423, { lockedUntil: lockedUntil.toISOString() });
  }
  const left = SECOND_STEP.maxWrongTries - row.failedAttempts;
  const tries = `${left} ${left === 1 ? "try" : "tries"} left.`;
  return new SecurityError(`${lead ?? (what === "face" ? "That doesn’t look like you." : "That phone lock didn’t check out.")} ${tries}`, 401, { triesLeft: left });
}

export async function resetWrongTries(userId: string) {
  await db.securitySettings.updateMany({ where: { userId }, data: { failedAttempts: 0, lockedUntil: null } });
}
