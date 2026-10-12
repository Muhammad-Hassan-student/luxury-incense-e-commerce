import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { SimpleEmail } from "@/emails/simple";
import { db } from "../db";
import { getIntegration } from "../integrations";
import { fingerprint, normalizeRoute, scrub, scrubValue } from "./scrub";

/*
 * In-house error monitoring: server errors (instrumentation.ts → onRequestError, plus `monitored()` around route
 * handlers / server actions), browser errors (POST /api/monitoring/report) and slow requests, grouped by fingerprint
 * into ErrorGroup + ErrorEvent. Cron runs and outside-service health are recorded here too. Alerts (email, optional
 * WhatsApp) go to the owners for a new error group, a regression, or a failing cron — throttled.
 *
 * Nothing in here may throw into the caller: monitoring must never break the request it is observing.
 */

export { scrub, scrubValue, fingerprint, normalizeRoute } from "./scrub";

/** Short commit sha of this deployment (Vercel / Render), else the package version. */
export const release = () => (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? "").slice(0, 7) || process.env.npm_package_version || "dev";

/** At most this many stored occurrences per group per hour (the counter keeps counting). */
const EVENTS_PER_GROUP_PER_HOUR = 20;

export type CaptureInput = {
  source: "server" | "client";
  error?: unknown;
  message?: string;
  stack?: string | null;
  route?: string | null;
  method?: string | null;
  meta?: Record<string, unknown>;
};

export type CaptureResult = { groupId: string; isNew: boolean; regressed: boolean; stored: boolean } | null;

function describe(input: CaptureInput) {
  const err = input.error;
  let message = input.message ?? "";
  let stack = input.stack ?? null;
  if (err instanceof Error) {
    message ||= `${err.name && err.name !== "Error" ? `${err.name}: ` : ""}${err.message}`;
    stack ??= err.stack ?? null;
  } else if (err !== undefined && !message) {
    message = typeof err === "string" ? err : (() => { try { return JSON.stringify(err); } catch { return String(err); } })();
  }
  const digest = err && typeof err === "object" && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  return { message: scrub(message || "Unknown error", 1000), stack: stack ? scrub(stack, 6000) : null, digest };
}

