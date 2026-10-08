// Makes sure the local Postgres (scripts/dev-db.mjs) is running, starting it as a detached
// background process if needed. Runs automatically before `npm run dev`. Log: .tmp/db.log
import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const PORT = 54329;
// After an unclean shutdown (PC restart, killed process) Postgres fsyncs its data directory before
// answering, which took ~2.5 minutes here, so allow a generous wait.
const WAIT_SECONDS = 360;
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const portOpen = () =>
  new Promise((resolve) => {
    const socket = net.connect({ port: PORT, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

// The port opens before Postgres can answer (e.g. during crash recovery), so readiness means a real query.
const isUp = async () => {
  if (!(await portOpen())) return false;
  const client = new pg.Client({ connectionString: `postgresql://maison:maison@127.0.0.1:${PORT}/maison_oud`, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
};

if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes(`:${PORT}/`)) {
  // Pointing at some other database (e.g. Docker or a hosted one): nothing to do.
  process.exit(0);
}

if (await isUp()) {
  console.log(`✓ Postgres already running on :${PORT}`);
  process.exit(0);
}
if (await portOpen()) {
  // Already started but still recovering/booting: just wait for it.
  process.stdout.write(`… Postgres on :${PORT} is starting up`);
  for (let i = 0; i < WAIT_SECONDS; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isUp()) {
      console.log("\n✓ Postgres ready");
      process.exit(0);
    }
    process.stdout.write(".");
  }
  console.error("\n✗ Postgres is not answering after 6 minutes — see .tmp/db.log");
  process.exit(1);
}

mkdirSync(path.join(root, ".tmp"), { recursive: true });
const log = openSync(path.join(root, ".tmp", "db.log"), "a");
const child = spawn(process.execPath, [path.join(root, "scripts", "dev-db.mjs")], {
  cwd: root,
  detached: true,
  windowsHide: true,
  stdio: ["ignore", log, log],
  env: { ...process.env, TEMP: path.join(root, ".tmp"), TMP: path.join(root, ".tmp") },
});
child.unref();

process.stdout.write(`… starting Postgres on :${PORT} (after a restart, recovery can take a few minutes)`);
for (let i = 0; i < WAIT_SECONDS; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  if (await isUp()) {
    console.log(`\n✓ Postgres ready (pid ${child.pid}; log in .tmp/db.log)`);
    process.exit(0);
  }
  process.stdout.write(".");
}
console.error("\n✗ Postgres didn't start within 6 minutes — see .tmp/db.log");
process.exit(1);
