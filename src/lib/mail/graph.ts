import "server-only";
import type { Mail } from "./index";
import { subjectFor } from "./index";

/**
 * Sends mail as the agency mailbox through Microsoft Graph (app-only auth).
 *
 * Because the message goes through Exchange Online like any other mail, the
 * agency's existing transport rules apply — including the "[tag] in subject →
 * encrypt" rule. Optional: used only when the Microsoft app is configured.
 *
 * Authorization comes from Exchange Online "RBAC for Applications": the app is
 * assigned the "Application Mail.Send" role scoped to MAIL_SENDER only. Don't
 * grant Mail.Send in Entra — that would let it send as anyone in the tenant.
 */
const LOGIN_BASE = () => (process.env.ENTRA_LOGIN_BASE ?? "https://login.microsoftonline.com").replace(/\/$/, "");
const GRAPH_BASE = () => (process.env.GRAPH_BASE_URL ?? "https://graph.microsoft.com").replace(/\/$/, "");


export const graphConfigured = () =>
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

export async function sendViaGraph(mail: Mail) {
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
