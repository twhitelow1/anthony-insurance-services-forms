import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FormDefinition, FormValues } from "@/lib/forms/types";
import { triggeredNotices } from "@/lib/forms/validate";
import type { MailAttachment } from "@/lib/mail";

/**
 * Sample documents for the compliance popups (e.g. "No concussion policy"),
 * attached to the applicant's confirmation email. Files are in compliance-docs/
 * (listed in next.config.ts outputFileTracingIncludes); which file goes with which
 * answer is set in src/forms/config.ts.
 */
export const complianceDocPath = (file: string) => path.join(process.cwd(), "compliance-docs", path.basename(file));

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
};

/** The notices this application triggered and their documents. A missing file is logged and skipped. */
export async function complianceAttachments(form: FormDefinition, values: FormValues) {
  const notices = triggeredNotices(form, values);
  const files = [...new Set(notices.flatMap((n) => n.documents ?? []))];
  const attachments: MailAttachment[] = [];
  for (const file of files) {
    try {
      attachments.push({
        name: path.basename(file),
        contentType: TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        content: new Uint8Array(await readFile(complianceDocPath(file))),
      });
    } catch (err) {
      console.error(`[compliance] sample document ${file} is missing`, err);
    }
  }
  return { notices, attachments };
}
