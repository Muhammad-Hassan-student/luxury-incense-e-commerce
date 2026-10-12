import "server-only";
import vercelConfig from "../../../vercel.json";
import { db } from "../db";
import { release } from "./index";

/* Read models for /admin/health and /api/health. */

/** Scheduled jobs from vercel.json (so the page follows whatever is deployed). */
export function scheduledJobs(): { job: string; schedule: string }[] {
  const crons = (vercelConfig as { crons?: { path: string; schedule: string }[] }).crons ?? [];
  return crons.filter((c) => c.path.startsWith("/api/cron/")).map((c) => ({ job: c.path.slice("/api/cron/".length), schedule: c.schedule }));
}

/** Public, cheap: DB round-trip time and the deployed version. Never leaks anything else. */
export async function publicHealth() {
  const t0 = performance.now();
  let dbOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return { ok: dbOk, db: dbOk ? "up" : "down", dbMs: Math.round(performance.now() - t0), version: release(), time: new Date().toISOString() };
}

export type ErrorFilter = "open" | "resolved" | "ignored" | "all";

export async function errorGroups(filter: ErrorFilter = "open", take = 50) {
  return db.errorGroup.findMany({
    where: filter === "all" ? {} : { status: filter },
    orderBy: { lastSeenAt: "desc" },
    take,
    select: { id: true, source: true, message: true, route: true, status: true, count: true, firstSeenAt: true, lastSeenAt: true, release: true, sampleStack: true },
  });
}

export async function errorGroupDetail(id: string) {
  return db.errorGroup.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: "desc" }, take: 10 } } });
}

