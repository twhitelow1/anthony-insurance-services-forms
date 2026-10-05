import "server-only";
import type { Mail } from "./index";
import { subjectFor } from "./index";

/**
 * Resend (resend.com) transactional email.
 * MAIL_FROM must use a domain verified in Resend, e.g.
 * "Anthony Insurance Services <applications@anthonyinsuranceservices.com>".
 */
const BASE = () => (process.env.RESEND_BASE_URL ?? "https://api.resend.com").replace(/\/$/, "");

export const resendConfigured = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

export async function sendViaResend(mail: Mail) {
  const replyTo = mail.replyTo ?? process.env.MAIL_REPLY_TO;
  const res = await fetch(`${BASE()}/emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to: [mail.to].flat(),
      subject: subjectFor(mail),
      html: mail.html,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(mail.attachments?.length
        ? {
            attachments: mail.attachments.map((a) => ({
              filename: a.name,
              content: Buffer.from(a.content).toString("base64"),
              content_type: a.contentType,
            })),
          }
        : {}),
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Resend send failed (${res.status}): ${await res.text()}`);
}
