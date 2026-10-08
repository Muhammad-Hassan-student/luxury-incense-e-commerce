import "server-only";

/** Tunables for the second sign-in step. Kept in one place so tests and docs can point at them. */
export const SECOND_STEP = {
  /** A step-1 session waiting for the second step lives this long (and so does its ticket). */
  pendingMs: 5 * 60_000,
  ticketMs: 5 * 60_000,
  challengeMs: 5 * 60_000,
  codeMs: 10 * 60_000,
  codeMaxAttempts: 5,
  enrollLinkMs: 30 * 60_000,
  maxFaces: 3,
  maxWrongTries: 5,
  lockMs: 15 * 60_000,
  /** Cosine similarity needed for a frame to match a saved face (SFace; OpenCV's own default is 0.363). */
  faceThreshold: 0.42,
  /** Liveness: the last frame's face must be at least this much bigger than the first. */
  minZoom: 1.08,
  /** Faces narrower than this share of the frame are "too far" for a reliable check. */
  minFaceSize: 0.12,
  sessionMaxAgeSec: 60 * 60 * 24 * 30,
} as const;

/** httpOnly cookie that carries the pending step-1 session token to /signin/verify. */
export const PENDING_COOKIE = "mo_2step";
export const SESSION_COOKIES = ["__Secure-authjs.session-token", "authjs.session-token"] as const;

/**
 * Origins allowed to run WebAuthn / call the security endpoints: NEXT_PUBLIC_SITE_URL plus the comma list in
 * WEBAUTHN_ORIGINS, and http://localhost:3000 outside production. The WebAuthn rpId is always the origin's hostname.
 */
export function allowedOrigins(): string[] {
  const list = new Set<string>();
  const add = (raw: string | undefined) => {
    if (!raw) return;
    try {
      const u = new URL(raw.trim());
      if (u.protocol === "https:" || u.hostname === "localhost") list.add(u.origin);
    } catch {
      /* ignore malformed entries */
    }
  };
  add(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
  for (const o of (process.env.WEBAUTHN_ORIGINS ?? "").split(",")) add(o);
  if (process.env.NODE_ENV !== "production") add("http://localhost:3000");
  return [...list];
}

export const primaryOrigin = () => allowedOrigins()[0] ?? "http://localhost:3000";

export function isAllowedOrigin(origin: string | null | undefined): origin is string {
  return Boolean(origin && allowedOrigins().includes(origin));
}

export const rpIdOf = (origin: string) => new URL(origin).hostname;

/** Origins that belong to one rpId (used as WebAuthn expectedOrigin). */
export const originsForRpId = (rpId: string) => allowedOrigins().filter((o) => rpIdOf(o) === rpId);

/** Best-effort origin of the current request from Host / X-Forwarded-*; falls back to the primary origin. */
export function originFromHeaders(h: Headers): string {
  const origin = h.get("origin");
  if (isAllowedOrigin(origin)) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const candidate = host ? `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}` : null;
  return isAllowedOrigin(candidate) ? candidate : primaryOrigin();
}
