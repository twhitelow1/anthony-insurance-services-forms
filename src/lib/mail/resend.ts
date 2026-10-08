import "server-only";
import type { Mail } from "./index";
import { subjectFor } from "./index";
import { getSettings } from "@/lib/settings";

/**
 * Resend (resend.com) transactional email. The sender and reply-to come from
 * Admin → Settings (else MAIL_FROM / MAIL_REPLY_TO); the sender's domain must
 * be verified in Resend.
 */
const BASE = () => (process.env.RESEND_BASE_URL ?? "https://api.resend.com").replace(/\/$/, "");

export const resendConfigured = () => !!process.env.RESEND_API_KEY;

export async function sendViaResend(mail: Mail) {
  const { mailFrom, mailReplyTo } = await getSettings();
  const replyTo = mail.replyTo ?? (mailReplyTo || undefined);
  const res = await fetch(`${BASE()}/emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: mailFrom,
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
