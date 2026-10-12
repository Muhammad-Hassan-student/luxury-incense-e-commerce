import { serviceWorkerSource } from "@/lib/pwa/sw-source";

// Built once per deployment (the version changes with every commit, which is what makes browsers update the worker).
export const dynamic = "force-static";

const version = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? process.env.BUILD_ID ?? "local").slice(0, 12);

export function GET() {
  const dev = process.env.NODE_ENV !== "production";
  return new Response(serviceWorkerSource(dev ? "dev" : version, { dev }), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Browsers must always revalidate the worker itself so a deploy reaches everyone on their next visit.
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'",
    },
  });
}
