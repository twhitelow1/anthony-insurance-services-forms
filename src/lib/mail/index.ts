import "server-only";
import { graphConfigured, sendViaGraph } from "./graph";
import { resendConfigured, sendViaResend } from "./resend";
import { BRANDS, type Brand, brandHost } from "@/lib/brands";

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
  /** Plain-text version; derived from `html` when not given. */
  text?: string;
  /** Sender display name, e.g. "Dance Studio Insurance"; the address stays the configured one. */
  fromName?: string;
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
  throw new Error("Email is not configured (set RESEND_API_KEY in Vercel)");
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface EmailContent {
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  /** Whose email this is: name, logo, colors, site link and footer. Defaults to Anthony Insurance Services. */
  brand?: Brand;
}

/** Footer lines: the brand's site, and that DSI and MASI are Anthony Insurance programs. */
function footerLines(brand: Brand) {
  return [
    `${brand.name} · ${brandHost(brand)}`,
    ...(brand.id === "ais" ? [] : [`${brand.name} is a program of ${BRANDS.ais.name}.`]),
  ];
}

/** Branded HTML email plus its plain-text version. Email-client-safe (tables, inline styles). */
export function renderEmail({ heading, paragraphs, button, brand = BRANDS.ais }: EmailContent): { html: string; text: string } {
  const color = brand.vars["--brand"];
  const buttonColor = brand.vars["--button"];
  const accent = brand.vars["--accent"];
  const img = brand.logo
    ? `<img src="${esc(brand.logo)}" alt="${esc(brand.name)}" height="48" style="display:block;height:48px;width:auto;border:0">`
    : "";
  const logo = brand.logo
    ? brand.logoBg
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td style="background:${brand.logoBg};border-radius:8px;padding:10px 16px">${img}</td></tr></table>`
      : `<div style="margin:0 0 20px">${img}</div>`
    : `<p style="margin:0 0 16px;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:${color};font-weight:bold">${esc(brand.name)}</p>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(heading)}</title></head>
<body style="margin:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #dbe1ea;border-top:4px solid ${accent};border-radius:12px" cellpadding="0" cellspacing="0"><tr><td style="padding:32px">
<a href="${esc(brand.site)}" style="text-decoration:none">${logo}</a>
<h1 style="margin:0 0 16px;font-size:22px;color:${color}">${esc(heading)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55">${esc(p)}</p>`).join("")}
${button ? `<p style="margin:24px 0"><a href="${esc(button.url)}" style="background:${buttonColor};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block">${esc(button.label)}</a></p><p style="margin:0;font-size:12px;color:#56637a;word-break:break-all">Or paste this link into your browser: ${esc(button.url)}</p>` : ""}
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#56637a">${footerLines(brand).map(esc).join("<br>").replace(esc(brandHost(brand)), `<a href="${esc(brand.site)}" style="color:#56637a">${esc(brandHost(brand))}</a>`)}</p>
</td></tr></table></body></html>`;
  const text = [
    brand.name.toUpperCase(),
    "",
    heading,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    ...(button ? [`${button.label}: ${button.url}`, ""] : []),
    "--",
    ...footerLines(brand),
    brand.site,
  ].join("\n");
  return { html, text };
}

/** Just the HTML (most callers); sendMail derives the plain-text part. */
export const emailLayout = (content: EmailContent) => renderEmail(content).html;

/** Plain-text fallback from HTML, for emails sent without one. */
export function htmlToText(html: string) {
  return html
    .replace(/<(head|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h1|h2|tr)>/gi, "\n\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => (label.replace(/<[^>]+>/g, "").trim() === href ? href : `${label} (${href})`))
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*(\n\s*)+/g, "\n\n")
    .trim();
}
