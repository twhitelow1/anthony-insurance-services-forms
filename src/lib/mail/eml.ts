import { randomBytes } from "node:crypto";

/**
 * Builds an .eml file that opens in Outlook as an unsent, editable draft
 * (X-Unsent: 1). Staff review it and press Send from their own mailbox, so the
 * agency's Exchange rules — including subject-tag encryption — apply.
 */

export interface EmlAttachment {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

const b64Lines = (data: Uint8Array | string) =>
  Buffer.from(data)
    .toString("base64")
    .replace(/.{1,76}/g, "$&\r\n");

/** RFC 2047 encoded-word for headers that aren't plain ASCII. */
const encodeHeader = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v).toString("base64")}?=`);

/** Filename parameter safe for Outlook (RFC 2231 when non-ASCII). */
const fileParam = (name: string) =>
  /^[\x20-\x7e]*$/.test(name) && !/["\\]/.test(name)
    ? `filename="${name}"`
    : `filename*=UTF-8''${encodeURIComponent(name)}`;

export function buildEml(msg: { to?: string[]; subject: string; html: string; attachments: EmlAttachment[] }): string {
  const boundary = `----=_AIS_${randomBytes(12).toString("hex")}`;
  const headers = [
    ...(msg.to?.length ? [`To: ${msg.to.join(", ")}`] : []),
    `Subject: ${encodeHeader(msg.subject)}`,
    "X-Unsent: 1",
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [
    [`--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64Lines(msg.html)].join("\r\n"),
    ...msg.attachments.map((a) =>
      [
        `--${boundary}`,
        `Content-Type: ${a.contentType}; name="${a.filename.replace(/["\\]/g, "")}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; ${fileParam(a.filename)}`,
        "",
        b64Lines(a.content),
      ].join("\r\n"),
    ),
  ];
  return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}\r\n--${boundary}--\r\n`;
}
