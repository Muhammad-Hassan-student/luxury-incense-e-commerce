// Restores a Maison Oud backup (.json.gz from the daily backup / Admin → Health → Download backup) into a database.
//
//   npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/restore-backup.ts <file.json.gz>            # dry run: shows what is inside
//   DATABASE_URL=postgres://…new-db… npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/restore-backup.ts <file> --apply
//
// Steps for a full restore: create an empty database, run `npx prisma migrate deploy` against it, then run this with
// --apply. Rows are inserted table by table in dependency order with skipDuplicates, so a re-run is harmless.
// Refuses to write into a database that already has orders unless --force is given.
// Not in a backup (by design): sessions/sign-in data, passkeys, face templates, API keys and gift card codes — customers
// sign in again with a magic link, staff re-enter integration keys, and gift cards are restored with placeholder codes
// (RESTORED-<id>) that must be re-issued to their holders.
import "./no-real-email";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

export {};

async function main() {
  const file = process.argv[2];
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");
  if (!file) throw new Error("Usage: restore-backup.ts <backup.json.gz> [--apply] [--force]");
  const data = JSON.parse(gunzipSync(await readFile(file)).toString("utf8")) as { format: string; version: number; createdAt: string; release: string; tables: Record<string, Record<string, unknown>[]> };
  if (data.format !== "maison-oud-backup") throw new Error("Not a Maison Oud backup file.");
  console.log(`Backup from ${data.createdAt} (release ${data.release}), format v${data.version}`);
  for (const [t, rows] of Object.entries(data.tables)) console.log(`  ${t.padEnd(22)} ${rows.length}`);
  if (!apply) {
    console.log("\nDry run. Add --apply to insert into DATABASE_URL.");
    return;
  }
  await import("dotenv/config");
  const { db } = await import("@/server/db");
  const existing = await db.order.count();
  if (existing > 0 && !force) throw new Error(`Target database already has ${existing} orders. Restore into an empty database (or pass --force to merge).`);
  for (const [model, rows] of Object.entries(data.tables)) {
    const delegate = (db as unknown as Record<string, { createMany?: (a: unknown) => Promise<{ count: number }> }>)[model];
    if (!delegate?.createMany) {
      console.warn(`  skip ${model}: not in this schema`);
      continue;
    }
    const prepared = model === "giftCard" ? rows.map((r) => ({ ...r, code: `RESTORED-${String(r.id)}` })) : rows;
    let inserted = 0;
    for (let i = 0; i < prepared.length; i += 500) inserted += (await delegate.createMany({ data: prepared.slice(i, i + 500), skipDuplicates: true })).count;
    console.log(`  ✓ ${model}: ${inserted}/${rows.length}`);
  }
  console.log("\nDone. Reset sequences if you add rows by hand: SELECT setval(pg_get_serial_sequence('\"SupportTicket\"','number'), (SELECT MAX(number) FROM \"SupportTicket\"));");
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
