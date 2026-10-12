import type { Instrumentation } from "next";

/**
 * Server error capture for the in-house monitor (src/server/monitoring). Every uncaught error in a Server Component
 * render, route handler, server action or the proxy lands in ErrorGroup / ErrorEvent, scrubbed of personal data.
 * Request headers (cookies, auth) are deliberately not stored — only the path and method.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { captureError } = await import("./server/monitoring");
    await captureError({
      source: "server",
      error: err,
      // Group by the route file (/product/[slug]) rather than each concrete URL.
      route: context.routePath || request.path,
      method: request.method,
      meta: { path: request.path.split("?")[0], routeType: context.routeType, renderSource: (context as { renderSource?: string }).renderSource ?? null },
    });
  } catch {
    // Monitoring must never turn one error into two.
  }
};

/**
 * Boot: load the store region and exchange rates before the first request, so every formatMoney() — including in
 * route handlers, emails and crons — uses the configured base currency (src/server/region.ts, src/lib/money.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { primeMoney } = await import("./server/region");
    await primeMoney();
  } catch (e) {
    console.error("[region] could not load currency settings at boot — using defaults until the next request", e);
  }
}
