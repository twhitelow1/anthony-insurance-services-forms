import "server-only";
import { graphConfigured, sendViaGraph } from "./graph";
import { resendConfigured, sendViaResend } from "./resend";

/**
 * Outgoing email. Provider, in order of preference:
 *  1. Resend (RESEND_API_KEY) — the default for now
 *  2. Microsoft Graph (AZURE_* + MAIL_SENDER) — if the Microsoft app is set up later
 *  3. Development only: printed to the server log
 */

export interface MailAttachment {
  name: string;
  contentType: string;
  content: Uint8Array;
}

export interface Mail {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: MailAttachment[];
  /** Prefix the subject with MAIL_ENCRYPT_TAG so Exchange encrypts the message. */
  encrypt?: boolean;
}

export const mailConfigured = () => resendConfigured() || graphConfigured();

export function subjectFor(mail: Pick<Mail, "subject" | "encrypt">) {
  const tag = process.env.MAIL_ENCRYPT_TAG ?? "[encrypt]";
  return mail.encrypt && tag ? `${tag} ${mail.subject}` : mail.subject;
}

export async function sendMail(mail: Mail) {
  if (resendConfigured()) return sendViaResend(mail);
  if (graphConfigured()) return sendViaGraph(mail);
  if (process.env.NODE_ENV !== "production") {
    console.info(`\n[mail:dev] To: ${[mail.to].flat().join(", ")}\n[mail:dev] Subject: ${subjectFor(mail)}\n${mail.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")}\n`);
    return;
  }
  throw new Error("Email is not configured (set RESEND_API_KEY and MAIL_FROM)");
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Minimal, email-client-safe layout. */
export function emailLayout({ heading, paragraphs, button }: { heading: string; paragraphs: string[]; button?: { label: string; url: string } }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#0f1b2d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #dbe1ea;border-radius:12px" cellpadding="0" cellspacing="0"><tr><td style="padding:32px">
<p style="margin:0 0 8px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#1859c4;font-weight:bold">Anthony Insurance Services</p>
<h1 style="margin:0 0 16px;font-size:22px;color:#13294b">${esc(heading)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55">${esc(p)}</p>`).join("")}
${button ? `<p style="margin:24px 0"><a href="${esc(button.url)}" style="background:#13294b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block">${esc(button.label)}</a></p><p style="margin:0;font-size:12px;color:#56637a;word-break:break-all">Or paste this link into your browser: ${esc(button.url)}</p>` : ""}
</td></tr></table></td></tr></table></body></html>`;
}
