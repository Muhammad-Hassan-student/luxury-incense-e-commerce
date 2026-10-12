/*
 * Which HTML responses the service worker may keep for offline use (src/lib/pwa/sw-source.ts only stores pages that
 * carry `x-sw-cache: public`). The proxy marks catalogue pages for visitors WITHOUT a session — a signed-in
 * customer's pages (name, trade prices, wishlist state) are never marked, so they never reach Cache Storage.
 */

export const SW_CACHE_HEADER = "x-sw-cache";

const CATALOGUE = ["/shop", "/product/", "/collections", "/journal", "/ritual", "/gifts"];

export function isCataloguePath(pathname: string) {
  if (pathname === "/") return true;
  return CATALOGUE.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
}

/** True when the response for this request may be marked public for the service worker. */
export function swMayCachePage(pathname: string, cookieNames: string[], params: URLSearchParams) {
  if (!isCataloguePath(pathname)) return false;
  // Auth.js session cookies (authjs.session-token, __Secure-…) and the pending second-step marker.
  if (cookieNames.some((n) => /session-token|^mo_2step$/i.test(n))) return false;
  // Links that set cookies (referral / affiliate) or carry tokens are never stored.
  for (const k of ["ref", "aff", "token", "t", "code", "email", "callbackUrl"]) if (params.has(k)) return false;
  return true;
}
