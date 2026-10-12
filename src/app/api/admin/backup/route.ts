import { getAccess } from "@/server/roles";
import { audit } from "@/server/audit";
import { rateLimit } from "@/server/rate-limit";
import { buildBackup } from "@/server/backup";

/** "Download backup now" on Admin → Health. Owners only; every download is audited. */
export async function GET() {
  const access = await getAccess();
  if (!access || access.role !== "OWNER") return new Response("Owners only", { status: 403 });
  if (!(await rateLimit(`backup-download:${access.id}`, 5, 3600)).ok) return new Response("Too many backups — try again later.", { status: 429 });
  const b = await buildBackup();
  await audit(access.id, "backup.download", "Backup", b.filename, { bytes: b.bytes, sha256: b.sha256, tables: Object.keys(b.counts).length });
  return new Response(new Uint8Array(b.gz), {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${b.filename}"`,
      "Content-Length": String(b.bytes),
      "Cache-Control": "no-store",
      "X-Backup-Sha256": b.sha256,
    },
  });
}
