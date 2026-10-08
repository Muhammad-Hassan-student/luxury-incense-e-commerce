import "server-only";

/**
 * Local development only: when no email provider is configured, remember the most recent
 * magic link so the sign-in page can show it. Never used in production or once Resend is set up.
 */
type Entry = { email: string; url: string; at: number };
const store = globalThis as unknown as { __moDevMagicLink?: Entry };

export const devMagicLinksEnabled = () =>
  process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY && !(process.env.SMTP_USER && process.env.SMTP_PASSWORD);

export function rememberDevMagicLink(email: string, url: string) {
  if (devMagicLinksEnabled()) store.__moDevMagicLink = { email, url, at: Date.now() };
}

export function latestDevMagicLink(): Entry | null {
  if (!devMagicLinksEnabled()) return null;
  const e = store.__moDevMagicLink;
  return e && Date.now() - e.at < 15 * 60 * 1000 ? e : null;
}
