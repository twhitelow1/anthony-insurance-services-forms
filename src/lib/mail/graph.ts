import "server-only";

/**
 * Sends mail as the agency mailbox through Microsoft Graph (app-only auth).
 *
 * Because the message goes through Exchange Online like any other mail, the
 * agency's existing transport rules apply — including the "[tag] in subject →
 * encrypt" rule. Pass `encrypt: true` to add that tag.
 *
 * Requires the Entra app to have the Mail.Send *application* permission, which
 * should be limited to the sending mailbox with Exchange "RBAC for Applications".
 */
const LOGIN_BASE = () => (process.env.ENTRA_LOGIN_BASE ?? "https://login.microsoftonline.com").replace(/\/$/, "");
const GRAPH_BASE = () => (process.env.GRAPH_BASE_URL ?? "https://graph.microsoft.com").replace(/\/$/, "");

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

export const mailConfigured = () =>
  !!(process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.MAIL_SENDER);

let cached: { token: string; expires: number } | undefined;

async function appToken() {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const res = await fetch(`${LOGIN_BASE()}/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.AZURE_CLIENT_ID!,
      client_secret: process.env.AZURE_CLIENT_SECRET!,
      grant_type: "client_credentials",
      scope: `${GRAPH_BASE()}/.default`,
    }),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Graph token failed (${res.status}): ${data.error_description ?? data.error}`);
  cached = { token: data.access_token, expires: Date.now() + Number(data.expires_in ?? 3600) * 1000 };
  return cached.token;
}

export function subjectFor(mail: Pick<Mail, "subject" | "encrypt">) {
  const tag = process.env.MAIL_ENCRYPT_TAG ?? "[encrypt]";
  return mail.encrypt && tag ? `${tag} ${mail.subject}` : mail.subject;
}

export async function sendMail(mail: Mail) {
  if (!mailConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`\n[mail:dev] To: ${[mail.to].flat().join(", ")}\n[mail:dev] Subject: ${subjectFor(mail)}\n${mail.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")}\n`);
      return;
    }
    throw new Error("Mail is not configured (AZURE_* and MAIL_SENDER)");
  }
  const sender = process.env.MAIL_SENDER!;
  const res = await fetch(`${GRAPH_BASE()}/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await appToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: subjectFor(mail),
        body: { contentType: "HTML", content: mail.html },
        toRecipients: [mail.to].flat().map((address) => ({ emailAddress: { address } })),
        ...(mail.replyTo ? { replyTo: [{ emailAddress: { address: mail.replyTo } }] } : {}),
        attachments: (mail.attachments ?? []).map((a) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: a.name,
          contentType: a.contentType,
          contentBytes: Buffer.from(a.content).toString("base64"),
        })),
      },
      saveToSentItems: true,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Graph sendMail failed (${res.status}): ${await res.text()}`);
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
