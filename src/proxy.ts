import { NextResponse, type NextRequest } from "next/server";
import { SW_CACHE_HEADER, swMayCachePage } from "@/lib/pwa/sw-mark";
import { CURRENCY_CODES } from "@/config/brand";
import { detectCurrency } from "@/lib/region-shared";
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type Locale } from "@/i18n/locales";
import { negotiateLocale } from "@/i18n/negotiate";

/** Set by the Auth.js adapter wrapper when step 1 succeeded but the second step (Face ID / phone lock) is still due. */
const PENDING_COOKIE = "mo_2step";
const STEP_TWO_PATHS = ["/signin/verify", "/signin/enroll"];

/**
 * 1. A visitor with a pending second step is sent to /signin/verify (UX only — the real gate is that a pending
 *    session reads as signed out everywhere, see src/server/security/adapter.ts).
 * 2. Remembers `?ref=CODE` for 30 days so the referral survives until sign-up.
 * 3. Affiliate links `?aff=CODE`: last click wins (always overwritten) with the click time, so the server can apply the
 *    configurable attribution window (src/server/affiliates.ts). A random device id helps flag self-orders.
 * 4. Marks catalogue pages rendered for visitors without a session as storable by the service worker (offline use).
 * 6. First visit: remembers the currency of the visitor's country (x-vercel-ip-country, else Accept-Language) in
 *    `mo_currency`. The server still checks it against the currencies the store has switched on (src/server/prefs.ts).
 * 5. Language (cookie `NEXT_LOCALE`, no URL prefixes): a first visit is negotiated from Accept-Language (country header
 *    as tie-breaker) and remembered; `?lang=xx` (the hreflang targets) switches and remembers too. The chosen locale is
 *    also written into this request's cookies so the very first render already uses it. The pathname is forwarded as
 *    `x-mo-pathname` for the root layout's hreflang links.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (request.cookies.has(PENDING_COOKIE) && !STEP_TWO_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/signin/verify";
    url.search = "";
    const back = `${pathname}${search}`;
    if (back !== "/" && !back.startsWith("/signin")) url.searchParams.set("callbackUrl", back);
    return NextResponse.redirect(url);
  }

  const lang = request.nextUrl.searchParams.get("lang");
  const current = request.cookies.get(LOCALE_COOKIE)?.value;
  let chosen: Locale | null = null;
  if (isLocale(lang) && lang !== current) chosen = lang;
  else if (!isLocale(current)) chosen = negotiateLocale(request.headers.get("accept-language"), request.headers.get("x-vercel-ip-country"));
  if (chosen) request.cookies.set(LOCALE_COOKIE, chosen);
  const forwarded = new Headers(request.headers);
  forwarded.set("x-mo-pathname", pathname);

  const ref = request.nextUrl.searchParams.get("ref");
  const res = NextResponse.next({ request: { headers: forwarded } });
  if (chosen) res.cookies.set(LOCALE_COOKIE, chosen, { sameSite: "lax", maxAge: LOCALE_COOKIE_MAX_AGE, path: "/" });
  if (ref && /^[a-z0-9]{10,40}$/i.test(ref) && !request.cookies.has("mo_ref")) {
    res.cookies.set("mo_ref", ref, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30, path: "/" });
  }
  const aff = request.nextUrl.searchParams.get("aff");
  if (aff && /^[a-z0-9]{4,20}$/i.test(aff)) {
    const secure = process.env.NODE_ENV === "production";
    res.cookies.set("mo_aff", `${aff.toUpperCase()}.${Date.now()}`, { httpOnly: true, sameSite: "lax", secure, maxAge: 60 * 60 * 24 * 90, path: "/" });
    if (!request.cookies.has("mo_did")) res.cookies.set("mo_did", crypto.randomUUID(), { httpOnly: true, sameSite: "lax", secure, maxAge: 60 * 60 * 24 * 365, path: "/" });
  }
  if (!request.cookies.has("mo_currency")) {
    const geo = detectCurrency({ country: request.headers.get("x-vercel-ip-country"), acceptLanguage: request.headers.get("accept-language") }, CURRENCY_CODES);
    if (geo) res.cookies.set("mo_currency", geo, { maxAge: 60 * 60 * 24 * 365, path: "/", sameSite: "lax" });
  }
  if (swMayCachePage(pathname, request.cookies.getAll().map((c) => c.name), request.nextUrl.searchParams)) res.headers.set(SW_CACHE_HEADER, "public");
  return res;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