/** Slowest routes over the last 7 days (count, p50-ish average and max). */
export async function slowRoutes(days = 7) {
  const since = new Date(Date.now() - days * 864e5);
  const rows = await db.slowRequest.groupBy({
    by: ["route", "source"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    _avg: { durationMs: true },
    _max: { durationMs: true, createdAt: true },
    orderBy: { _count: { route: "desc" } },
    take: 15,
  });
  return rows.map((r) => ({ route: r.route, source: r.source, count: r._count._all, avgMs: Math.round(r._avg.durationMs ?? 0), maxMs: r._max.durationMs ?? 0, lastAt: r._max.createdAt }));
}

/** Last run of every known job (+ any job seen in CronRun), flagged late when older than ~a day. */
export async function cronStatus() {
  const known = scheduledJobs();
  const seen = await db.cronRun.findMany({ distinct: ["job"], select: { job: true } });
  const names = [...new Set([...known.map((k) => k.job), ...seen.map((s) => s.job)])];
  const last = await Promise.all(names.map((job) => db.cronRun.findFirst({ where: { job }, orderBy: { startedAt: "desc" } })));
  const failures = await db.cronRun.groupBy({ by: ["job"], where: { ok: false, startedAt: { gte: new Date(Date.now() - 7 * 864e5) } }, _count: { _all: true } });
  return names.map((job, i) => {
    const run = last[i];
    const schedule = known.find((k) => k.job === job)?.schedule ?? null;
    const late = Boolean(schedule) && (!run || Date.now() - run.startedAt.getTime() > 26 * 3600_000);
    return {
      job,
      schedule,
      lastRunAt: run?.startedAt ?? null,
      durationMs: run?.durationMs ?? null,
      ok: run ? run.ok : null,
      running: Boolean(run && run.ok === null && !run.finishedAt),
      error: run?.error ?? null,
      failures7d: failures.find((f) => f.job === job)?._count._all ?? 0,
      late,
    };
  });
}

/** Outside services: recorded results (IntegrationHealth) merged with what the data itself shows. */
export async function integrationStatus() {
  const recorded = await db.integrationHealth.findMany();
  const rec = (p: string) => recorded.find((r) => r.provider === p);
  const [payOk, payFail, waOk, waFail, shipSync, courierRun] = await Promise.all([
    db.payment.findFirst({ where: { status: "CAPTURED", provider: { in: ["STRIPE", "RAZORPAY"] } }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    db.payment.findFirst({ where: { status: "FAILED", provider: { in: ["STRIPE", "RAZORPAY"] } }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true, raw: true } }),
    db.whatsAppMessage.findFirst({ where: { direction: "out", status: { in: ["SENT", "DELIVERED", "READ"] }, test: false }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    db.whatsAppMessage.findFirst({ where: { direction: "out", status: "FAILED" }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true, error: true } }),
    db.shipment.findFirst({ where: { lastSyncedAt: { not: null }, provider: { not: "mock" } }, orderBy: { lastSyncedAt: "desc" }, select: { lastSyncedAt: true } }),
    db.cronRun.findFirst({ where: { job: "courier-sync", ok: false }, orderBy: { startedAt: "desc" }, select: { startedAt: true, error: true } }),
  ]);
  const max = (...d: (Date | null | undefined)[]) => d.filter((x): x is Date => Boolean(x)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const row = (provider: string, label: string, success: Date | null, failure: Date | null, error: string | null) => ({
    provider,
    label,
    lastSuccessAt: success,
    lastFailureAt: failure,
    lastError: error,
    state: !success && !failure ? "unknown" : failure && (!success || failure > success) ? "failing" : "ok",
  });
  return [
    row("email", "Email", rec("email")?.lastSuccessAt ?? null, rec("email")?.lastFailureAt ?? null, rec("email")?.lastError ?? null),
    row("payments", "Payments (Stripe / Razorpay)", max(payOk?.updatedAt, rec("payments")?.lastSuccessAt), max(payFail?.updatedAt, rec("payments")?.lastFailureAt), rec("payments")?.lastError ?? (payFail ? "A payment failed (see the order)" : null)),
    row("courier", "Courier (Shiprocket)", max(shipSync?.lastSyncedAt, rec("courier")?.lastSuccessAt), max(courierRun?.startedAt, rec("courier")?.lastFailureAt), courierRun?.error ?? rec("courier")?.lastError ?? null),
    row("whatsapp", "WhatsApp", max(waOk?.updatedAt, rec("whatsapp")?.lastSuccessAt), max(waFail?.updatedAt, rec("whatsapp")?.lastFailureAt), waFail?.error ?? rec("whatsapp")?.lastError ?? null),
    row("push", "Web push", rec("push")?.lastSuccessAt ?? null, rec("push")?.lastFailureAt ?? null, rec("push")?.lastError ?? null),
    row("backup", "Backups", rec("backup")?.lastSuccessAt ?? null, rec("backup")?.lastFailureAt ?? null, rec("backup")?.lastError ?? null),
  ];
}

/** Database size and approximate live rows per table (pg statistics — no full counts on big tables). */
export async function databaseStats() {
  const [size] = await db.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database()) AS bytes`;
  const tables = await db.$queryRaw<{ name: string; rows: bigint; bytes: bigint }[]>`
    SELECT relname AS name, n_live_tup AS rows, pg_total_relation_size(relid) AS bytes
    FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(relid) DESC LIMIT 40`;
  return { bytes: Number(size?.bytes ?? 0), tables: tables.map((t) => ({ name: t.name, rows: Number(t.rows), bytes: Number(t.bytes) })) };
}

export async function healthKpis() {
  const dayAgo = new Date(Date.now() - 864e5);
  const [openErrors, newToday, cronFailures, lastBackup] = await Promise.all([
    db.errorGroup.count({ where: { status: "open" } }),
    db.errorGroup.count({ where: { firstSeenAt: { gte: dayAgo } } }),
    db.cronRun.count({ where: { ok: false, startedAt: { gte: dayAgo } } }),
    db.cronRun.findFirst({ where: { job: "backup", ok: true }, orderBy: { startedAt: "desc" }, select: { startedAt: true, result: true } }),
  ]);
  return { openErrors, newToday, cronFailures, lastBackup };
}
