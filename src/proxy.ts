import { NextResponse, type NextRequest } from "next/server";

/** Remembers `?ref=CODE` for 30 days so the referral survives until sign-up. */
export function proxy(request: NextRequest) {
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
