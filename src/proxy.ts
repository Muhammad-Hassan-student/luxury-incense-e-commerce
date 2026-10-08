import { NextResponse, type NextRequest } from "next/server";

/** Set by the Auth.js adapter wrapper when step 1 succeeded but the second step (Face ID / phone lock) is still due. */
const PENDING_COOKIE = "mo_2step";
const STEP_TWO_PATHS = ["/signin/verify", "/signin/enroll"];

/**
 * 1. A visitor with a pending second step is sent to /signin/verify (UX only — the real gate is that a pending
 *    session reads as signed out everywhere, see src/server/security/adapter.ts).
 * 2. Remembers `?ref=CODE` for 30 days so the referral survives until sign-up.
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

  const ref = request.nextUrl.searchParams.get("ref");
  const res = NextResponse.next();
  if (ref && /^[a-z0-9]{10,40}$/i.test(ref) && !request.cookies.has("mo_ref")) {
    res.cookies.set("mo_ref", ref, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30, path: "/" });
  }
  return res;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
