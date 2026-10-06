// Local Postgres without Docker. Data lives in ./.pgdata (gitignored).
// Usage: npm run db:start   (keep running in its own terminal)
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";

const dataDir = new URL("../.pgdata", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "maison",
  password: "maison",
  port: 54329,
  persistent: true,
  // Force UTF-8; on Windows initdb otherwise inherits WIN1252 and rejects ₹, Arabic, etc.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

if (!existsSync(dataDir)) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase("maison_oud");
} catch {
  /* already exists */
}
console.log("Postgres ready: postgresql://maison:maison@localhost:54329/maison_oud");

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
