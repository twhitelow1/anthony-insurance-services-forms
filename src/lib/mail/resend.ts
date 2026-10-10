import "server-only";
import type { Mail } from "./index";
import { subjectFor } from "./index";
import { DEFAULT_MAIL_FROM, getSettings } from "@/lib/settings";

/**
 * Resend (resend.com) transactional email. The sender and reply-to come from
 * Admin → Settings (else MAIL_FROM / MAIL_REPLY_TO); the sender's domain must
 * be verified in Resend.
 */
const BASE = () => (process.env.RESEND_BASE_URL ?? "https://api.resend.com").replace(/\/$/, "");

export const resendConfigured = () => !!process.env.RESEND_API_KEY;

/** Resend's answer when the From address isn't on a domain verified in the account. */
const UNVERIFIED_SENDER = /domain is not verified/i;

export async function sendViaResend(mail: Mail) {
  const { mailFrom, mailReplyTo } = await getSettings();
  const replyTo = mail.replyTo ?? (mailReplyTo || undefined);
  try {
    await post(mail, mailFrom, replyTo);
  } catch (err) {
    // A sender on an unverified domain would block every email, sign-in links included,
    // so fall back to the default sender once and say so in the logs.
    if (!(err instanceof Error && UNVERIFIED_SENDER.test(err.message)) || mailFrom === DEFAULT_MAIL_FROM) throw err;
    console.warn(`[mail] sender "${mailFrom}" isn't on a verified Resend domain; sent from ${DEFAULT_MAIL_FROM} instead. Fix Send from in Admin → Settings or MAIL_FROM in Vercel.`);
    await post(mail, DEFAULT_MAIL_FROM, replyTo);
  }
}

async function post(mail: Mail, from: string, replyTo: string | undefined) {
  const res = await fetch(`${BASE()}/emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
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
