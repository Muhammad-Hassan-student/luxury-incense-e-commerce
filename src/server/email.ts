import "server-only";
import type { ReactElement } from "react";
import { render } from "@react-email/components";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import { env } from "@/env";
import { getIntegration } from "./integrations";

export type EmailResult = { ok: true; via: "smtp" | "resend" | "dev" } | { ok: false; error: string };

type Transport =
  | { kind: "smtp"; from: string; send: (m: { to: string; subject: string; html: string; headers?: Record<string, string> }) => Promise<void> }
  | { kind: "resend"; from: string; client: Resend }
  | { kind: "dev" };

// Transports are rebuilt only when the saved credentials change (Admin → Integrations).
let memo: { sig: string; t: Transport } | null = null;

async function transport(): Promise<Transport> {
  // Test scripts set this: saved credentials in the database must never send real mail from a test run.
  if (process.env.EMAIL_TRANSPORT === "log") return { kind: "dev" };
  const c = await getIntegration("email");
  const smtp = Boolean(c.smtpUser && c.smtpPassword);
  const resend = Boolean(c.resendApiKey);
  // RESEND_ENABLED=true → Resend; otherwise SMTP. Each falls back to the other only if it isn't configured at all,
  // so a missing key never silences sign-in links.
  const kind = env.RESEND_ENABLED ? (resend ? "resend" : smtp ? "smtp" : "dev") : smtp ? "smtp" : resend ? "resend" : "dev";
  // Gmail rewrites any other From to the account itself, so default it to the SMTP user.
  const from = c.from || (kind === "smtp" ? `Maison Oud <${c.smtpUser}>` : "Maison Oud <onboarding@resend.dev>");
  const sig = JSON.stringify([kind, c.smtpHost, c.smtpPort, c.smtpUser, c.smtpPassword, c.resendApiKey, from]);
  if (memo?.sig === sig) return memo.t;
  let t: Transport = { kind: "dev" };
  if (kind === "smtp") {
    const tx = nodemailer.createTransport({ host: c.smtpHost, port: c.smtpPort, secure: c.smtpPort === 465, auth: { user: c.smtpUser, pass: c.smtpPassword } });
    t = { kind, from, send: async (m) => void (await tx.sendMail({ from, ...m })) };
  } else if (kind === "resend") {
    t = { kind, from, client: new Resend(c.resendApiKey) };
  }
  memo = { sig, t };
  return t;
}

/** True when real email delivery is configured (saved in Admin → Integrations or via env). */
export async function emailConfigured() {
  return (await transport()).kind !== "dev";
}

/** Sends via SMTP or Resend when configured; otherwise logs so local flows (magic links, receipts) still work. */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  react: ReactElement;
  devLog?: string;
  /** Extra headers, e.g. List-Unsubscribe for marketing mail. */
  headers?: Record<string, string>;
  /** Throw instead of logging when the provider rejects the message (callers that record delivery). */
  throwOnError?: boolean;
}): Promise<EmailResult> {
  const t = await transport();
  if (t.kind === "dev") {
    console.info(`\n✉  [email:dev] to=${opts.to} subject="${opts.subject}"${opts.devLog ? `\n   ${opts.devLog}` : ""}\n`);
    return { ok: true, via: "dev" };
  }
  const html = await render(opts.react);
  let error: string | null = null;
  try {
    if (t.kind === "smtp") {
      await t.send({ to: opts.to, subject: opts.subject, html, headers: opts.headers });
    } else {
      const r = await t.client.emails.send({ from: t.from, to: opts.to, subject: opts.subject, html, ...(opts.headers ? { headers: opts.headers } : {}) });
      if (r.error) error = r.error.message;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  if (error) {
    if (opts.throwOnError) throw new Error(`Email send failed: ${error}`);
    console.error(`[email] send via ${t.kind} to ${opts.to} failed:`, error);
    return { ok: false, error };
  }
  // One line per delivery so the host's logs show which provider carried it (address partly masked).
  console.info(`[email] sent via ${t.kind} to ${opts.to.replace(/^(.{2})[^@]*/, "$1***")} — "${opts.subject}"`);
  return { ok: true, via: t.kind };
}
