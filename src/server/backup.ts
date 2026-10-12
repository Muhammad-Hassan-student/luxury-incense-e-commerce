import "server-only";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { env } from "@/env";
import { SimpleEmail } from "@/emails/simple";
import { db } from "./db";
import { sendEmail } from "./email";
import { getIntegration } from "./integrations";
import { recordIntegration, release } from "./monitoring";

/*
 * Daily backup of the business-critical tables as gzipped JSON (cron "backup", and Admin → Health → Download).
 * Excluded on purpose: sessions, OAuth accounts, passkeys, face templates, security codes, verification tokens,
 * integration settings (API keys) and every column that looks like a secret (token / hash / password / signature…).
 * Gift card codes are bearer credentials: only their last 4 characters are kept.
 *
 * Restore: see scripts/restore-backup.ts (inserts into an empty database, dry run by default).
 */

/** Prisma delegate → backup table name. Optional ones (added by other modules) are skipped when absent. */
export const BACKUP_TABLES: { model: string; optional?: boolean; select?: Record<string, boolean>; key?: string[] }[] = [
  { model: "user", select: { id: true, email: true, name: true, role: true, phone: true, loyaltyPoints: true, referralCode: true, referredById: true, staffRoleId: true, createdAt: true, deletionRequestedAt: true } },
  { model: "staffRole" },
  { model: "category" },
  { model: "collection" },
  { model: "product" },
  { model: "productVariant" },
  { model: "productImage" },
  { model: "collectionProduct", key: ["collectionId", "productId"] },
  { model: "coupon" },
  { model: "giftCard" },
  { model: "order" },
  { model: "orderItem" },
  { model: "orderEvent" },
  { model: "payment" },
  { model: "loyaltyEntry" },
  { model: "returnRequest" },
  { model: "returnItem" },
  { model: "subscription" },
  { model: "subscriptionRenewal" },
  { model: "tradeAccount" },
  { model: "priceTier" },
  { model: "tradePrice", key: ["tierId", "variantId"] },
  { model: "quote" },
  { model: "quoteItem" },
  { model: "supplier" },
  { model: "purchaseOrder" },
  { model: "purchaseOrderItem" },
  { model: "shipment" },
  { model: "supportTicket" },
  { model: "supportMessage" },
  { model: "warehouse", optional: true },
  { model: "warehouseStock", optional: true, key: ["warehouseId", "variantId"] },
  { model: "taxDocument", optional: true },
  { model: "settlement", optional: true },
  { model: "settlementLine", optional: true },
  { model: "promotion", optional: true },
  { model: "affiliate", optional: true },
  { model: "affiliateCommission", optional: true },
  { model: "affiliatePayout", optional: true },
];

/** Never in a backup, whatever table they appear in. */
const SECRET_KEY = /(token|secret|password|passwd|hash|embedding|template|credential|api_?key|private_?key|public_?key|signature|otp|cvv|counter|bank|iban|upi|payoutDetails|^raw$|^lastTracking$)/i;
/** Tables that must never be exported (checked by the test). */
export const NEVER_EXPORTED = ["session", "account", "verificationToken", "passkey", "faceTemplate", "securityEmailCode", "securityTicket", "webAuthnChallenge", "enrollmentLink", "setting", "pushSubscription", "sessionSecondStep"];

export function sanitizeRow(model: string, row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = typeof v === "bigint" ? v.toString() : v;
  }
  if (model === "giftCard" && typeof row.code === "string") out.code = `••••${row.code.slice(-4)}`;
  // Shipping addresses stay (orders can't be fulfilled again without them) — they are personal data: keep backups private.
  return out;
}

type Delegate = { findMany: (args: unknown) => Promise<Record<string, unknown>[]> };
const CHUNK = 2000;
const MAX_ROWS = 250_000;

export type BackupFile = { filename: string; gz: Buffer; bytes: number; counts: Record<string, number>; sha256: string; createdAt: Date };

