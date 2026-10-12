/*
 * Browser error + slow-page reporter for the in-house monitor. Sends at most a handful of reports per page load to
 * POST /api/monitoring/report (rate-limited and PII-scrubbed again on the server). Noise from extensions and
 * cross-origin scripts is dropped here.
 */

const ENDPOINT = "/api/monitoring/report";
const MAX_PER_PAGE = 5;
let sentCount = 0;
const seen = new Set<string>();

const NOISE = [/^Script error\.?$/i, /ResizeObserver loop/i, /extension:\/\//i, /^Non-Error promise rejection captured/i, /Load failed$/i, /NetworkError when attempting to fetch/i, /^AbortError/i, /The user aborted a request/i];

function send(payload: Record<string, unknown>) {
  try {
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
    void fetch(ENDPOINT, { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
  } catch {
    /* never throw from the reporter */
  }
}

function report(kind: "error" | "unhandledrejection", message: string, stack?: string | null) {
  if (sentCount >= MAX_PER_PAGE) return;
  if (!message || NOISE.some((r) => r.test(message)) || (stack && /(chrome|moz|safari(-web)?)-extension:\/\//.test(stack))) return;
  const key = `${message}|${(stack ?? "").split("\n")[1] ?? ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  sentCount++;
  send({ type: "error", kind, message: message.slice(0, 1000), stack: stack?.slice(0, 6000) ?? null, route: location.pathname });
}

try {
  window.addEventListener("error", (e) => {
    const err = e.error as Error | undefined;
    report("error", err?.message ? `${err.name && err.name !== "Error" ? `${err.name}: ` : ""}${err.message}` : e.message, err?.stack ?? (e.filename ? `at ${e.filename}:${e.lineno}:${e.colno}` : null));
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as unknown;
    const message = r instanceof Error ? `${r.name && r.name !== "Error" ? `${r.name}: ` : ""}${r.message}` : typeof r === "string" ? r : "Unhandled promise rejection";
    report("unhandledrejection", message, r instanceof Error ? r.stack : null);
  });

  // Slow server responses as the browser saw them (time to first byte of the document).
  window.addEventListener("load", () => {
    setTimeout(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (!nav) return;
      const ttfb = nav.responseStart - nav.requestStart;
      if (ttfb > 3000 && ttfb < 120_000) send({ type: "slow", route: location.pathname, durationMs: Math.round(ttfb) });
    }, 0);
  });
} catch {
  /* old browsers */
}
