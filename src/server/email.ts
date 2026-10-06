import "server-only";
import type { ReactElement } from "react";
import { render } from "@react-email/components";
import { Resend } from "resend";
import { env } from "@/env";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

/** Sends via Resend when configured; otherwise logs so local flows (magic links, receipts) still work. */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  react: ReactElement;
  devLog?: string;
}) {
  if (!resend) {
    console.info(`\n✉  [email:dev] to=${opts.to} subject="${opts.subject}"${opts.devLog ? `\n   ${opts.devLog}` : ""}\n`);
    return;
  }
  const html = await render(opts.react);
  const { error } = await resend.emails.send({ from: env.EMAIL_FROM, to: opts.to, subject: opts.subject, html });
  if (error) console.error("[email] send failed", error);
}
