import { rateLimit } from "@/server/rate-limit";
import { acceptClientReport, MAX_REPORT_BYTES } from "@/server/monitoring/report";

/** Browser error / slow-page reports from src/instrumentation-client.ts. Same-origin only, rate-limited, scrubbed. */
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host) {
    let same = false;
    try {
      same = new URL(origin).host === host;
    } catch {
      same = false;
    }
    if (!same) return new Response(null, { status: 403 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_REPORT_BYTES) return new Response(null, { status: 413 });
  if (!(await rateLimit("client-error", 30, 300)).ok) return new Response(null, { status: 429 });
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_REPORT_BYTES) return new Response(null, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const outcome = await acceptClientReport(body, ip);
  return new Response(null, { status: outcome === "invalid" ? 400 : outcome === "limited" ? 429 : 204, headers: { "Cache-Control": "no-store" } });
}
