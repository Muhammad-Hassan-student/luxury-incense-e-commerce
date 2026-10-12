/**
 * Sign-in links are single use. Mail apps and link scanners (Gmail's in-app browser, Outlook Safe Links, …) often open
 * a link once before the person does, which used up the token and showed "This link has expired". So the email links to
 * a harmless confirm page (`/signin/confirm?u=…`) and only a tap on its button opens the real Auth.js callback.
 */

export const CONFIRM_PATH = "/signin/confirm";
const CALLBACK_PATH = "/api/auth/callback/resend";

/** Wraps Auth.js's callback URL into the confirm page on the same origin. */
export function wrapMagicLink(callbackUrl: string): string {
  const u = new URL(callbackUrl);
  return `${u.origin}${CONFIRM_PATH}?u=${encodeURIComponent(callbackUrl)}`;
}

export type ConfirmTarget = { href: string; email: string; token: string };

/**
 * Accepts only our own magic-link callback (same origin as the request, exact callback path, token + email present) —
 * never an arbitrary URL, so the confirm page can't be used as an open redirect.
 */
export function parseConfirmTarget(raw: string | null | undefined, origin: string): ConfirmTarget | null {
  if (!raw || raw.length > 4000) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  let expected: URL;
  try {
    expected = new URL(origin);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.origin !== expected.origin || u.pathname !== CALLBACK_PATH) return null;
  if (u.username || u.password) return null;
  const token = u.searchParams.get("token");
  const email = u.searchParams.get("email");
  if (!token || !/^[A-Za-z0-9_-]{16,256}$/.test(token) || !email || email.length > 254 || !email.includes("@")) return null;
  // A relative, same-site callbackUrl only (Auth.js validates it again, this keeps the button honest).
  const next = u.searchParams.get("callbackUrl");
  if (next) {
    try {
      if (new URL(next, expected.origin).origin !== expected.origin) return null;
    } catch {
      return null;
    }
  }
  return { href: u.toString(), email: email.toLowerCase(), token };
}
