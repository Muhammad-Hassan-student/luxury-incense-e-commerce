import { createHash } from "node:crypto";

/*
 * Pure helpers for error capture: PII scrubbing and fingerprinting. No database, so tests can call them directly.
 * Scrubbing runs on everything stored (message, stack, route, meta) — errors from the browser are untrusted text and
 * server errors can echo customer input (emails in validation messages, tokens in URLs).
 */

// key=value secrets in URLs (?token=…) and in free text ("… token=abc123 …", "(code=…)").
const SECRET_PARAM = /((?:^|[?&;\s,(])(?:token|t|code|key|secret|password|pass|pwd|signature|sig|email|phone|callbackUrl|session|auth|otp)=)[^&#\s"')]*/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const KEYLIKE = /\b(?:sk|pk|rk|whsec|rzp|sk-ant|re|key)_(?:live|test)?_?[A-Za-z0-9-]{12,}\b/g;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const PHONE = /(?:\+\d{1,3}[ -]?)?(?:\(?\d{2,5}\)?[ -]?)\d{3,5}[ -]?\d{4,5}\b/g;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{32,}\b/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

/** Removes personal data and credentials from free text. Idempotent. */
export function scrub(input: string | null | undefined, max = 4000): string {
  if (!input) return "";
  let s = String(input).slice(0, max * 2);
  s = s.replace(SECRET_PARAM, "$1[redacted]");
  s = s.replace(BEARER, "$1 [redacted]");
  s = s.replace(JWT, "[jwt]");
  s = s.replace(KEYLIKE, "[key]");
  s = s.replace(EMAIL, "[email]");
  s = s.replace(CARD, (m) => (m.replace(/\D/g, "").length >= 13 ? "[number]" : m));
  s = s.replace(PHONE, (m) => (m.replace(/\D/g, "").length >= 10 ? "[phone]" : m));
  s = s.replace(IPV4, "[ip]");
  s = s.replace(LONG_TOKEN, (m) => (/^[a-z]+$/i.test(m) ? m : "[token]"));
  return s.slice(0, max);
}

/** Scrubs every string in a JSON-ish value (depth- and size-limited). Keys that look secret are dropped. */
export function scrubValue(v: unknown, depth = 0): unknown {
  if (v == null || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return scrub(v, 1000);
  if (depth > 3) return "[…]";
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrubValue(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 30)) {
      if (/pass|secret|token|cookie|authorization|session|card|cvv|embedding|face/i.test(k)) continue;
      out[k.slice(0, 60)] = scrubValue(val, depth + 1);
    }
    return out;
  }
  return String(v).slice(0, 200);
}

/** Route without query string, ids collapsed so /account/orders/MO-24001 and /…/MO-24002 group together. */
export function normalizeRoute(route: string | null | undefined) {
  if (!route) return null;
  let path = route;
  try {
    path = new URL(route, "http://x").pathname;
  } catch {
    path = route.split("?")[0];
  }
  return (
    path
      .split("/")
      .map((seg) => (/^\d+$/.test(seg) || /^[a-z0-9]{20,}$/i.test(seg) || /^[A-Z]{2,5}-\d{3,}$/.test(seg) || /[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) ? ":id" : seg))
      .join("/")
      .slice(0, 200) || "/"
  );
}

/** Message with volatile parts (numbers, ids, quoted values) replaced so repeats share one group. */
export function normalizeMessage(message: string) {
  return scrub(message, 500)
    .replace(/(["'`]).*?\1/g, "?")
    .replace(/\b[0-9a-f]{8,}\b/gi, "X")
    .replace(/\bc[a-z0-9]{20,}\b/g, "ID")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** First stack frame from our own code (not node_modules / framework), without line and column numbers. */
export function topFrame(stack: string | null | undefined) {
  if (!stack) return "";
  const lines = stack.split("\n").slice(1, 30);
  const frame = lines.find((l) => /\bat\b/.test(l) && !/node_modules|node:internal|next\/dist|webpack-internal:\/\/\/\(rsc\)\/\.\/node_modules/.test(l)) ?? lines[0] ?? "";
  return frame
    .trim()
    .replace(/:\d+:\d+\)?$/, "")
    .replace(/\?[^)\s]*/, "")
    .replace(/https?:\/\/[^/]+/, "")
    .replace(/\/_next\/static\/chunks\/[^/]+\.js/, "/_next/static/chunks/[chunk].js")
    .slice(0, 200);
}

export function fingerprint(e: { source: string; message: string; stack?: string | null; route?: string | null }) {
  const basis = [e.source, e.message.split("\n")[0] ? normalizeMessage(e.message.split("\n")[0]) : "", topFrame(e.stack), normalizeRoute(e.route) ?? ""].join("|");
  return createHash("sha1").update(basis).digest("hex");
}
