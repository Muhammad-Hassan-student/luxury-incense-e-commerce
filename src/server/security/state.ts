import "server-only";
import { z } from "zod";
import type { Prisma, PrismaClient, Role } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { randomToken } from "./crypto";
import { SECOND_STEP, primaryOrigin, rpIdOf } from "./config";

export type Client = PrismaClient | Prisma.TransactionClient;

// ── Deploy safety ───────────────────────────────────────────────────────────────────────────────────────────

/** True only for "relation does not exist" (Postgres 42P01 / Prisma P2021), anywhere in the error chain. */
export function isMissingTable(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth++) {
    const o = cur as { code?: unknown; meta?: { code?: unknown; driverAdapterError?: unknown }; cause?: unknown; originalCode?: unknown; kind?: unknown };
    if (o.code === "P2021" || o.code === "42P01" || o.originalCode === "42P01" || o.meta?.code === "42P01" || o.kind === "TableDoesNotExist") return true;
    cur = o.cause ?? o.meta?.driverAdapterError;
  }
  return false;
}

let warned = false;

/**
 * Best-effort lookup for optional work such as guest-cart merging; never use this for access decisions.
 * Only missing tables use the fallback. Authentication checks below deliberately do not use this helper.
 * A transaction needs a savepoint so a failed lookup doesn't abort unrelated work.
 */
export async function tolerateMissingTables<T>(client: Client, inTransaction: boolean, fn: () => Promise<T>, fallback: T): Promise<T> {
  if (inTransaction) await client.$executeRawUnsafe("SAVEPOINT mo_second_step");
  try {
    const result = await fn();
    if (inTransaction) await client.$executeRawUnsafe("RELEASE SAVEPOINT mo_second_step");
    return result;
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    if (inTransaction) await client.$executeRawUnsafe("ROLLBACK TO SAVEPOINT mo_second_step");
    if (!warned) {
      warned = true;
      console.warn("[security] optional security lookup unavailable: apply the second-step migration.");
    }
    return fallback;
  }
}

// ── Org policy ──────────────────────────────────────────────────────────────────────────────────────────────

export const POLICY_KEY = "security.second-step";
export const policySchema = z.object({ require: z.enum(["nobody", "staff", "everyone"]).default("nobody") });
export type SecondStepPolicy = z.infer<typeof policySchema>;

export async function getPolicy(client: Client = db): Promise<SecondStepPolicy> {
  const row = await client.setting.findUnique({ where: { key: POLICY_KEY } });
  const parsed = policySchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : { require: "nobody" };
}

export const policyApplies = (policy: SecondStepPolicy, role: Role) =>
  policy.require === "everyone" || (policy.require === "staff" && role !== "CUSTOMER");

// ── Per-user state ──────────────────────────────────────────────────────────────────────────────────────────

export async function ensureSettings(userId: string, client: Client = db) {
  return client.securitySettings.upsert({ where: { userId }, update: {}, create: { userId, webauthnUserId: randomToken(32) } });
}

export type MethodSummary = {
  enabled: boolean;
  required: boolean;
  /** enabled by the user OR required by policy */
  effective: boolean;
  phoneLockEnabled: boolean;
  faceEnabled: boolean;
  passkeys: number;
  faces: number;
  usablePhone: boolean;
  usableFace: boolean;
  lockedUntil: Date | null;
  failedAttempts: number;
};

/** Everything the login check needs. Passkeys only count when registered for this site's rpId. */
export async function methodSummary(userId: string, rpId: string, client: Client = db, role?: Role): Promise<MethodSummary> {
  // Sequential on purpose: inside a transaction, a missing table must be the first (and only) error we see.
  const settings = await client.securitySettings.findUnique({ where: { userId } });
  const passkeys = await client.passkey.count({ where: { userId, rpId } });
  const faces = await client.faceTemplate.count({ where: { userId } });
  const user = role ? { role } : await client.user.findUnique({ where: { id: userId }, select: { role: true } });
  const policy = await getPolicy(client);
  const phoneLockEnabled = settings?.phoneLockEnabled ?? true;
  const faceEnabled = settings?.faceEnabled ?? true;
  const enabled = settings?.secondStepEnabled ?? false;
  const required = user ? policyApplies(policy, user.role) : false;
  return {
    enabled,
    required,
    effective: enabled || required,
    phoneLockEnabled,
    faceEnabled,
    passkeys,
    faces,
    usablePhone: phoneLockEnabled && passkeys > 0,
    usableFace: faceEnabled && faces > 0,
    lockedUntil: settings?.lockedUntil && settings.lockedUntil > new Date() ? settings.lockedUntil : null,
    failedAttempts: settings?.failedAttempts ?? 0,
  };
}

/**
 * An enabled lock never disappears because a credential belongs to another hostname or is unavailable.
 * Only accounts that have not enabled their lock may enroll under a new required policy.
 * Database failures, including unapplied security migrations, must fail closed.
 */
export async function secondStepRequirement(userId: string, rpId: string, client: Client = db): Promise<"verify" | "setup" | null> {
  const s = await methodSummary(userId, rpId, client);
  if (s.enabled || (s.required && (s.usablePhone || s.usableFace))) return "verify";
  return s.required ? "setup" : null;
}

/** Apply the current policy to old sessions too, including customers just assigned a staff/custom role. */
export async function isSessionPending(sessionToken: string, client: Client = db, rpId = rpIdOf(primaryOrigin())): Promise<boolean> {
  const session = await client.session.findUnique({ where: { sessionToken }, include: { secondStep: true } });
  if (!session || session.expires <= new Date()) return false;
  if (session.secondStep) return !session.secondStep.verifiedAt;
  const mode = await secondStepRequirement(session.userId, rpId, client);
  if (!mode) return false;
  // Empty update preserves a proof completed by a concurrent request.
  const marker = await client.sessionSecondStep.upsert({
    where: { sessionToken }, update: {}, create: { sessionToken, userId: session.userId, mode },
  });
  const expires = new Date(marker.createdAt.getTime() + SECOND_STEP.pendingMs);
  await client.session.updateMany({
    where: { sessionToken, expires: { gt: expires }, secondStep: { verifiedAt: null } }, data: { expires },
  });
  return !marker.verifiedAt;
}

export const describeMethods = (s: Pick<MethodSummary, "effective" | "usablePhone" | "usableFace" | "passkeys" | "faces">) => {
  if (!s.effective) return "Off: sign-in link only";
  const parts: string[] = [];
  if (s.usablePhone) parts.push(s.passkeys === 1 ? "phone lock" : `${s.passkeys} phone locks`);
  if (s.usableFace) parts.push(s.faces === 1 ? "1 face" : `${s.faces} faces`);
  return parts.length ? `On: ${parts.join(" + ")}` : "On: waiting for setup";
};
