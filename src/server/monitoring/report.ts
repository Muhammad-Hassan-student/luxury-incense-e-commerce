import "server-only";
import { z } from "zod";
import { db } from "../db";
import { captureError, recordSlow } from "./index";

/* Browser reports (POST /api/monitoring/report): validated, limited, then captured like server errors. */

const reportSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("error"),
    kind: z.enum(["error", "unhandledrejection"]).default("error"),
    message: z.string().trim().min(1).max(1000),
    stack: z.string().max(6000).nullish(),
    route: z.string().max(300).default("/"),
  }),
  z.object({ type: z.literal("slow"), route: z.string().max(300), durationMs: z.number().int().min(0).max(600_000) }),
]);

export const MAX_REPORT_BYTES = 16 * 1024;
/** Whole-store ceiling on stored browser events per hour (a broken deploy must not fill the database). */
const CLIENT_EVENTS_PER_HOUR = 500;

const windows = new Map<string, { count: number; resetAt: number }>();

/** In-process fixed window (per server instance), used on top of the shared rateLimit(). */
export function takeToken(key: string, limit: number, windowMs: number, now = Date.now()) {
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    if (windows.size > 5000) for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
    return true;
  }
  w.count++;
  return w.count <= limit;
}

export type ReportOutcome = "stored" | "counted" | "limited" | "invalid" | "slow" | "ignored";

export async function acceptClientReport(raw: unknown, ip: string): Promise<ReportOutcome> {
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) return "invalid";
  if (!takeToken(`client-report:${ip}`, 20, 5 * 60_000)) return "limited";
  const r = parsed.data;
  if (r.type === "slow") return (await recordSlow(r.route, r.durationMs, "client", "GET")) ? "slow" : "ignored";
  const recent = await db.errorEvent.count({ where: { createdAt: { gte: new Date(Date.now() - 3600_000) }, group: { source: "client" } } });
  if (recent >= CLIENT_EVENTS_PER_HOUR) return "limited";
  const res = await captureError({ source: "client", message: r.message, stack: r.stack ?? null, route: r.route, method: "GET", meta: { kind: r.kind } });
  return res?.stored ? "stored" : "counted";
}
