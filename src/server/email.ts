import "server-only";
import type { ReactElement } from "react";
import { render } from "@react-email/components";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import { env } from "@/env";

const smtp =
  env.SMTP_USER && env.SMTP_PASSWORD
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      })
    : null;
const resend = !smtp && env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

/** Sends via SMTP or Resend when configured; otherwise logs so local flows (magic links, receipts) still work. */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  react: ReactElement;
  devLog?: string;
}) {
  if (!smtp && !resend) {
    console.info(`\n✉  [email:dev] to=${opts.to} subject="${opts.subject}"${opts.devLog ? `\n   ${opts.devLog}` : ""}\n`);
    return;
  }
  const html = await render(opts.react);
  if (smtp) {
    try {
      await smtp.sendMail({ from: env.EMAIL_FROM, to: opts.to, subject: opts.subject, html });
    } catch (e) {
      console.error("[email] send failed", e);
    }
    return;
  }
  const { error } = await resend!.emails.send({ from: env.EMAIL_FROM, to: opts.to, subject: opts.subject, html });
  if (error) console.error("[email] send failed", error);
}