export async function buildBackup(now = new Date()): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const t of BACKUP_TABLES) {
    if (NEVER_EXPORTED.includes(t.model)) continue;
    const delegate = (db as unknown as Record<string, Delegate | undefined>)[t.model];
    if (!delegate?.findMany) {
      if (!t.optional) console.warn(`[backup] table ${t.model} missing`);
      continue;
    }
    const rows: unknown[] = [];
    let skip = 0;
    while (rows.length < MAX_ROWS) {
      const orderBy = (t.key ?? ["id"]).map((k) => ({ [k]: "asc" }));
      const chunk = await delegate.findMany({ ...(t.select ? { select: t.select } : {}), skip, take: CHUNK, orderBy });
      rows.push(...chunk.map((r) => sanitizeRow(t.model, r)));
      if (chunk.length < CHUNK) break;
      skip += CHUNK;
    }
    tables[t.model] = rows;
    counts[t.model] = rows.length;
  }
  const json = JSON.stringify({ format: "maison-oud-backup", version: 1, createdAt: now.toISOString(), release: release(), counts, tables });
  const gz = gzipSync(Buffer.from(json, "utf8"), { level: 9 });
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return { filename: `maison-oud-backup-${stamp}.json.gz`, gz, bytes: gz.byteLength, counts, sha256: createHash("sha256").update(gz).digest("hex"), createdAt: now };
}

const EMAIL_LIMIT = 8 * 1024 * 1024;
const cloudinaryReady = () => Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);

/** Private raw upload (type=private): the file is only reachable through a signed URL or the Cloudinary console. */
async function uploadToCloudinary(b: BackupFile) {
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = "maison-oud/backups";
  const publicId = b.filename;
  const toSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}&type=private${env.CLOUDINARY_API_SECRET}`;
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(b.gz)], { type: "application/gzip" }), b.filename);
  form.append("api_key", env.CLOUDINARY_API_KEY!);
  form.append("timestamp", String(timestamp));
  form.append("folder", folder);
  form.append("public_id", publicId);
  form.append("type", "private");
  form.append("signature", createHash("sha1").update(toSign).digest("hex"));
  const res = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/raw/upload`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Cloudinary backup upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { public_id: string; bytes: number };
  return { destination: "cloudinary" as const, ref: j.public_id };
}

async function owners() {
  const c = await getIntegration("monitoring");
  const listed = c.alertEmails.split(/[,;\s]+/).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  if (listed.length) return listed.slice(0, 5);
  return (await db.user.findMany({ where: { role: "OWNER", email: { not: { endsWith: ".invalid" } } }, select: { email: true }, take: 5 })).map((u) => u.email);
}

async function emailToOwners(b: BackupFile) {
  if (b.bytes > EMAIL_LIMIT) throw new Error(`Backup is ${(b.bytes / 1048576).toFixed(1)} MB — too large to email. Add Cloudinary keys (CLOUDINARY_*) for backups.`);
  const to = await owners();
  if (!to.length) throw new Error("No owner email to send the backup to.");
  for (const addr of to) {
    const r = await sendEmail({
      to: addr,
      subject: `Maison Oud backup ${b.createdAt.toISOString().slice(0, 10)}`,
      react: SimpleEmail({ preview: "Daily backup attached", title: "Daily backup", body: `Attached: ${b.filename} (${(b.bytes / 1024).toFixed(0)} KB, sha256 ${b.sha256.slice(0, 16)}…). It contains customer data — keep it private. Restore steps are on the store health page.`, cta: { label: "Store health", path: "/admin/health" } }),
      attachments: [{ filename: b.filename, content: b.gz, contentType: "application/gzip" }],
    });
    if (!r.ok) throw new Error(`Backup email failed: ${r.error}`);
  }
  return { destination: "email" as const, ref: to.map((e) => e.replace(/^(.{2})[^@]*/, "$1***")).join(", ") };
}

export type BackupDeliverer = (b: BackupFile, destination: "cloudinary" | "email") => Promise<{ destination: string; ref: string }>;
let deliverer: BackupDeliverer = (b, d) => (d === "cloudinary" ? uploadToCloudinary(b) : emailToOwners(b));
/** Tests: capture instead of uploading / emailing (null restores). */
export const setBackupDeliverer = (fn: BackupDeliverer | null) => {
  deliverer = fn ?? ((b, d) => (d === "cloudinary" ? uploadToCloudinary(b) : emailToOwners(b)));
};

/** Cron "backup": build and deliver. Throws on failure (recorded + alerted by the cron wrapper). */
export async function runBackup(now = new Date()) {
  const { backupDestination } = await getIntegration("monitoring");
  if (backupDestination === "off") return { skipped: "off" };
  const b = await buildBackup(now);
  const destination = backupDestination === "auto" ? (cloudinaryReady() ? "cloudinary" : "email") : backupDestination;
  try {
    const r = await deliverer(b, destination);
    await recordIntegration("backup", true);
    return { file: b.filename, bytes: b.bytes, sha256: b.sha256, tables: Object.keys(b.counts).length, rows: Object.values(b.counts).reduce((a, n) => a + n, 0), ...r };
  } catch (e) {
    await recordIntegration("backup", false, e instanceof Error ? e.message : String(e));
    throw e;
  }
}