/** Records one error occurrence. Returns null if it could not be stored (never throws). */
export async function captureError(input: CaptureInput): Promise<CaptureResult> {
  try {
    const { message, stack, digest } = describe(input);
    // Next's own control-flow "errors" (redirect, notFound, forbidden) are not failures.
    if (digest && /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING)/.test(digest)) return null;
    const route = normalizeRoute(input.route ? scrub(input.route, 300) : null);
    const fp = fingerprint({ source: input.source, message, stack, route });
    const now = new Date();
    const rel = release();

    const existing = await db.errorGroup.findUnique({ where: { fingerprint: fp }, select: { id: true, status: true } });
    let groupId: string;
    let isNew = false;
    let regressed = false;
    if (!existing) {
      try {
        const g = await db.errorGroup.create({ data: { fingerprint: fp, source: input.source, message: message.split("\n")[0].slice(0, 500), route, release: rel, sampleStack: stack, firstSeenAt: now, lastSeenAt: now } });
        groupId = g.id;
        isNew = true;
      } catch {
        // Lost a race with another instance creating the same group.
        const g = await db.errorGroup.update({ where: { fingerprint: fp }, data: { count: { increment: 1 }, lastSeenAt: now, release: rel } });
        groupId = g.id;
      }
    } else {
      groupId = existing.id;
      // A resolved error that comes back is a regression: reopen it (ignored stays ignored).
      regressed = existing.status === "resolved";
      await db.errorGroup.update({
        where: { id: groupId },
        data: { count: { increment: 1 }, lastSeenAt: now, release: rel, ...(regressed ? { status: "open", resolvedAt: null, alertedAt: null, sampleStack: stack ?? undefined } : {}) },
      });
    }

    const recent = await db.errorEvent.count({ where: { groupId, createdAt: { gte: new Date(now.getTime() - 3600_000) } } });
    let stored = false;
    if (recent < EVENTS_PER_GROUP_PER_HOUR) {
      await db.errorEvent.create({
        data: { groupId, message: message.slice(0, 1000), stack, route, method: input.method?.slice(0, 10) ?? null, release: rel, meta: input.meta ? (scrubValue({ ...input.meta, digest }) as Prisma.InputJsonValue) : digest ? { digest } : undefined },
      });
      stored = true;
    }
    if (isNew || regressed) void alertErrorGroup(groupId, regressed).catch(() => {});
    return { groupId, isNew, regressed, stored };
  } catch (e) {
    console.error("[monitoring] could not record an error", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Requests slower than the configured threshold (default 3s). */
export async function recordSlow(route: string, durationMs: number, source: "server" | "client", method = "GET") {
  try {
    const { slowMs } = await getIntegration("monitoring");
    if (durationMs < slowMs) return false;
    await db.slowRequest.create({ data: { route: normalizeRoute(scrub(route, 300)) ?? "/", durationMs: Math.round(durationMs), source, method: method.slice(0, 10) } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wraps a route handler or server action: records slow calls and captures thrown errors (then rethrows, so
 * Next's own handling — and onRequestError — still apply; the fingerprint dedupes the double report).
 */
export function monitored<A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>, opts: { method?: string } = {}) {
  return async (...args: A): Promise<R> => {
    const t0 = performance.now();
    try {
      return await fn(...args);
    } catch (e) {
      if (!(e && typeof e === "object" && "digest" in e)) await captureError({ source: "server", error: e, route: name, method: opts.method ?? "ACTION" });
      throw e;
    } finally {
      const ms = performance.now() - t0;
      void recordSlow(name, ms, "server", opts.method ?? "ACTION");
    }
  };
}

// ─────────────────────────────── Integration health ───────────────────────────────

export type HealthProvider = "email" | "payments" | "courier" | "whatsapp" | "push" | "backup" | "ai";

/** One success / failure of an outside service. Cheap upsert; never throws. */
export async function recordIntegration(provider: HealthProvider | string, ok: boolean, error?: string | null) {
  try {
    const now = new Date();
    await db.integrationHealth.upsert({
      where: { provider },
      create: { provider, ...(ok ? { lastSuccessAt: now, successCount: 1 } : { lastFailureAt: now, failureCount: 1, lastError: scrub(error ?? "failed", 500) }) },
      update: ok ? { lastSuccessAt: now, successCount: { increment: 1 } } : { lastFailureAt: now, failureCount: { increment: 1 }, lastError: scrub(error ?? "failed", 500) },
    });
  } catch {
    /* table missing during a deploy, or DB down — nothing to do */
  }
}

// ─────────────────────────────── Cron runs ───────────────────────────────

/** Runs a cron job, recording start, duration and result. A failure is recorded, alerted and rethrown. */
export async function recordCronRun<T>(job: string, run: () => Promise<T>): Promise<T> {
  const started = new Date();
  const row = await db.cronRun.create({ data: { job, startedAt: started } }).catch(() => null);
  try {
    const result = await run();
    const durationMs = Date.now() - started.getTime();
    if (row) await db.cronRun.update({ where: { id: row.id }, data: { finishedAt: new Date(), durationMs, ok: true, result: scrubValue(result ?? null) as Prisma.InputJsonValue } }).catch(() => {});
    return result;
  } catch (e) {
    const durationMs = Date.now() - started.getTime();
    const message = scrub(e instanceof Error ? e.message : String(e), 1000);
    if (row) await db.cronRun.update({ where: { id: row.id }, data: { finishedAt: new Date(), durationMs, ok: false, error: message } }).catch(() => {});
    await captureError({ source: "server", error: e, route: `/api/cron/${job}`, method: "CRON" });
    await alertOwners(`cron:${job}`, `Scheduled job “${job}” failed`, `The ${job} job failed after ${Math.round(durationMs / 1000)}s: ${message}`, "/admin/health", 6 * 3600_000).catch(() => {});
    throw e;
  }
}

// ─────────────────────────────── Alerts ───────────────────────────────

const ALERT_KEY = "monitoring:alerts";
const MAX_ALERTS_PER_HOUR = 6;

/** Test hook: capture alerts instead of sending them. */
let alertSink: ((a: { key: string; subject: string; body: string; to: string[] }) => void) | null = null;
export const setAlertSink = (fn: typeof alertSink) => {
  alertSink = fn;
};

async function alertRecipients() {
  const c = await getIntegration("monitoring");
  const listed = c.alertEmails
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  if (listed.length) return listed.slice(0, 10);
  const owners = await db.user.findMany({ where: { role: "OWNER", email: { not: { endsWith: ".invalid" } } }, select: { email: true }, take: 10 });
  return owners.map((o) => o.email);
}

/**
 * Sends an owner alert unless the same `key` was alerted within `minGapMs`, or the hourly cap is reached.
 * Returns true when an alert went out.
 */
export async function alertOwners(key: string, subject: string, body: string, path = "/admin/health", minGapMs = 24 * 3600_000) {
  const c = await getIntegration("monitoring");
  if (!c.alertEmail && !c.alertWhatsApp && !alertSink) return false;
  const now = Date.now();
  // Throttle state lives in one Setting row; a lost update under a race only means one extra alert.
  const row = await db.setting.findUnique({ where: { key: ALERT_KEY } });
  const state = (row?.value && typeof row.value === "object" ? row.value : {}) as { sent?: number[]; keys?: Record<string, number> };
  const sent = (state.sent ?? []).filter((t) => now - t < 3600_000);
  const keys = Object.fromEntries(Object.entries(state.keys ?? {}).filter(([, t]) => now - t < 7 * 864e5));
  if (keys[key] && now - keys[key] < minGapMs) return false;
  if (sent.length >= MAX_ALERTS_PER_HOUR) return false;
  keys[key] = now;
  sent.push(now);
  await db.setting.upsert({ where: { key: ALERT_KEY }, create: { key: ALERT_KEY, value: { sent, keys } }, update: { value: { sent, keys } } });

  const to = await alertRecipients();
  if (alertSink) {
    alertSink({ key, subject, body, to });
    return true;
  }
  if (c.alertEmail && to.length) {
    const { sendEmail } = await import("../email");
    for (const addr of to) {
      await sendEmail({ to: addr, subject: `[Maison Oud alert] ${subject}`, react: SimpleEmail({ preview: subject, title: subject, body, cta: { label: "Open store health", path } }) }).catch(() => {});
    }
  }
  if (c.alertWhatsApp && c.alertPhone) {
    try {
      const { sendWhatsApp } = await import("../whatsapp/messages");
      await sendWhatsApp({ phone: c.alertPhone, kind: "ops_alert", consent: "reply", message: { type: "text", body: `Maison Oud alert: ${subject}\n${body}`.slice(0, 1000) } });
    } catch {
      /* best effort */
    }
  }
  return true;
}

async function alertErrorGroup(groupId: string, regressed: boolean) {
  const g = await db.errorGroup.findUnique({ where: { id: groupId } });
  if (!g || g.status === "ignored" || g.alertedAt) return;
  const sentNow = await alertOwners(
    `error:${g.fingerprint}`,
    regressed ? `Error is back: ${g.message.slice(0, 80)}` : `New error: ${g.message.slice(0, 80)}`,
    `${g.source === "client" ? "Browser" : "Server"} error${g.route ? ` on ${g.route}` : ""} (release ${g.release ?? "?"}): ${g.message}`,
    "/admin/health",
  );
  if (sentNow) await db.errorGroup.update({ where: { id: groupId }, data: { alertedAt: new Date() } });
}

// ─────────────────────────────── Housekeeping ───────────────────────────────

/** Daily: drop old occurrences, slow-request samples and cron rows. Groups are kept (they hold the counts). */
export async function pruneMonitoring(now = new Date()) {
  const days = (n: number) => new Date(now.getTime() - n * 864e5);
  const [events, slow, cron] = await Promise.all([
    db.errorEvent.deleteMany({ where: { createdAt: { lt: days(30) } } }),
    db.slowRequest.deleteMany({ where: { createdAt: { lt: days(14) } } }),
    db.cronRun.deleteMany({ where: { startedAt: { lt: days(60) } } }),
  ]);
  // Resolved / ignored groups with no activity for 90 days go too.
  const groups = await db.errorGroup.deleteMany({ where: { status: { in: ["resolved", "ignored"] }, lastSeenAt: { lt: days(90) } } });
  return { events: events.count, slow: slow.count, cron: cron.count, groups: groups.count };
}
