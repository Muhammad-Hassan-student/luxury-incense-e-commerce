// Seeds a fresh database once. The seed upserts (and so overwrites admin edits),
// so deploys must not re-run it against a store that already has a catalog.
import { execSync } from "node:child_process";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM "Category"');
await client.end();

if (rows[0].n > 0) {
  console.log(`Catalog present (${rows[0].n} categories) — skipping seed.`);
} else {
  console.log("Empty database — seeding.");
  execSync("npx prisma db seed", { stdio: "inherit" });
}
